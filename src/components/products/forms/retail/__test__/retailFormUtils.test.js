import { describe, expect, it } from 'vitest';
import {
  buildBatchManagementConfig,
  buildVariantBatchPayload,
  getTotalVariantStock,
  hasActiveVariantRows,
  mapBatchesToVariantRows,
  normalizeWholesaleTiers
} from '../retailFormUtils';

describe('retailFormUtils', () => {
  it('detects active variants correctly', () => {
    expect(hasActiveVariantRows([])).toBe(false);
    expect(hasActiveVariantRows([{ talla: '', color: '' }])).toBe(false);
    expect(hasActiveVariantRows([{ talla: 'M', color: '' }])).toBe(true);
  });

  it('calculates total variant stock', () => {
    const total = getTotalVariantStock([
      { stock: '2' },
      { stock: 3 },
      { stock: '0.5' }
    ]);
    expect(total).toBe(5.5);
  });

  it('normalizes wholesale tiers into numeric values', () => {
    expect(normalizeWholesaleTiers([{ min: '5', price: '99.5' }])).toEqual([
      { min: 5, price: 99.5 }
    ]);
  });

  it('builds batch management config', () => {
    expect(
      buildBatchManagementConfig({ isApparel: true, hasActiveVariants: true, trackStock: false })
    ).toEqual({ enabled: true, selectionStrategy: 'fifo' });

    expect(
      buildBatchManagementConfig({ isApparel: false, hasActiveVariants: false, trackStock: false })
    ).toEqual({ enabled: false });
  });

  it('maps batches to variant rows', () => {
    const rows = mapBatchesToVariantRows(
      [{ id: 'b1', attributes: { talla: 'M', color: 'Negro' }, stock: 4, cost: 10, price: 20 }],
      0,
      0
    );

    expect(rows).toEqual([
      { id: 'b1', talla: 'M', color: 'Negro', sku: '', stock: 4, cost: 10, price: 20 }
    ]);
  });

  it('builds variant batch payload using provided sku', () => {
    const payload = buildVariantBatchPayload({
      variant: {
        id: 12,
        talla: 'm',
        color: 'Negro',
        stock: '3',
        cost: '11',
        price: '19',
        sku: 'SKU-TEST'
      },
      productId: 'prod-1',
      commonData: { cost: 5, price: 10 }
    });

    expect(payload).toMatchObject({
      productId: 'prod-1',
      stock: 3,
      cost: 11,
      price: 19,
      sku: 'SKU-TEST',
      attributes: { talla: 'M', color: 'Negro' },
      isActive: true,
      trackStock: true
    });
  });
});

