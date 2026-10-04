import { downloadFtpStream } from './ftpDownloader.js';
import { downloadHttpStream } from './httpDownloader.js';
import { failIngestionRun } from '../db/ingestionHelpers.js';

/**
 * Inspects the source configuration and routes the download request 
 * to either the FTP or HTTP downloader stream.
 *
 * @param {Object} source - The source configuration from the database
 * @param {string} source.type - The type of source ('FTP', 'HTTP', etc)
 * @param {Object} source.connection_config - Connection details
 * @param {string|number} runId - The ID of the current ingestion run
 * @returns {Promise<import('stream').PassThrough|null>} The downloaded readable stream, or null if failed
 */
export async function fetchSourceStream(source, runId) {
  try {
    let stream;
    
    // Route to the appropriate downloader based on source type
    if (source.type === 'FTP' || source.type === 'SFTP') {
      stream = await downloadFtpStream(source.connection_config);
    } else if (source.type === 'HTTP' || source.type === 'HTTPS' || source.type === 'API') {
      stream = await downloadHttpStream(source.connection_config);
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }
    
    // Return the readable stream to the caller
    return stream;
  } catch (error) {
    // On failure (timeout, bad credentials, HTML response, etc), record the error in DB
    await failIngestionRun(runId, error.message);
    
    // Re-throw the error so downstream callers know it failed, 
    // but without crashing the whole Node.js process (try/catch will handle it)
    throw error;
  }
}
