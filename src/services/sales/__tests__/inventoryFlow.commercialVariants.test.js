import { describe, expect, it } from 'vitest';
import { collectBatchRestorations, restoreBatchStock } from '../batchRestoration';
import { buildProcessedItemsAndDeductions } from '../inventoryFlow';

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const makeBatch = (id, productId, stock, createdAt, attributes = {}) => ({
  id,
  productId,
  stock,
  committedStock: 0,
  cost: 4,
  isActive: true,
  status: 'active',
  createdAt,
  attributes
});

const makeApparel = (overrides = {}) => ({
  id: 'shirt',
  name: 'Playera básica',
  trackStock: true,
  batchManagement: { enabled: true, selectionStrategy: 'fifo' },
  hasVariants: true,
  rubroContext: 'apparel',
  ...overrides
});

const makeVariantLine = (batchId, quantity, lineId = batchId) => ({
  id: 'shirt',
  parentId: 'shirt',
  name: `Playera básica (${batchId})`,
  isVariant: true,
  batchId,
  lineId,
  quantity,
  price: 12
});

const build = ({ product, items, batches }) => buildProcessedItemsAndDeductions({
  itemsToProcess: items,
  allProducts: Array.isArray(product) ? product : [product],
  batchesMap: new Map(Object.entries(batches)),
  roundCurrency
});

describe('inventoryFlow commercial apparel variants', () => {
  const apparelBatches = () => [
    makeBatch('s-black', 'shirt', 3, '2026-11-01', { talla: 'S', color: 'Negro' }),
    makeBatch('m-black', 'shirt', 5, '2026-11-02', { talla: 'M', color: 'Negro' }),
    makeBatch('m-blue', 'shirt', 4, '2026-11-03', { talla: 'M', color: 'Azul' })
  ];

  it('deducts two units from the selected size/color and records the same batch for cancellation', () => {
    const batches = apparelBatches();
    const { processedItems, batchesToDeduct } = build({
      product: makeApparel(),
      items: [makeVariantLine('m-black', 2)],
      batches: { shirt: batches }
    });

    expect(batchesToDeduct).toEqual([{
      batchId: 'm-black',
      quantity: 2,
      productId: 'shirt',
      fromCommittedStock: false
    }]);
    expect(processedItems[0].batchesUsed).toMatchObject([
      { batchId: 'm-black', ingredientId: 'shirt', quantity: 2 }
    ]);
    expect(processedItems[0].stockDeducted).toBe(2);

    const afterSale = batches.map((batch) => ({
      ...batch,
      stock: batch.stock - batchesToDeduct
        .filter((deduction) => deduction.batchId === batch.id)
        .reduce((sum, deduction) => sum + deduction.quantity, 0)
    }));
    expect(afterSale.map((batch) => batch.stock)).toEqual([3, 3, 4]);
    expect(afterSale.reduce((sum, batch) => sum + batch.stock, 0)).toBe(10);

    const restorations = collectBatchRestorations(processedItems);
    expect([...restorations.keys()]).toEqual(['m-black']);
    const restored = restoreBatchStock({
      batch: afterSale.find((batch) => batch.id === 'm-black'),
      restoration: restorations.get('m-black'),
      normalizeStock: Number,
      updatedAt: '2026-11-17T00:00:00.000Z'
    });
    expect(restored.updatedBatch.stock).toBe(5);
    const afterCancellation = afterSale.map((batch) => (
      batch.id === restored.updatedBatch.id ? restored.updatedBatch : batch
    ));
    expect(afterCancellation.map((batch) => batch.stock)).toEqual([3, 5, 4]);
    expect(afterCancellation.reduce((sum, batch) => sum + batch.stock, 0)).toBe(12);
  });

  it('rejects a short or missing selected variant instead of consuming a sibling', () => {
    const batches = [
      makeBatch('s-black', 'shirt', 3, '2026-11-01', { talla: 'S', color: 'Negro' }),
      makeBatch('m-black', 'shirt', 1, '2026-11-02', { talla: 'M', color: 'Negro' }),
      makeBatch('m-blue', 'shirt', 4, '2026-11-03', { talla: 'M', color: 'Azul' })
    ];

    expect(() => build({
      product: makeApparel(),
      items: [makeVariantLine('m-black', 2)],
      batches: { shirt: batches }
    })).toThrow('CRITICAL_STOCK_COMMIT_FAILED');

    expect(() => build({
      product: makeApparel(),
      items: [makeVariantLine('belongs-to-another-product', 1)],
      batches: {
        shirt: [
          ...batches,
          makeBatch('belongs-to-another-product', 'another-product', 10, '2026-10-01')
        ]
      }
    })).toThrow('CRITICAL_STOCK_COMMIT_FAILED');
  });

  it('tracks repeated and distinct variant lines without switching batches', () => {
    const { batchesToDeduct } = build({
      product: makeApparel(),
      items: [makeVariantLine('m-black', 2, 'm-black-a'), makeVariantLine('m-black', 2, 'm-black-b'), makeVariantLine('m-blue', 1)],
      batches: { shirt: apparelBatches() }
    });

    expect(batchesToDeduct).toEqual([
      { batchId: 'm-black', quantity: 2, productId: 'shirt', fromCommittedStock: false },
      { batchId: 'm-black', quantity: 2, productId: 'shirt', fromCommittedStock: false },
      { batchId: 'm-blue', quantity: 1, productId: 'shirt', fromCommittedStock: false }
    ]);
  });

  it('leaves ordinary batch selection and restaurant recipe allocation unchanged', () => {
    const hardware = {
      id: 'hammer',
      name: 'Martillo',
      trackStock: true,
      batchManagement: { enabled: true }
    };
    const hardwareBatches = [
      makeBatch('hardware-old', 'hammer', 2, '2026-11-01'),
      makeBatch('hardware-selected', 'hammer', 2, '2026-11-02')
    ];
    const ordinaryResult = build({
      product: hardware,
      items: [{ id: 'hammer', batchId: 'hardware-selected', isVariant: false, quantity: 1 }],
      batches: { hammer: hardwareBatches }
    });
    expect(ordinaryResult.batchesToDeduct[0]).toMatchObject({ batchId: 'hardware-old', quantity: 1 });

    const restaurantResult = build({
      product: [
        { id: 'coffee', name: 'Café', trackStock: true, recipe: [{ ingredientId: 'beans', quantity: 1 }] },
        { id: 'beans', name: 'Grano', trackStock: true, batchManagement: { enabled: true } }
      ],
      items: [{ id: 'coffee', quantity: 2 }],
      batches: { beans: [makeBatch('beans-first', 'beans', 10, '2026-11-01')] }
    });
    expect(restaurantResult.batchesToDeduct).toEqual([{
      batchId: 'beans-first',
      quantity: 2,
      productId: 'beans',
      fromCommittedStock: false
    }]);
  });
});
