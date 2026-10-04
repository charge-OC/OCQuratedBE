import fs from 'fs';
import { Readable } from 'stream';
import sax from 'sax';

// Purpose: Streams an XML feed from a local file or an HTTP URL and extracts products.
// Pseudocode: 
// 1. Check if the target is a web URL or a local file.
// 2. Open a read stream.
// 3. Set up the SAX XML parser to read chunk-by-chunk so we don't blow up memory.
// 4. Look for <product> tags, grab all the text fields, and fire the 'onProduct' callback for each.
// Inputs: streamOrTarget (Readable stream, string URL, or path), onProduct (callback function).
// Outputs: A promise that resolves with the total processed count.
// Edge cases: Handles missing files, broken URLs, and gracefully pauses the stream during async callbacks.
export async function streamHvhXml(streamOrTarget, onProduct) {
    let stream;

    // Figure out if we are grabbing this from the web, a local file, or if it's already a stream. 
    if (streamOrTarget && typeof streamOrTarget.pipe === 'function') {
        stream = streamOrTarget;
    } else if (typeof streamOrTarget === 'string' && (streamOrTarget.startsWith('http://') || streamOrTarget.startsWith('https://'))) {
        const response = await fetch(streamOrTarget);
        if (!response.ok) {
            throw new Error(`Failed to fetch XML stream from ${streamOrTarget}: HTTP ${response.status}`);
        }
        stream = Readable.fromWeb(response.body);
    } else if (typeof streamOrTarget === 'string' && fs.existsSync(streamOrTarget)) {
        stream = fs.createReadStream(streamOrTarget, { encoding: 'utf8' });
    } else {
        throw new Error(`File or URL target not accessible: ${streamOrTarget}`);
    }

    return new Promise((resolve, reject) => {
        // We use a streaming XML parser here to keep it lightweight.
        const parser = sax.createStream(true, { trim: true });

        let currentProduct = null;
        let currentTag = null;
        let insideProduct = false;
        let insideCategories = false;
        let count = 0;

        // Catch any weird stream or parsing errors so it doesn't crash the whole app.
        stream.on('error', (err) => reject(err));
        parser.on('error', (err) => reject(err));

        // When a new XML tag opens, we check if it's the start of a product or a category tree.
        parser.on('opentag', (node) => {
            currentTag = node.name;

            if (node.name === 'product') {
                insideProduct = true;
                currentProduct = {
                    properties: {},
                };
            } else if (node.name === 'categories') {
                insideCategories = true;
            }
        });

        // When we hit the actual text inside a tag, we save it to our product object.
        parser.on('text', (text) => {
            if (!insideProduct || insideCategories) return; // Ignore categories to save memory

            // We pick out important fields directly, and throw everything else into a 'properties' bucket.
            if (['id', 'sku', 'title', 'name', 'price', 'stock', 'description', 'ean'].includes(currentTag)) {
                currentProduct[currentTag] = text;
            } else if (currentTag) {
                currentProduct.properties[currentTag] = text;
            }
        });

        // When a tag closes, if it's a product, we hand it off to the callback function.
        parser.on('closetag', async (tagName) => {
            if (tagName === 'categories') {
                insideCategories = false;
            } else if (tagName === 'product') {
                insideProduct = false;
                count++;

                if (onProduct && currentProduct) {
                    // Pause the parser so it waits for our callback to finish before reading more XML!
                    parser.pause();
                    try {
                        await onProduct(currentProduct);
                    } catch (err) {
                        return reject(err);
                    }
                    parser.resume();
                }
                currentProduct = null;
            }
            currentTag = null;
        });

        // When we hit the very end of the file, we successfully resolve the promise.
        parser.on('end', () => {
            resolve({ processedProducts: count });
        });

        // Hook up the raw data stream to our XML parser.
        stream.pipe(parser);
    });
}