import { pool } from './index.js';

/**
 * Updates the ingestion_runs table to mark a run as FAILED with an error message.
 *
 * @param {string|number} runId - The ID of the ingestion run
 * @param {string} errorMessage - The error message to record
 */
export async function failIngestionRun(runId, errorMessage) {
  // Query to update the status, finished_at timestamp, and error_message for the specified runId
  const query = `
    UPDATE ingestion_runs
    SET status = 'FAILED',
        finished_at = NOW(),
        error_message = $1
    WHERE id = $2
  `;
  
  try {
    // Execute the update query using the database pool
    await pool.query(query, [errorMessage, runId]);
  } catch (error) {
    console.error(`Failed to update ingestion run ${runId} with error:`, error);
  }
}
