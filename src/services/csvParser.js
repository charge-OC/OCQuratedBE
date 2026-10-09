import { pool } from '../db/index.js';
import iconv from 'iconv-lite';
import csv from 'csv-parser';

/**
 * Validates an EAN-13 or UPC-12 barcode.
 * Pads 12-digit UPCs with a leading zero.
 * @param {string} ean 
 * @returns {boolean}
 */
export function isValidEan(ean) {
  if (!ean) return false;
  let code = ean.replace(/[^0-9]/g, '');
  if (code.length === 12) {
    code = '0' + code; // Pad UPC to EAN-13
  }
  if (code.length !== 13) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(code[i], 10);
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(code[12], 10);
}

/**
 * Normalizes European prices into standard floats.
 * Handles "€ 80,56", "1.299,50", "80.56".
 * @param {string|number} priceStr 
 * @returns {number|null}
 */
export function normalizePrice(priceStr) {
  if (priceStr === null || priceStr === undefined) return null;
  if (typeof priceStr === 'number') return priceStr;
  
  let str = priceStr.toString().trim();
  if (!str) return null;

  // Detect European format: if it contains a comma.
  // In EU, dot is often thousand separator: 1.299,50 -> 1299.50
  if (str.includes(',')) {
    // Remove dots (thousand separators) and replace comma with dot
    str = str.replace(/\./g, '').replace(',', '.');
  }

  // Remove everything except numbers, dot, and minus sign
  str = str.replace(/[^0-9.-]/g, '');
  const val = parseFloat(str);
  return isNaN(val) ? null : val;
}

/**
 * Detects and extracts embedded units.
 * "1300 gram" -> value: 1300, unit: "g"
 * @param {string} text 
 * @returns {Object} { value, unit } or null
 */
export function extractUnit(text) {
  if (!text) return null;
  const match = text.toString().match(/^([\d.,]+)\s*(gram|g|kg|ml|l|cm|mm|m)$/i);
  if (match) {
    let val = normalizePrice(match[1]); // Reuse number normalizer
    let unit = match[2].toLowerCase();
    if (unit === 'gram') unit = 'g';
    return { value: val, unit };
  }
  return null;
}

/**
 * Ingests a CSV stream, normalizes it, and saves it to the DB in chunks.
 * 
 * @param {import('stream').Readable} stream The raw data stream
 * @param {Object} source The source DB record
 * @param {string} merchantId The merchant UUID
 * @param {string} runId The ingestion run UUID
 * @returns {Promise<Object>} Statistics about the ingestion
 */
export async function ingestCsvStream(stream, source, merchantId, runId) {
  const config = source.connection_config || {};
  const encoding = config.encoding || 'utf-8';
  const delimiter = config.delimiter || ',';
  const skipRows = config.skip_rows ? parseInt(config.skip_rows, 10) : 0;

  let totalRows = 0;
  let validRowsCount = 0;
  let failedRowsCount = 0;

  let normalizedBuffer = [];
  let flaggedBuffer = [];

  const BATCH_SIZE = 500;

  // Flush normal records
  const flushNormalized = async () => {
    if (normalizedBuffer.length === 0) return;
    const batch = [...normalizedBuffer];
    normalizedBuffer = [];

    // Construct bulk insert parameterized query
    let query = `INSERT INTO normalized_records (run_id, merchant_id, sku, name, price, ean, attributes) VALUES `;
    let values = [];
    let placeholders = [];
    
    let paramIndex = 1;
    for (const rec of batch) {
      placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      values.push(runId, merchantId, rec.sku, rec.name, rec.price, rec.ean, rec.attributes);
    }
    
    query += placeholders.join(', ');
    await pool.query(query, values);
  };

  // Flush flagged records
  const flushFlagged = async () => {
    if (flaggedBuffer.length === 0) return;
    const batch = [...flaggedBuffer];
    flaggedBuffer = [];

    let query = `INSERT INTO flagged_records (run_id, row_index, raw_row, error_reasons) VALUES `;
    let values = [];
    let placeholders = [];
    
    let paramIndex = 1;
    for (const rec of batch) {
      placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      values.push(runId, rec.rowIndex, JSON.stringify(rec.rawRow), JSON.stringify(rec.reasons));
    }
    
    query += placeholders.join(', ');
    await pool.query(query, values);
  };

  return new Promise((resolve, reject) => {
    let skipped = 0;

    const pipeline = stream
      // Decoding (iconv-lite handles streams elegantly)
      .pipe(iconv.decodeStream(encoding))
      // CSV Parsing
      .pipe(csv({ separator: delimiter, skipLines: skipRows }));

    pipeline.on('data', async (row) => {
      // Scenario 2: Strict Ingestion Run Metrics Consistency
      // Ignore completely empty rows so they don't incorrectly inflate the read count
      const hasData = Object.values(row).some(v => v !== null && v !== undefined && v.toString().trim() !== '');
      if (!hasData) return;

      totalRows++;
      pipeline.pause(); // Pause stream to handle async DB insert without flooding memory

      try {
        let reasons = [];
        
        // 1. SKU Check
        let sku = row.sku || row.artikel_nr || row.id || '';
        sku = sku.toString().trim();
        if (!sku) {
          reasons.push("MISSING_SKU");
        }

        // 2. EAN Check
        let ean = row.ean || row.barcode || '';
        ean = ean.toString().trim();
        if (ean && !isValidEan(ean)) {
          reasons.push("INVALID_EAN_CHECKSUM");
        }

        // 3. Price Normalization
        let price = normalizePrice(row.price || row.prijs_excl || null);

        // 4. Name extraction
        let name = row.name || row.omschrijving || row.title || '';

        // 5. Embedded units check
        let attributes = {};
        const weightText = row.weight || row.gewicht || '';
        const unitData = extractUnit(weightText);
        if (unitData) {
          attributes.weight_value = unitData.value;
          attributes.weight_unit = unitData.unit;
        }

        // Route to appropriate buffer
        if (reasons.length > 0) {
          failedRowsCount++;
          flaggedBuffer.push({
            rowIndex: totalRows,
            rawRow: row,
            reasons: reasons
          });
        } else {
          validRowsCount++;
          normalizedBuffer.push({
            sku,
            name,
            price,
            ean: ean || null,
            attributes
          });
        }

        // Batch flushing
        if (normalizedBuffer.length >= BATCH_SIZE) {
          await flushNormalized();
        }
        if (flaggedBuffer.length >= BATCH_SIZE) {
          await flushFlagged();
        }

      } catch (err) {
        console.error("Error processing row:", err);
      } finally {
        pipeline.resume();
      }
    });

    pipeline.on('end', async () => {
      try {
        // Flush remaining records
        await flushNormalized();
        await flushFlagged();

        resolve({ totalRows, validRows: validRowsCount, failedRows: failedRowsCount });
      } catch (err) {
        reject(err);
      }
    });

    pipeline.on('error', async (err) => {
      reject(err);
    });
  });
}
