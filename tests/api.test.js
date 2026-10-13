import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { pool } from '../src/db/index.js';
import sourceRouter from '../src/routes/sources.js';

describe('Source API Endpoints & Security (Milestone B1 Fixes)', () => {
  let app;
  let server;
  let baseUrl;
  const merchantA = '00000000-0000-0000-0000-000000000001';
  const merchantB = '00000000-0000-0000-0000-000000000002';
  const validApiKey = 'qurated_dev_api_key_2026';
  let createdSourceId;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/sources', sourceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/sources`;
        resolve();
      });
    });
  });

  after(async () => {
    if (createdSourceId) {
      await pool.query('DELETE FROM sources WHERE id = $1', [createdSourceId]);
    }
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  it('GET /api/sources should reject requests missing an API key with 401 Unauthorized', async () => {
    // this will make sure its safe: rejecting unauthenticated callers
    const res = await fetch(baseUrl, {
      headers: { 'x-merchant-id': merchantA }
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'));
  });

  it('POST /api/sources should reject SSRF attempts with local file or private IP URLs', async () => {
    // this will make sure its safe: blocking local files and private IPs
    const privateIpPayload = {
      name: 'Malicious Source',
      type: 'csv',
      connection_config: { url: 'http://127.0.0.1:8080/internal.csv' }
    };

    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantA,
        'x-api-key': validApiKey
      },
      body: JSON.stringify(privateIpPayload)
    });
    assert.strictEqual(res1.status, 400);

    const filePayload = {
      name: 'File Scheme Source',
      type: 'csv',
      connection_config: { url: 'file:///etc/passwd' }
    };

    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantA,
        'x-api-key': validApiKey
      },
      body: JSON.stringify(filePayload)
    });
    assert.strictEqual(res2.status, 400);
  });

  it('POST /api/sources should mask sensitive credentials in 201 response and store protocol', async () => {
    // this is what sander asked: keeping format and protocol strictly separate
    const payload = {
      name: 'Hardware Supplier API Test',
      type: 'csv',
      protocol: 'HTTP',
      default_model_id: 'google/gemini-flash-1.5',
      connection_config: {
        url: 'https://example.com/products.csv',
        password: 'my_super_secret_password',
        api_key: 'sk_live_1234567890',
        token: 'auth_bearer_token_xyz'
      },
      schedule_cron: '0 4 * * *'
    };

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantA,
        'x-api-key': validApiKey
      },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    createdSourceId = data.id;

    assert.ok(data.id, 'Expected source ID in response');
    assert.strictEqual(data.name, payload.name);
    assert.strictEqual(data.type, 'csv');
    assert.strictEqual(data.protocol, 'HTTP');
    // this will make sure its safe: masking credentials in response
    assert.strictEqual(data.connection_config.password, '********');
    assert.strictEqual(data.connection_config.api_key, '********');
    assert.strictEqual(data.connection_config.token, '********');
  });

  it('GET /api/sources/:id should mask sensitive credentials in 200 response with Bearer auth', async () => {
    const res = await fetch(`${baseUrl}/${createdSourceId}`, {
      headers: {
        'x-merchant-id': merchantA,
        'Authorization': `Bearer ${validApiKey}`
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, createdSourceId);
    assert.strictEqual(data.connection_config.password, '********');
    assert.strictEqual(data.connection_config.api_key, '********');
    assert.strictEqual(data.connection_config.token, '********');
  });

  it('GET /api/sources/:id should enforce multi-tenant isolation (404 for different merchant)', async () => {
    const res = await fetch(`${baseUrl}/${createdSourceId}`, {
      headers: {
        'x-merchant-id': merchantB,
        'x-api-key': validApiKey
      }
    });

    assert.strictEqual(res.status, 404);
  });

  it('PUT /api/sources/:id should mask sensitive credentials in 200 response', async () => {
    const updatePayload = {
      name: 'Hardware Supplier API Test (Renamed)',
      connection_config: {
        url: 'https://example.com/updated.csv',
        password: 'another_secret_password'
      }
    };

    const res = await fetch(`${baseUrl}/${createdSourceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-merchant-id': merchantA,
        'x-api-key': validApiKey
      },
      body: JSON.stringify(updatePayload)
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.name, 'Hardware Supplier API Test (Renamed)');
    assert.strictEqual(data.connection_config.password, '********');
  });

  it('DELETE /api/sources/:id should perform soft delete (status ARCHIVED)', async () => {
    const res = await fetch(`${baseUrl}/${createdSourceId}`, {
      method: 'DELETE',
      headers: {
        'x-merchant-id': merchantA,
        'x-api-key': validApiKey
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'deleted');

    // Verify row still exists in DB as ARCHIVED
    const dbCheck = await pool.query('SELECT status, archived_at FROM sources WHERE id = $1', [createdSourceId]);
    assert.strictEqual(dbCheck.rows.length, 1);
    assert.strictEqual(dbCheck.rows[0].status, 'ARCHIVED');
    assert.ok(dbCheck.rows[0].archived_at !== null);
  });
});
