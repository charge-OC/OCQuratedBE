const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Database connection pool using environment variables
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'qurated',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

app.use(cors());
app.use(express.json());

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Qurated Data API is running',
        timestamp: new Date().toISOString(),
    });
});

// Mock lineage contract for Raven's split-screen UI
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
                bounding_box: {
                    x: 120,
                    y: 340,
                    width: 85,
                    height: 22,
                },
                prompt_version: 'v1.0.4',
                timestamp: new Date().toISOString(),
            },
        ],
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});