import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveProtocol, fetchSourceStream } from '../src/adapters/fetcherFactory.js';

describe('Fetcher Factory Protocol Routing (Milestone B1 Fixes)', () => {
  describe('resolveProtocol()', () => {
    it('should resolve HTTP when source has type: csv and an http URL', () => {
      const source = {
        name: 'CSV Supplier Feed',
        type: 'csv',
        connection_config: { url: 'http://example.com/feed.csv' }
      };
      assert.strictEqual(resolveProtocol(source), 'HTTP');
    });

    it('should resolve HTTP when source has type: csv and an https URL', () => {
      const source = {
        name: 'CSV Supplier Feed HTTPS',
        type: 'csv',
        connection_config: { url: 'https://example.com/feed.csv' }
      };
      assert.strictEqual(resolveProtocol(source), 'HTTP');
    });

    it('should resolve FTP when source has type: csv and an ftp URL', () => {
      const source = {
        name: 'CSV Supplier FTP',
        type: 'csv',
        connection_config: { url: 'ftp://ftp.supplier.com/export.csv' }
      };
      assert.strictEqual(resolveProtocol(source), 'FTP');
    });

    it('should resolve protocol from explicit source.protocol (case-insensitive)', () => {
      assert.strictEqual(resolveProtocol({ type: 'csv', protocol: 'http' }), 'HTTP');
      assert.strictEqual(resolveProtocol({ type: 'csv', protocol: 'HTTPS' }), 'HTTP');
      assert.strictEqual(resolveProtocol({ type: 'csv', protocol: 'ftp' }), 'FTP');
      assert.strictEqual(resolveProtocol({ type: 'csv', protocol: 'SFTP' }), 'FTP');
      assert.strictEqual(resolveProtocol({ type: 'csv', protocol: 'api' }), 'HTTP');
    });

    it('should resolve protocol from connection_config.protocol', () => {
      assert.strictEqual(
        resolveProtocol({ type: 'csv', connection_config: { protocol: 'ftp' } }),
        'FTP'
      );
      assert.strictEqual(
        resolveProtocol({ type: 'csv', connection_config: { protocol: 'http' } }),
        'HTTP'
      );
    });

    it('should resolve FTP when connection_config has host and port 21 or user', () => {
      assert.strictEqual(
        resolveProtocol({ type: 'csv', connection_config: { host: 'ftp.example.com', user: 'anonymous' } }),
        'FTP'
      );
    });

    it('should return null when no transport protocol or url is present', () => {
      assert.strictEqual(resolveProtocol({ type: 'csv', connection_config: {} }), null);
      assert.strictEqual(resolveProtocol(null), null);
    });
  });

  describe('fetchSourceStream() execution for CSV sources', () => {
    it('should fetch HTTP stream without throwing "Unsupported source type: csv"', async () => {
      const source = {
        id: 'test-source-id',
        name: 'Test CSV HTTP Source',
        type: 'csv',
        connection_config: { url: 'https://example.com/feed.csv' }
      };

      // Mock global fetch to return a valid CSV stream
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        const readableWebStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('sku,name,price\nSKU1,Test Product,19.99\n'));
            controller.close();
          }
        });
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/csv' }),
          body: readableWebStream
        };
      };

      try {
        const stream = await fetchSourceStream(source);
        assert.ok(stream, 'Expected a readable stream to be returned');
        assert.ok(typeof stream.pipe === 'function', 'Returned object should be a pipeable stream');

        // Read stream data to ensure validity
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString('utf-8');
        assert.ok(text.includes('SKU1,Test Product,19.99'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should throw descriptive error when no transport protocol can be determined', async () => {
      const invalidSource = {
        id: 'invalid-id',
        name: 'Unresolvable Source',
        type: 'csv',
        connection_config: {}
      };

      await assert.rejects(
        async () => {
          await fetchSourceStream(invalidSource);
        },
        /Unable to determine transport protocol/
      );
    });
  });
});
