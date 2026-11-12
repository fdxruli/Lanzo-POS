import { describe, expect, it } from 'vitest';
import {
  getAvailableVariantBatches,
  getVisibleVariantBatches,
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

describe('Apartados Apparel en selector de tallas', () => {
  it('permite visualizar M disponible y L comprometida sin intercambiar sus inventarios', () => {
    const batches = [
      { id: 'M', isActive: true, stock: 5, committedStock: 2, attributes: { talla: 'M' } },
      { id: 'L', isActive: true, stock: 4, committedStock: 4, attributes: { talla: 'L' } },
      { id: 'generic', isActive: true, stock: 3, committedStock: 3 },
      { id: 'inactive', isActive: false, stock: 3, committedStock: 3, attributes: { talla: 'XL' } }
    ];
    expect(getAvailableVariantBatches(batches).map((batch) => batch.id)).toEqual(['M']);
    expect(getVisibleVariantBatches(batches).map((batch) => batch.id)).toEqual(['M', 'L']);
  });
});
