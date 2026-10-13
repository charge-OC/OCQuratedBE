import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'stream';
import iconv from 'iconv-lite';
import { pool } from '../src/db/index.js';
import { ingestCsvStream } from '../src/services/csvParser.js';

describe('CSV Streaming Ingestion Integration Tests (Milestone B1.3)', () => {
  const merchantId = '00000000-0000-0000-0000-000000000001';
  let testSourceId;

  before(async () => {
    // Create a test source record to fulfill foreign key constraints
    const res = await pool.query(
      `INSERT INTO sources (merchant_id, name, protocol, status)
       VALUES ($1, 'Test Stream CSV Source', 'csv', 'ACTIVE')
       RETURNING id`,
      [merchantId]
    );
    testSourceId = res.rows[0].id;
  });

  after(async () => {
    // Clean up test data
    if (testSourceId) {
      await pool.query('DELETE FROM sources WHERE id = $1', [testSourceId]);
    }
    await pool.end();
  });

  it('should process a 1,200-row CSV fixture in chunks of 500 and verify metric balance', async () => {
    // 1. Build a 1,200-row fixture: 700 valid rows and 500 invalid rows
    // Rows 1..600: valid
    // Rows 601..1100: invalid (missing SKU, bad EAN, bad price)
    // Rows 1101..1200: valid
    // + trailing empty lines (which must be skipped without incrementing total_rows)
    const lines = ['sku,name,price,ean,weight'];

    // 600 valid rows
    for (let i = 1; i <= 600; i++) {
      lines.push(`SKU-VAL-${i},Valid Item ${i},"€ 80,56",4006381333931,1300 gram`);
    }

    // 500 invalid rows
    // 200 with missing SKU
    for (let i = 1; i <= 200; i++) {
      lines.push(`,Missing SKU Item ${i},"10.50",4006381333931,500ml`);
    }
    // 150 with invalid EAN checksum
    for (let i = 1; i <= 150; i++) {
      lines.push(`SKU-BADEAN-${i},Bad Barcode Item ${i},"25.00",4006381333932,2.5 kg`);
    }
    // 150 with invalid price
    for (let i = 1; i <= 150; i++) {
      lines.push(`SKU-BADPRICE-${i},Bad Price Item ${i},"corrupted_price",4006381333931,10 m`);
    }

    // 100 valid rows (total valid = 600 + 100 = 700; total invalid = 500)
    for (let i = 601; i <= 700; i++) {
      lines.push(`SKU-VAL-${i},Valid Item ${i},"1.280,56",4006381333931,2.5 kg`);
    }

    // Add trailing empty lines to test empty row skipping
    lines.push('');
    lines.push('   ');
    lines.push('');

    const csvContent = lines.join('\n');
    const stream = Readable.from([csvContent]);

    // 2. Intercept pool.query to observe batch chunking sizes
    const originalQuery = pool.query.bind(pool);
    const normalizedBatchSizes = [];
    const flaggedBatchSizes = [];

    pool.query = async (queryText, values) => {
      if (typeof queryText === 'string') {
        if (queryText.includes('INSERT INTO normalized_records')) {
          // Count placeholders groups: count ($...
          const matches = queryText.match(/\(\$(\d+)/g);
          normalizedBatchSizes.push(matches ? matches.length : 0);
        } else if (queryText.includes('INSERT INTO flagged_records')) {
          const matches = queryText.match(/\(\$(\d+)/g);
          flaggedBatchSizes.push(matches ? matches.length : 0);
        }
      }
      return originalQuery(queryText, values);
    };

    let result;
    try {
      result = await ingestCsvStream(
        stream,
        { id: testSourceId, connection_config: { encoding: 'utf-8', delimiter: ',' } },
        merchantId
      );
    } finally {
      // Restore original pool.query
      pool.query = originalQuery;
    }

    // 3. Verify chunked batch sizes
    // 700 valid rows: first batch of 500, final remaining flush of 200
    assert.deepStrictEqual(normalizedBatchSizes, [500, 200]);
    // 500 invalid rows: flushed as exactly one batch of 500
    assert.deepStrictEqual(flaggedBatchSizes, [500]);

    // 4. Verify returned metrics
    assert.strictEqual(result.totalRows, 1200);
    assert.strictEqual(result.validRows, 700);
    assert.strictEqual(result.failedRows, 500);
    assert.strictEqual(result.totalRows, result.validRows + result.failedRows);

    // 5. Verify ingestion_runs DB record
    const runCheck = await pool.query(
      'SELECT * FROM ingestion_runs WHERE id = $1',
      [result.runId]
    );
    assert.strictEqual(runCheck.rows.length, 1);
    const run = runCheck.rows[0];
    assert.strictEqual(run.status, 'COMPLETED');
    assert.strictEqual(run.total_rows, 1200);
    assert.strictEqual(run.valid_rows, 700);
    assert.strictEqual(run.failed_rows, 500);
    assert.ok(run.finished_at !== null);

    // 6. Verify records correctly link to run_id and merchant_id
    const normCount = await pool.query(
      'SELECT COUNT(*)::int as count FROM normalized_records WHERE run_id = $1 AND merchant_id = $2',
      [result.runId, merchantId]
    );
    assert.strictEqual(normCount.rows[0].count, 700);

    const flagCount = await pool.query(
      'SELECT COUNT(*)::int as count FROM flagged_records WHERE run_id = $1 AND merchant_id = $2',
      [result.runId, merchantId]
    );
    assert.strictEqual(flagCount.rows[0].count, 500);

    // 7. Verify normalized record attributes
    const sampleNorm = await pool.query(
      'SELECT * FROM normalized_records WHERE run_id = $1 AND sku = $2',
      [result.runId, 'SKU-VAL-1']
    );
    assert.strictEqual(sampleNorm.rows.length, 1);
    const normRecord = sampleNorm.rows[0];
    assert.strictEqual(parseFloat(normRecord.price), 80.56);
    assert.strictEqual(normRecord.currency, 'EUR');
    assert.strictEqual(normRecord.ean, '4006381333931');
    assert.strictEqual(parseFloat(normRecord.unit_value), 1300);
    assert.strictEqual(normRecord.unit_type, 'g');
    assert.ok(normRecord.raw_data !== null);

    // 8. Verify flagged record error_reasons
    const sampleFlag = await pool.query(
      'SELECT * FROM flagged_records WHERE run_id = $1 AND row_index = 601',
      [result.runId]
    );
    assert.strictEqual(sampleFlag.rows.length, 1);
    assert.deepStrictEqual(sampleFlag.rows[0].error_reasons, ['MISSING_SKU']);
  });

  it('should support dynamic encoding (windows-1252) and custom delimiters (;)', async () => {
    // Test with windows-1252 encoded characters (e.g. accented letters, euro sign)
    const content = 'sku;name;price\nSKU-W1252;Café Zürich;€ 45,90\n';
    const buffer = iconv.encode(content, 'windows-1252');
    const stream = Readable.from([buffer]);

    const result = await ingestCsvStream(
      stream,
      {
        id: testSourceId,
        connection_config: { encoding: 'windows-1252', delimiter: ';' }
      },
      merchantId
    );

    assert.strictEqual(result.totalRows, 1);
    assert.strictEqual(result.validRows, 1);
    assert.strictEqual(result.failedRows, 0);

    const norm = await pool.query(
      'SELECT * FROM normalized_records WHERE run_id = $1',
      [result.runId]
    );
    assert.strictEqual(norm.rows.length, 1);
    assert.strictEqual(norm.rows[0].name, 'Café Zürich');
    assert.strictEqual(parseFloat(norm.rows[0].price), 45.90);
  });

  it('should transition ingestion_runs to FAILED when an error occurs during parsing', async () => {
    const errorStream = new Readable({
      read() {
        this.destroy(new Error('Simulated upstream network abort'));
      }
    });

    await assert.rejects(
      async () => {
        await ingestCsvStream(
          errorStream,
          { id: testSourceId, connection_config: { encoding: 'utf-8', delimiter: ',' } },
          merchantId
        );
      },
      /Simulated upstream network abort/
    );

    const failedRun = await pool.query(
      'SELECT * FROM ingestion_runs WHERE source_id = $1 AND status = $2 ORDER BY started_at DESC LIMIT 1',
      [testSourceId, 'FAILED']
    );
    assert.strictEqual(failedRun.rows.length, 1);
    assert.strictEqual(failedRun.rows[0].status, 'FAILED');
    assert.ok(failedRun.rows[0].error_message.includes('Simulated upstream network abort'));
  });

  it('should trim header column whitespace and properly parse row fields', async () => {
    const content = '  sku  ,  name  ,  price  \nSKU-TRIM,Trimmed Item,29.99\n';
    const stream = Readable.from([content]);

    const result = await ingestCsvStream(
      stream,
      { id: testSourceId, connection_config: { encoding: 'utf-8', delimiter: ',' } },
      merchantId
    );

    assert.strictEqual(result.totalRows, 1);
    assert.strictEqual(result.validRows, 1);
    assert.strictEqual(result.failedRows, 0);

    const norm = await pool.query(
      'SELECT * FROM normalized_records WHERE run_id = $1',
      [result.runId]
    );
    assert.strictEqual(norm.rows.length, 1);
    assert.strictEqual(norm.rows[0].sku, 'SKU-TRIM');
    assert.strictEqual(norm.rows[0].name, 'Trimmed Item');
    assert.strictEqual(parseFloat(norm.rows[0].price), 29.99);
  });
});
