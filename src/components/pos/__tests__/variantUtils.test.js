import { describe, expect, it } from 'vitest';
import {
  getAvailableVariantBatches,
  hasRealVariantAttributes,
  isAvailableVariantBatch
} from '../variantUtils';

describe('variantUtils', () => {
  it('treats a generic initial-stock batch as non-variant', () => {
    expect(hasRealVariantAttributes({ attributes: null })).toBe(false);
    expect(hasRealVariantAttributes({ attributes: {} })).toBe(false);
    expect(hasRealVariantAttributes({
      attributes: { talla: ' ', color: '', modelo: null, marca: undefined }
    })).toBe(false);
  });

  it('recognizes supported apparel attributes', () => {
    expect(hasRealVariantAttributes({ attributes: { talla: 'M' } })).toBe(true);
    expect(hasRealVariantAttributes({ attributes: { color: 'Negro' } })).toBe(true);
    expect(hasRealVariantAttributes({ attributes: { modelo: 'Runner' } })).toBe(true);
    expect(hasRealVariantAttributes({ attributes: { marca: 'Lanzo' } })).toBe(true);
  });

  it('requires an active variant with available stock', () => {
    expect(isAvailableVariantBatch({
      isActive: true,
      stock: 3,
      attributes: { talla: 'M', color: 'Negro' }
    })).toBe(true);

    expect(isAvailableVariantBatch({
      isActive: false,
      stock: 3,
      attributes: { talla: 'M', color: 'Negro' }
    })).toBe(false);

    expect(isAvailableVariantBatch({
      isActive: true,
      stock: 0,
      attributes: { talla: 'M', color: 'Negro' }
    })).toBe(false);
  });

  it('filters generic UNIT candidates from modal input', () => {
    const batches = getAvailableVariantBatches([
      {
        id: 'generic',
        isActive: true,
        stock: 5,
        attributes: null
      },
      {
        id: 'variant',
        isActive: true,
        stock: 2,
        attributes: { talla: 'L', color: 'Azul' }
      }
    ]);

    expect(batches.map((batch) => batch.id)).toEqual(['variant']);
  });
});
