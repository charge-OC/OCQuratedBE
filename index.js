import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsvFile } from './src/ingest-csv.js';
import { pool } from './src/db/index.js';
import sourceRoutes from './src/routes/sources.js';
import { startCronWorker } from './src/workers/cron.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './src/swagger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

// Purpose: Boots up the Qurated API server and gets everything ready.
// Pseudocode: 
// 1. Set up Express and basic tools like CORS and JSON parsing.
// 2. Hook up our source and extraction routes.
// 3. Connect to the database.
// 4. Start the background cron worker to listen for scheduled jobs.
// 5. Start listening for incoming web requests on the specified port.
const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

app.use(cors());
app.use(express.json());

// Expose Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.use('/api/sources', sourceRoutes);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Qurated Data API is running',
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/lineage/:documentId', (req, res) => {
    const { documentId } = req.params;
    res.json({
        document_id: documentId,
        lineage_chain: [
            {
                event_id: '550e8400-e29b-41d4-a716-446655440000',
                action: 'ai_extracted',
                actor: 'system_llm',
                field: 'finish',
                raw_value: 'hot dip galv.',
                confidence_score: 0.89,
                bounding_box: { x: 120, y: 340, width: 85, height: 22 },
                prompt_version: 'v1.0.4',
                timestamp: new Date().toISOString(),
            },
        ],
    });
});

app.post('/api/extract', async (req, res) => {
    try {
        const completion = await client.chat.completions.create({
            model: process.env.DEFAULT_MODEL || "google/gemini-flash-1.5",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Return a bounding box [ymin, xmin, ymax, xmax] on a 0-1000 scale." }
            ],
        });

        res.json({
            status: 'success',
            message: 'Endpoint ready for AI extraction logic via OpenRouter.',
            mock_response: completion.choices[0].message.content
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/ingest-csv', async (req, res) => {
    try {
        const filePath = req.body?.filePath
            ? path.resolve(__dirname, req.body.filePath)
            : path.join(__dirname, 'mock_pushop.csv');

        const summary = await parseCsvFile(filePath);
        res.status(200).json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, async () => {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log(`Database connected successfully at ${res.rows[0].now}`);

        // Scenario 4: Server Restart & Zombie Lock Recovery
        // Release any locks held by runs that were interrupted by a restart
        const recoveryRes = await pool.query(
            "UPDATE ingestion_runs SET status = 'FAILED', error_message = 'Terminated unexpectedly due to server restart', finished_at = NOW() WHERE status = 'PROCESSING' RETURNING id"
        );
        if (recoveryRes.rowCount > 0) {
            console.log(`Recovered ${recoveryRes.rowCount} zombie locks for interrupted runs.`);
        }

        startCronWorker();
    } catch (err) {
        console.error('Database connection failed:', err);
    }
    console.log(`Server running on port ${port}`);
});