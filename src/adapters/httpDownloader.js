import { PassThrough } from 'stream';

/**
 * Downloads a file via HTTP/HTTPS and returns it as a readable stream.
 * Protects against downloading HTML error pages instead of valid CSV data.
 *
 * @param {Object} connectionConfig - HTTP connection details
 * @param {string} connectionConfig.url - URL of the file to download
 * @returns {Promise<PassThrough>} A readable stream of the downloaded file
 */
export async function downloadHttpStream(connectionConfig) {
  // Setup an AbortController to enforce a 15-second timeout on the request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    // Initiate the HTTP request
    const res = await fetch(connectionConfig.url, {
      signal: controller.signal
    });

    // Clear the timeout since we received the initial response
    clearTimeout(timeoutId);

    // Check if the response status is OK (2xx)
    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status}`);
    }

    // Inspect Content-Type header to ensure we didn't receive an HTML page
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Supplier returned an HTML page instead of a CSV');
    }

    // Get the response body as a ReadableStream reader
    // We need to peek at the first chunk to ensure it's not HTML
    const reader = res.body.getReader();
    const { value: firstChunk, done } = await reader.read();
    
    // If stream is empty, return an empty PassThrough
    if (done) {
      const emptyStream = new PassThrough();
      emptyStream.end();
      return emptyStream;
    }

    // Convert the first chunk (Uint8Array) to a string to inspect it
    const chunkString = new TextDecoder().decode(firstChunk);
    
    // Check if the string begins with HTML tags like '<!DOCTYPE' or '<html'
    if (chunkString.trimStart().startsWith('<')) {
      throw new Error('Supplier returned an HTML page instead of a CSV');
    }

    // Since the data looks valid, create a PassThrough stream
    const outputStream = new PassThrough();

    // Push the first chunk we peeked at into the stream so no data is lost
    outputStream.write(firstChunk);

    // Asynchronously read the remaining chunks and pipe them to our output stream
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            outputStream.end();
            break;
          }
          outputStream.write(value);
        }
      } catch (err) {
        outputStream.destroy(err);
      }
    })();

    // Return the stream to the caller
    return outputStream;
  } catch (error) {
    // Ensure timeout is cleared on error
    clearTimeout(timeoutId);
    throw error;
  }
}
