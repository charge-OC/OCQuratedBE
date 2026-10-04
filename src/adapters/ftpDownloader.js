import * as ftp from 'basic-ftp';
import { PassThrough } from 'stream';

/**
 * Connects to an FTP server and downloads a file as a readable stream.
 *
 * @param {Object} connectionConfig - FTP credentials and file path
 * @param {string} connectionConfig.host - FTP server hostname
 * @param {string} connectionConfig.user - FTP username
 * @param {string} connectionConfig.password - FTP password
 * @param {number} connectionConfig.port - FTP port (default: 21)
 * @param {boolean} connectionConfig.secure - Use FTPS (default: false)
 * @param {string} connectionConfig.remotePath - Path to the remote file to download
 * @returns {Promise<PassThrough>} A readable stream of the downloaded file
 */
export async function downloadFtpStream(connectionConfig) {
  // Create a new FTP client instance
  const client = new ftp.Client();
  
  // Set a connection timeout of 15 seconds (15000 ms)
  client.ftp.verbose = false;
  client.ftp.timeout = 15000;
  
  // Initialize a PassThrough stream that we'll return to the caller
  const passThrough = new PassThrough();

  try {
    // Attempt to connect to the FTP server using provided config
    await client.access({
      host: connectionConfig.host,
      user: connectionConfig.user,
      password: connectionConfig.password,
      port: connectionConfig.port || 21,
      secure: connectionConfig.secure || false,
    });
    
    // Download the remote file into our PassThrough stream
    // We don't await this because we want to return the stream immediately
    // so the downstream consumers can start processing it
    client.downloadTo(passThrough, connectionConfig.remotePath)
      .then(() => {
        // Once download is complete, close connection
        client.close();
      })
      .catch((err) => {
        // If an error occurs during download, emit it to the stream and close
        passThrough.destroy(err);
        client.close();
      });

    // Return the stream so it can be consumed
    return passThrough;
  } catch (error) {
    // If the initial connection fails, clean up and throw the error
    client.close();
    throw error;
  }
}
