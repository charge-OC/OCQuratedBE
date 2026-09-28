import { Router } from 'express';
import { pool } from '../db/index.js';
import { sourceCreateSchema } from '../schemas/sourceSchema.js';
import { streamHvhXml } from '../adapters/hvhAdapter.js';

const router = Router();

// Purpose: Protects all the routes below by figuring out which merchant is making the request.
// Pseudocode: Checks the 'x-merchant-id' header and attaches it to the request so we can use it later.
// Edge cases: If the header is missing, it falls back to a default (useful for local dev).
router.use((req, res, next) => {
    const merchantId = req.headers['x-merchant-id'] || 'default-merchant';
    req.merchantId = merchantId;
    next();
});

// Purpose: Get a list of all data sources set up by this merchant.
// Pseudocode: Runs a simple SQL query to grab everything from the sources table for the current merchant.
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sources WHERE merchant_id = $1 ORDER BY created_at DESC',
            [req.merchantId]
        );
        res.json({ sources: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Get the exact details of one specific ingestion run.
// Pseudocode: Looks up the run by its ID in the database and makes sure it belongs to the merchant.
router.get('/runs/:runId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM ingestion_runs WHERE id = $1 AND merchant_id = $2',
            [req.params.runId, req.merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Run not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Fetch all the runs for a specific source to show a history of syncs.
// Pseudocode: 
// 1. Look up all the run records for this source ID.
// 2. Make sure they belong to the current merchant.
// 3. Calculate how long each run took by finding the difference between start and finish.
// 4. Return the list.
// Edge cases: If a run is still processing, it calculates duration up to the current moment.
router.get('/:id/runs', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *, 
                EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at)) AS duration_seconds 
             FROM ingestion_runs 
             WHERE source_id = $1 AND merchant_id = $2 
             ORDER BY started_at DESC`,
            [req.params.id, req.merchantId]
        );
        res.json({ runs: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Get the exact details of one specific data source.
// Pseudocode: Looks up the source by its ID and makes sure it belongs to the merchant.
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sources WHERE id = $1 AND merchant_id = $2',
            [req.params.id, req.merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Source not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Create a brand new data source for a merchant.
// Pseudocode: 
// 1. Validate the incoming data using our Zod schema.
// 2. If it's valid, insert a new row into the sources table.
// 3. Return the newly created source back to the user.
router.post('/', async (req, res) => {
    const parsed = sourceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const { name, type, default_model_id, connection_config, schedule_cron } = parsed.data;

    try {
        const result = await pool.query(
            `INSERT INTO sources (merchant_id, name, type, default_model_id, connection_config, schedule_cron)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [req.merchantId, name, type, default_model_id, connection_config, schedule_cron || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Manually start a data sync for a specific source.
// Pseudocode:
// 1. Find the source to make sure it exists.
// 2. Check if a sync is already running right now. If yes, stop and tell the user.
// 3. If it's free, create a new run record marked as 'PROCESSING'.
// 4. Immediately tell the user it started (HTTP 202) so they don't have to wait.
// 5. In the background, stream the data, count the records, and save the final status.
// Inputs: Source ID from the URL, Merchant ID from the headers.
// Outputs: A run_id right away, then database updates later.
// Edge cases: Prevents two syncs from running at the same time (concurrency lock). Gracefully saves errors if the stream crashes.
router.post('/:id/sync', async (req, res) => {
    try {
        const sourceResult = await pool.query(
            'SELECT * FROM sources WHERE id = $1 AND merchant_id = $2',
            [req.params.id, req.merchantId]
        );

        if (sourceResult.rows.length === 0) {
            return res.status(404).json({ error: 'Source not found' });
        }

        const source = sourceResult.rows[0];

        // Check for active processing run
        const activeRunResult = await pool.query(
            "SELECT id FROM ingestion_runs WHERE source_id = $1 AND merchant_id = $2 AND status = 'PROCESSING'",
            [source.id, req.merchantId]
        );
        if (activeRunResult.rows.length > 0) {
            return res.status(409).json({ error: 'Sync already in progress for this source' });
        }

        // Insert initial ingestion run
        const runResult = await pool.query(
            `INSERT INTO ingestion_runs (source_id, merchant_id, status, started_at)
             VALUES ($1, $2, 'PROCESSING', NOW())
             RETURNING id`,
            [source.id, req.merchantId]
        );

        const runId = runResult.rows[0].id;

        // Return 202 Accepted immediately
        res.status(202).json({
            message: 'Ingestion started',
            run_id: runId
        });

        // Background stream execution
        (async () => {
            let totalRows = 0;
            let validRows = 0;
            let failedRows = 0;

            try {
                const targetUrl = source.connection_config?.url;

                await streamHvhXml(targetUrl, (record) => {
                    totalRows++;
                    if (record && !record.is_flagged) {
                        validRows++;
                    } else {
                        failedRows++;
                    }
                });

                await pool.query(
                    `UPDATE ingestion_runs 
                     SET status = 'COMPLETED',
                         total_rows = $1,
                         valid_rows = $2,
                         failed_rows = $3,
                         finished_at = NOW()
                     WHERE id = $4 AND merchant_id = $5`,
                    [totalRows, validRows, failedRows, runId, req.merchantId]
                );
            } catch (bgError) {
                await pool.query(
                    `UPDATE ingestion_runs 
                     SET status = 'FAILED',
                         total_rows = $1,
                         valid_rows = $2,
                         failed_rows = $3,
                         error_message = $4,
                         finished_at = NOW()
                     WHERE id = $5 AND merchant_id = $6`,
                    [totalRows, validRows, failedRows, bgError.message, runId, req.merchantId]
                );
            }
        })();

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purpose: Delete a source from the database.
// Pseudocode: Tries to delete the row where the ID and merchant ID match. Returns 404 if it couldn't find it.
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM sources WHERE id = $1 AND merchant_id = $2 RETURNING id',
            [req.params.id, req.merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Source not found' });
        }

        res.json({ status: 'deleted', id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;