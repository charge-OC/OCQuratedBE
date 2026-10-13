import { downloadFtpStream } from './ftpDownloader.js';
import { downloadHttpStream } from './httpDownloader.js';
import { failIngestionRun } from '../db/ingestionHelpers.js';

/**
 * Resolves the transport protocol ('FTP' or 'HTTP') for a given source.
 * 
 * Inspects:
 * 1. source.protocol (case-insensitive)
 * 2. source.connection_config?.protocol (case-insensitive)
 * 3. source.connection_config?.url scheme (ftp:// vs http://)
 * 4. Fallback to source.type if explicitly set to FTP/HTTP
 * 
 * @param {Object} source
 * @returns {'FTP'|'HTTP'|null}
 */
export function resolveProtocol(source) {
  const connConfig = source?.connection_config || {};

  if (source?.protocol) {
    const proto = String(source.protocol).trim().toUpperCase();
    if (['FTP', 'SFTP'].includes(proto)) return 'FTP';
    if (['HTTP', 'HTTPS', 'API'].includes(proto)) return 'HTTP';
  }

  if (connConfig.protocol) {
    const proto = String(connConfig.protocol).trim().toUpperCase();
    if (['FTP', 'SFTP'].includes(proto)) return 'FTP';
    if (['HTTP', 'HTTPS', 'API'].includes(proto)) return 'HTTP';
  }

  if (connConfig.url && typeof connConfig.url === 'string') {
    const lowerUrl = connConfig.url.trim().toLowerCase();
    if (lowerUrl.startsWith('ftp://') || lowerUrl.startsWith('sftp://') || lowerUrl.startsWith('ftp')) {
      return 'FTP';
    }
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
      return 'HTTP';
    }
  }

  if (source?.type) {
    const typeUpper = String(source.type).trim().toUpperCase();
    if (['FTP', 'SFTP'].includes(typeUpper)) return 'FTP';
    if (['HTTP', 'HTTPS'].includes(typeUpper)) return 'HTTP';
  }

  if (connConfig.host && (connConfig.user || connConfig.port === 21)) {
    return 'FTP';
  }

  if (connConfig.url) {
    return 'HTTP';
  }

  return null;
}

/**
 * Inspects the source configuration and routes the download request 
 * to either the FTP or HTTP downloader stream.
 *
 * @param {Object} source - The source configuration from the database
 * @param {string|number} runId - The ID of the current ingestion run
 * @returns {Promise<import('stream').PassThrough|null>} The downloaded readable stream, or null if failed
 */
export async function fetchSourceStream(source, runId) {
  try {
    const protocol = resolveProtocol(source);
    let stream;
    
    // Route to the appropriate downloader based on resolved protocol
    if (protocol === 'FTP') {
      stream = await downloadFtpStream(source.connection_config);
    } else if (protocol === 'HTTP') {
      stream = await downloadHttpStream(source.connection_config);
    } else {
      throw new Error(`Unable to determine transport protocol for source: ${source?.name || source?.id || 'unknown'}`);
    }
    
    // Return the readable stream to the caller
    return stream;
  } catch (error) {
    // On failure (timeout, bad credentials, HTML response, etc), record the error in DB
    if (runId) {
      await failIngestionRun(runId, error.message);
    }
    
    // Re-throw the error so downstream callers know it failed
    throw error;
  }
}
