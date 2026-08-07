import { describe, expect, it } from 'vitest';
import { buildApparelVariantDelta } from '../buildApparelVariantDelta';

const original = [
  { id: 'batch-m', serverVersion: 1, talla: 'M', color: 'Negro', sku: 'SKU-A', stock: 4, cost: 10, price: 20 },
  { id: 'batch-g', serverVersion: 3, talla: 'G', color: 'Negro', sku: 'SKU-G', stock: 5, cost: 10, price: 20 }
];

describe('buildApparelVariantDelta', () => {
  it('uses stable ids rather than row order and only marks changed catalog fields', () => {
    const delta = buildApparelVariantDelta(original, [
      { ...original[1] },
      { ...original[0], sku: 'SKU-B', stock: 999 },
      { id: 'batch-ch', talla: 'CH', color: 'Negro', sku: 'SKU-CH', stock: 2, cost: 10, price: 20 }
    ]);

    expect(delta.unchanged.map((row) => row.id)).toEqual(['batch-g']);
    expect(delta.updated).toMatchObject([{ id: 'batch-m', sku: 'SKU-B', existingBatch: { serverVersion: 1 } }]);
    expect(delta.created.map((row) => row.id)).toEqual(['batch-ch']);
    expect(delta.removed).toEqual([]);
  });

  it('classifies removed batches without recreating retained ones', () => {
    const delta = buildApparelVariantDelta(original, [{ ...original[0] }]);
    expect(delta.unchanged.map((row) => row.id)).toEqual(['batch-m']);
    expect(delta.updated).toEqual([]);
    expect(delta.created).toEqual([]);
    expect(delta.removed).toMatchObject([{ id: 'batch-g', serverVersion: 3 }]);
  });
});
