import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizePrice,
  extractUnit,
  isValidEan,
  normalizeRow
} from '../src/services/normalizer.js';

describe('Normalizer Unit Tests (B1.3-T3)', () => {
  describe('European & US Price Normalization', () => {
    it('should parse European comma decimals and currency symbols', () => {
      assert.strictEqual(normalizePrice('€ 80,56'), 80.56);
      assert.strictEqual(normalizePrice('80,56'), 80.56);
      assert.strictEqual(normalizePrice('1.280,56'), 1280.56);
      assert.strictEqual(normalizePrice('€ 1.280,56'), 1280.56);
    });

    it('should parse standard US dot formatting without modification', () => {
      assert.strictEqual(normalizePrice('80.56'), 80.56);
      assert.strictEqual(normalizePrice('1280.56'), 1280.56);
      assert.strictEqual(normalizePrice('$ 1,280.56'), 1280.56);
      assert.strictEqual(normalizePrice(80.56), 80.56);
    });

    it('should return null for unparseable or corrupted price strings', () => {
      assert.strictEqual(normalizePrice('invalid'), null);
      assert.strictEqual(normalizePrice('€ abc'), null);
      assert.strictEqual(normalizePrice('12.34.56'), null);
      assert.strictEqual(normalizePrice(''), null);
      assert.strictEqual(normalizePrice(null), null);
    });
  });

  describe('Embedded Unit Extraction', () => {
    it('should parse composite strings into value and unit', () => {
      assert.deepStrictEqual(extractUnit('1300 gram'), { value: 1300, unit: 'g' });
      assert.deepStrictEqual(extractUnit('2.5 kg'), { value: 2.5, unit: 'kg' });
      assert.deepStrictEqual(extractUnit('500ml'), { value: 500, unit: 'ml' });
      assert.deepStrictEqual(extractUnit('10 m'), { value: 10, unit: 'm' });
    });

    it('should handle European comma decimals in composite units', () => {
      assert.deepStrictEqual(extractUnit('2,5 kg'), { value: 2.5, unit: 'kg' });
      assert.deepStrictEqual(extractUnit('1,5 l'), { value: 1.5, unit: 'l' });
    });

    it('should return null for invalid or non-unit strings', () => {
      assert.strictEqual(extractUnit(''), null);
      assert.strictEqual(extractUnit(null), null);
      assert.strictEqual(extractUnit('random text'), null);
    });
  });

  describe('Modulo-10 EAN-13 and UPC-12 Checksums', () => {
    it('should validate valid 13-digit EAN barcodes', () => {
      // 4006381333931 (STABILO Boss)
      assert.strictEqual(isValidEan('4006381333931'), true);
      // 73513537 (short) - false
      assert.strictEqual(isValidEan('73513537'), false);
    });

    it('should validate valid 12-digit UPC barcodes by padding with 0', () => {
      // 012345678905 (standard valid UPC-12)
      assert.strictEqual(isValidEan('012345678905'), true);
    });

    it('should reject invalid checksums', () => {
      // Wrong check digit for EAN-13
      assert.strictEqual(isValidEan('4006381333932'), false);
      // Wrong check digit for UPC-12
      assert.strictEqual(isValidEan('012345678906'), false);
    });

    it('should reject non-numeric or malformed barcodes', () => {
      assert.strictEqual(isValidEan(''), false);
      assert.strictEqual(isValidEan(null), false);
      assert.strictEqual(isValidEan('400638133393A'), false);
      assert.strictEqual(isValidEan('12345'), false);
    });
  });

  describe('Row Normalization & Triage Rules', () => {
    it('should identify missing or whitespace SKUs', () => {
      const res1 = normalizeRow({ name: 'Product Without SKU', price: '10.00' });
      assert.strictEqual(res1.isValid, false);
      assert.ok(res1.reasons.includes('MISSING_SKU'));

      const res2 = normalizeRow({ sku: '   ', name: 'Empty SKU', price: '10.00' });
      assert.strictEqual(res2.isValid, false);
      assert.ok(res2.reasons.includes('MISSING_SKU'));
    });

    it('should pass valid rows and normalize price, EAN, and units', () => {
      const row = {
        sku: 'SKU-001',
        name: 'Hammer',
        price: '€ 1.280,56',
        ean: '4006381333931',
        weight: '1300 gram'
      };
      const res = normalizeRow(row);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.reasons.length, 0);
      assert.strictEqual(res.normalized.sku, 'SKU-001');
      assert.strictEqual(res.normalized.name, 'Hammer');
      assert.strictEqual(res.normalized.price, 1280.56);
      assert.strictEqual(res.normalized.currency, 'EUR');
      assert.strictEqual(res.normalized.ean, '4006381333931');
      assert.strictEqual(res.normalized.unit_value, 1300);
      assert.strictEqual(res.normalized.unit_type, 'g');
    });

    it('should flag corrupt EAN and unparseable price while keeping valid SKU', () => {
      const row = {
        sku: 'SKU-002',
        name: 'Bad Barcode & Price',
        price: 'unparseable',
        ean: '4006381333932'
      };
      const res = normalizeRow(row);
      assert.strictEqual(res.isValid, false);
      assert.ok(res.reasons.includes('INVALID_EAN_CHECKSUM'));
      assert.ok(res.reasons.includes('INVALID_PRICE'));
    });

    it('should not flag row if EAN is simply omitted', () => {
      const row = {
        sku: 'SKU-003',
        name: 'No Barcode',
        price: '25.00'
      };
      const res = normalizeRow(row);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.normalized.ean, null);
    });
  });
});
