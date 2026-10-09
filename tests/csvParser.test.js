import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizePrice } from '../src/services/csvParser.js';

describe('Price Normalization (Task 0)', () => {
  it('should parse simple European comma decimals', () => {
    assert.strictEqual(normalizePrice('80,56'), 80.56);
    assert.strictEqual(normalizePrice('€ 80,56'), 80.56);
  });

  it('should parse European thousands separators and comma decimals', () => {
    assert.strictEqual(normalizePrice('1.280,56'), 1280.56);
    assert.strictEqual(normalizePrice('€ 1.280,56'), 1280.56);
  });

  it('should parse standard US dot decimals correctly without modification', () => {
    assert.strictEqual(normalizePrice('80.56'), 80.56);
    assert.strictEqual(normalizePrice('1280.56'), 1280.56);
  });
});
