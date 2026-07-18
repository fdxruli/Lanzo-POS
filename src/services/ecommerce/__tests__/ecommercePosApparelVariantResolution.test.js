import { describe, expect, it, vi } from 'vitest';
import { selectEcommerceVariantBatch } from '../ecommerceApparelVariants';
import {
  applyEcommerceApparelVariantConflicts,
  getEcommerceApparelVariantInventoryMessage,
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

const now = new Date('2026-07-17T12:00:00Z');

const prepare = ({ items, batches }) => prepareEcommerceApparelVariantInventory({
  order: { items },
  products: [product],
  queryBatchesByProduct: vi.fn().mockResolvedValue(batches),
  now
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
      now
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

  it('selects the earliest compatible individual batch with enough stock', async () => {
    const result = await prepare({
      items: [variantItem({ quantity: 2 })],
      batches: [
        batch({ id: 'earlier-insufficient', stock: 1, expiryDate: '2026-07-20' }),
        batch({ id: 'earliest-sufficient', stock: 2, expiryDate: '2026-08-01' }),
        batch({ id: 'later-sufficient', stock: 5, expiryDate: '2026-10-01' })
      ]
    });

    expect(result.order.items[0]).toMatchObject({
      batchId: 'earliest-sufficient',
      inventoryResolution: {
        code: null,
        availableQuantitySnapshot: 2
      }
    });
  });

  it('classifies aggregate compatible stock as MULTI_BATCH_REQUIRED in the direct selector', () => {
    const result = selectEcommerceVariantBatch({
      item: variantItem({ quantity: 2 }),
      product,
      batches: [
        batch({ id: 'black-m-a', stock: 1, expiryDate: '2026-08-01' }),
        batch({ id: 'black-m-b', stock: 1, expiryDate: '2026-09-01' })
      ],
      requiredQuantity: 2,
      now
    });

    expect(result).toMatchObject({
      selectedBatch: null,
      availableStock: 2,
      code: 'MULTI_BATCH_REQUIRED'
    });
  });

  it('persists MULTI_BATCH_REQUIRED when compatible stock is split across batches', async () => {
    const result = await prepare({
      items: [variantItem({ quantity: 2 })],
      batches: [
        batch({ id: 'black-m-a', stock: 1, expiryDate: '2026-08-01' }),
        batch({ id: 'black-m-b', stock: 1, expiryDate: '2026-09-01' })
      ]
    });

    expect(result.order.items[0]).toMatchObject({
      batchId: '__ecommerce_variant_conflict__',
      ecommerceVariantResolutionConflict: {
        code: 'MULTI_BATCH_REQUIRED',
        availableQuantitySnapshot: 2
      },
      inventoryResolution: {
        code: 'MULTI_BATCH_REQUIRED',
        availableQuantitySnapshot: 2
      }
    });
  });

  it('keeps insufficient stock when aggregate compatible stock does not reach the request', async () => {
    const result = await prepare({
      items: [variantItem({ quantity: 2 })],
      batches: [
        batch({ id: 'black-m-a', stock: 1 }),
        batch({ id: 'black-m-b', stock: 0.5 })
      ]
    });

    expect(result.order.items[0]).toMatchObject({
      ecommerceVariantResolutionConflict: {
        code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT',
        availableQuantitySnapshot: 1.5
      }
    });
  });

  it('does not count stock from another variant in the aggregate snapshot', async () => {
    const result = await prepare({
      items: [variantItem({ quantity: 2 })],
      batches: [
        batch({ id: 'black-m', stock: 1 }),
        batch({
          id: 'blue-m',
          stock: 10,
          sku: 'POLO-AZU-M',
          attributes: { color: 'Azul', talla: 'M' }
        })
      ]
    });

    expect(result.order.items[0]).toMatchObject({
      ecommerceVariantResolutionConflict: {
        code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT',
        availableQuantitySnapshot: 1
      }
    });
  });

  it('uses FEFO only inside the selected SKU', async () => {
    const result = await prepare({
      items: [variantItem()],
      batches: [
        batch({ id: 'later', stock: 5, expiryDate: '2026-10-01' }),
        batch({ id: 'earlier', stock: 2, expiryDate: '2026-08-01' }),
        batch({
          id: 'wrong-earliest',
          stock: 10,
          sku: 'POLO-AZU-M',
          expiryDate: '2026-07-20',
          attributes: { color: 'Azul', talla: 'M' }
        })
      ]
    });

    expect(result.order.items[0].batchId).toBe('earlier');
  });

  it('uses only ledger stock remaining after a repeated line', async () => {
    const result = await prepare({
      items: [
        variantItem({ ecommerceOrderItemId: 'line-1', quantity: 1 }),
        variantItem({ ecommerceOrderItemId: 'line-2', quantity: 2 })
      ],
      batches: [
        batch({ id: 'black-m-a', stock: 2, expiryDate: '2026-08-01' }),
        batch({ id: 'black-m-b', stock: 1, expiryDate: '2026-09-01' })
      ]
    });

    expect(result.order.items[0].batchId).toBe('black-m-a');
    expect(result.order.items[1]).toMatchObject({
      batchId: '__ecommerce_variant_conflict__',
      ecommerceVariantResolutionConflict: {
        code: 'MULTI_BATCH_REQUIRED',
        availableQuantitySnapshot: 2
      }
    });
  });

  it('accounts for repeated lines before assigning the same physical stock', async () => {
    const result = await prepare({
      items: [
        variantItem({ ecommerceOrderItemId: 'line-1', quantity: 1 }),
        variantItem({ ecommerceOrderItemId: 'line-2', quantity: 1 })
      ],
      batches: [batch({ id: 'only-one', stock: 1 })]
    });

    expect(result.order.items[0].batchId).toBe('only-one');
    expect(result.order.items[1]).toMatchObject({
      batchId: '__ecommerce_variant_conflict__',
      ecommerceVariantResolutionConflict: {
        code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT',
        availableQuantitySnapshot: 0
      }
    });
  });

  it('never falls back to another color when the purchased SKU is missing', async () => {
    const result = await prepare({
      items: [variantItem()],
      batches: [
        batch({ id: 'blue', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } })
      ]
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

    const result = applyEcommerceApparelVariantConflicts({ order: prepared, now });

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

  it('uses distinct operator messages for split and insufficient variant stock', () => {
    expect(getEcommerceApparelVariantInventoryMessage({
      inventoryResolution: { code: 'MULTI_BATCH_REQUIRED' }
    })).toBe(
      'La variante tiene stock suficiente, pero esta repartido entre varios lotes y requiere resolucion manual.'
    );
    expect(getEcommerceApparelVariantInventoryMessage({
      inventoryResolution: { code: 'ECOMMERCE_VARIANT_STOCK_INSUFFICIENT' }
    })).toBe('No hay stock suficiente de la talla y color comprados.');
  });
});
