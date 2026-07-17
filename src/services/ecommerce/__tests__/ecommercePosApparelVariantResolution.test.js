import { describe, expect, it, vi } from 'vitest';
import {
  applyEcommerceApparelVariantConflicts,
  prepareEcommerceApparelVariantInventory
} from '../ecommercePosApparelVariantResolution';

const product = {
  id: 'product-polo',
  name: 'Camisa polo',
  price: 299,
  trackStock: true,
  expirationMode: 'BATCH',
  batchManagement: { enabled: true }
};

const variantItem = (overrides = {}) => ({
  id: product.id,
  parentId: product.id,
  quantity: 1,
  ecommerceOrderItemId: overrides.ecommerceOrderItemId || 'order-item-1',
  ecommerceOptions: {
    variant: {
      sourceVariantRef: 'sku:POLO-NEG-M',
      sku: 'POLO-NEG-M',
      optionValues: { color: 'Negro', talla: 'M' }
    }
  },
  ...overrides
});

const batch = (overrides = {}) => ({
  id: overrides.id || 'batch-black-m',
  productId: product.id,
  isActive: true,
  stock: 2,
  committedStock: 0,
  sku: 'POLO-NEG-M',
  expiryDate: '2026-09-01',
  attributes: { color: 'Negro', talla: 'M' },
  ...overrides
});

describe('ecommerce POS apparel variant resolution', () => {
  it('selects only a compatible batch and preserves commercial identity', async () => {
    const query = vi.fn().mockResolvedValue([
      batch({ id: 'blue-m', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } }),
      batch({ id: 'black-s', sku: 'POLO-NEG-S', attributes: { color: 'Negro', talla: 'S' } }),
      batch({ id: 'black-m' })
    ]);

    const result = await prepareEcommerceApparelVariantInventory({
      order: { items: [variantItem()] },
      products: [product],
      queryBatchesByProduct: query,
      now: new Date('2026-07-17T12:00:00Z')
    });

    expect(result.changed).toBe(true);
    expect(result.order.items[0]).toMatchObject({
      batchId: 'black-m',
      sku: 'POLO-NEG-M',
      variantAttributes: { color: 'Negro', talla: 'M' },
      inventoryResolution: {
        status: 'pending',
        selectionMode: 'manual_pending'
      }
    });
  });

  it('uses FEFO only inside the selected SKU', async () => {
    const result = await prepareEcommerceApparelVariantInventory({
      order: { items: [variantItem()] },
      products: [product],
      queryBatchesByProduct: vi.fn().mockResolvedValue([
        batch({ id: 'later', expiryDate: '2026-10-01' }),
        batch({ id: 'earlier', expiryDate: '2026-08-01' }),
        batch({
          id: 'wrong-earliest',
          sku: 'POLO-AZU-M',
          expiryDate: '2026-07-20',
          attributes: { color: 'Azul', talla: 'M' }
        })
      ]),
      now: new Date('2026-07-17T12:00:00Z')
    });

    expect(result.order.items[0].batchId).toBe('earlier');
  });

  it('accounts for repeated lines before assigning the same physical stock', async () => {
    const result = await prepareEcommerceApparelVariantInventory({
      order: {
        items: [
          variantItem({ ecommerceOrderItemId: 'line-1', quantity: 1 }),
          variantItem({ ecommerceOrderItemId: 'line-2', quantity: 1 })
        ]
      },
      products: [product],
      queryBatchesByProduct: vi.fn().mockResolvedValue([batch({ id: 'only-one', stock: 1 })]),
      now: new Date('2026-07-17T12:00:00Z')
    });

    expect(result.order.items[0].batchId).toBe('only-one');
    expect(result.order.items[1]).toMatchObject({
      batchId: '__ecommerce_variant_conflict__',
      ecommerceVariantResolutionConflict: {
        code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT'
      }
    });
  });

  it('never falls back to another color when the purchased SKU is missing', async () => {
    const result = await prepareEcommerceApparelVariantInventory({
      order: { items: [variantItem()] },
      products: [product],
      queryBatchesByProduct: vi.fn().mockResolvedValue([
        batch({ id: 'blue', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } })
      ]),
      now: new Date('2026-07-17T12:00:00Z')
    });

    expect(result.order.items[0]).toMatchObject({
      batchId: '__ecommerce_variant_conflict__',
      ecommerceVariantResolutionConflict: {
        code: 'ECOMMERCE_VARIANT_LOCAL_MAPPING_MISSING'
      }
    });
  });

  it('converts a blocked sentinel into an actionable inventory conflict', () => {
    const prepared = {
      items: [{
        ...variantItem(),
        batchId: '__ecommerce_variant_conflict__',
        ecommerceVariantResolutionConflict: {
          code: 'ECOMMERCE_VARIANT_SELECTION_STALE',
          availableQuantitySnapshot: 0,
          selection: {
            sourceVariantRef: 'sku:POLO-NEG-M',
            sku: 'POLO-NEG-M',
            optionValues: { color: 'Negro', talla: 'M' }
          }
        },
        inventoryResolution: { status: 'conflict', code: 'BATCH_STALE' }
      }],
      ecommerceInventoryStatus: 'conflict',
      ecommerceInventoryConflictCount: 1
    };

    const result = applyEcommerceApparelVariantConflicts({
      order: prepared,
      now: new Date('2026-07-17T12:00:00Z')
    });

    expect(result.items[0]).toMatchObject({
      batchId: undefined,
      needsInventoryResolution: true,
      inventoryResolution: {
        status: 'conflict',
        code: 'ECOMMERCE_VARIANT_SELECTION_STALE',
        selectionMode: 'variant_exact'
      }
    });
    expect(result.items[0].ecommerceVariantResolutionConflict).toBeUndefined();
  });
});
