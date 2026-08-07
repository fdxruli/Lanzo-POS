import { describe, expect, it } from 'vitest';
import { buildApparelVariantDelta, rebaseApparelVariantSnapshot } from '../buildApparelVariantDelta';

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

  it('rebases a partial update so retry sends only the failed variant', () => {
    const before = [
      { id: 'batch-a', serverVersion: 1, talla: 'M', color: 'Negro', sku: 'SKU-A', cost: 10, price: 20 },
      { id: 'batch-b', serverVersion: 1, talla: 'G', color: 'Negro', sku: 'SKU-B', cost: 10, price: 20 }
    ];
    const next = [
      { ...before[0], sku: 'SKU-A2' },
      { ...before[1], sku: 'SKU-B2' }
    ];

    const rebased = rebaseApparelVariantSnapshot(before, next, {
      updated: [{
        variant: next[0],
        result: { response: { batch: { id: 'batch-a', server_version: 2, attributes: { talla: 'M', color: 'Negro' }, sku: 'SKU-A2', cost: 10, price: 20 } } }
      }]
    });
    const retry = buildApparelVariantDelta(rebased, next);

    expect(retry.updated).toMatchObject([{ id: 'batch-b', existingBatch: { serverVersion: 1 } }]);
    expect(retry.updated.map((variant) => variant.id)).not.toContain('batch-a');
    expect(rebased.find((variant) => variant.id === 'batch-a')).toMatchObject({ serverVersion: 2, sku: 'SKU-A2' });
  });

  it('keeps a failed created variant pending after an updated variant succeeds', () => {
    const before = [{ id: 'batch-a', serverVersion: 1, talla: 'M', color: 'Negro', sku: 'SKU-A', cost: 10, price: 20 }];
    const next = [
      { ...before[0], sku: 'SKU-A2' },
      { id: 'batch-c', talla: 'CH', color: 'Negro', sku: 'SKU-C', cost: 10, price: 20 }
    ];

    const rebased = rebaseApparelVariantSnapshot(before, next, {
      updated: [{
        variant: next[0],
        result: { response: { batch: { id: 'batch-a', server_version: 2, attributes: { talla: 'M', color: 'Negro' } } } }
      }]
    });
    const retry = buildApparelVariantDelta(rebased, next);

    expect(retry.updated).toEqual([]);
    expect(retry.created).toMatchObject([{ id: 'batch-c', sku: 'SKU-C' }]);
  });

  it('keeps a failed removal pending after an updated variant succeeds', () => {
    const before = [
      { id: 'batch-a', serverVersion: 1, talla: 'M', color: 'Negro', sku: 'SKU-A', cost: 10, price: 20 },
      { id: 'batch-b', serverVersion: 1, talla: 'G', color: 'Negro', sku: 'SKU-B', cost: 10, price: 20 }
    ];
    const next = [{ ...before[0], sku: 'SKU-A2' }];

    const rebased = rebaseApparelVariantSnapshot(before, next, {
      updated: [{
        variant: next[0],
        result: { response: { batch: { id: 'batch-a', server_version: 2, attributes: { talla: 'M', color: 'Negro' } } } }
      }]
    });
    const retry = buildApparelVariantDelta(rebased, next);

    expect(retry.updated).toEqual([]);
    expect(retry.removed).toMatchObject([{ id: 'batch-b', serverVersion: 1 }]);
  });
});
