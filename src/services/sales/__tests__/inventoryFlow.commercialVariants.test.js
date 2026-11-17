import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { collectBatchRestorations, restoreBatchStock } from '../batchRestoration';
import { buildProcessedItemsAndDeductions, loadRelevantBatches } from '../inventoryFlow';
import { db, STORES } from '../../db/dexie';
import { productsRepository } from '../../db/products';
import { salesRepository } from '../../db/sales';
import { cancelSaleCore } from '../cancelSaleCore';
import { processSaleCore } from '../processSaleCore';
import { calculatePricingDetails } from '../../pricingLogic';
import { mapLocalCheckoutToCloudSale } from '../../salesCloud/salesCloudCashierMapper';
import { salesCloudCashierService } from '../../salesCloud/salesCloudCashierService';
import { salesCloudShadowService } from '../../salesCloud/salesCloudShadowService';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

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

  it('uses persisted rubro instead of isVariant or the cart rubro for ordinary lots', async () => {
    const cases = [
      {
        id: 'grocery', rubroContext: 'abarrotes', first: 'grocery-old', selected: 'grocery-sku',
        batches: [
          makeBatch('grocery-old', 'grocery', 2, '2026-11-01'),
          makeBatch('grocery-sku', 'grocery', 2, '2026-11-02')
        ]
      },
      {
        id: 'hammer', rubroContext: 'hardware', first: 'hardware-old', selected: 'hardware-sku',
        batches: [
          makeBatch('hardware-old', 'hammer', 2, '2026-11-01'),
          makeBatch('hardware-sku', 'hammer', 2, '2026-11-02')
        ]
      }
    ];

    for (const entry of cases) {
      const product = {
        id: entry.id, name: entry.id, trackStock: true, hasVariants: true,
        rubroContext: entry.rubroContext, batchManagement: { enabled: true }
      };
      const result = build({
        product,
        items: [{
          id: entry.id,
          rubroContext: 'apparel',
          batchId: entry.selected,
          isVariant: true,
          quantity: 1
        }],
        batches: { [entry.id]: entry.batches }
      });
      expect(result.batchesToDeduct[0]).toMatchObject({ batchId: entry.first, quantity: 1 });
    }

    const pharmacy = {
      id: 'medicine', name: 'Medicamento', trackStock: true, hasVariants: true,
      rubroContext: 'farmacia', expirationMode: 'STRICT',
      batchManagement: { enabled: true, selectionStrategy: 'fefo' }
    };
    const unorderedPharmacyBatches = [
      { ...makeBatch('pharmacy-later', 'medicine', 2, '2026-11-01'), expiryDate: '2027-02-01' },
      { ...makeBatch('pharmacy-fefo', 'medicine', 2, '2026-11-02'), expiryDate: '2027-01-01' }
    ];
    const pharmacyLine = { id: 'medicine', rubroContext: 'apparel', isVariant: true, batchId: 'pharmacy-later', quantity: 1 };
    const pharmacyBatches = await loadRelevantBatches({
      itemsToProcess: [pharmacyLine],
      allProducts: [pharmacy],
      queryBatchesByProductIdAndActive: async () => unorderedPharmacyBatches,
      queryByIndex: async () => [],
      STORES: { PRODUCT_BATCHES: 'product_batches' },
      now: new Date('2026-11-17T00:00:00.000Z')
    });
    const pharmacyResult = buildProcessedItemsAndDeductions({
      itemsToProcess: [pharmacyLine],
      allProducts: [pharmacy],
      batchesMap: pharmacyBatches,
      roundCurrency
    });
    expect(pharmacyResult.batchesToDeduct[0]).toMatchObject({ batchId: 'pharmacy-fefo', quantity: 1 });
  });

  it('leaves restaurant recipe ingredient allocation unchanged for an isVariant-shaped line', () => {
    const restaurantResult = build({
      product: [
        { id: 'coffee', name: 'Café', trackStock: true, rubroContext: 'food_service', recipe: [{ ingredientId: 'beans', quantity: 1 }] },
        { id: 'beans', name: 'Grano', trackStock: true, batchManagement: { enabled: true } }
      ],
      items: [{ id: 'coffee', rubroContext: 'apparel', isVariant: true, batchId: 'beans-last', quantity: 2 }],
      batches: {
        beans: [
          makeBatch('beans-first', 'beans', 10, '2026-11-01'),
          makeBatch('beans-last', 'beans', 10, '2026-11-02')
        ]
      }
    });
    expect(restaurantResult.batchesToDeduct).toEqual([{
      batchId: 'beans-first',
      quantity: 2,
      productId: 'beans',
      fromCommittedStock: false
    }]);
  });
});

const dexieProduct = (id, extra = {}) => ({
  id,
  name: id,
  name_lower: id,
  price: 12,
  cost: 4,
  stock: 12,
  committedStock: 0,
  isActive: true,
  trackStock: true,
  batchManagement: { enabled: true, selectionStrategy: 'fifo' },
  rubroContext: 'apparel',
  hasVariants: true,
  createdAt: new Date().toISOString(),
  ...extra
});

const dexieBatch = (id, productId, stock, createdAt, attributes = {}) => ({
  id,
  productId,
  sku: id.toUpperCase(),
  stock,
  committedStock: 0,
  cost: 4,
  price: 12,
  isActive: stock > 0,
  status: stock > 0 ? 'active' : 'inactive',
  createdAt,
  updatedAt: createdAt,
  attributes
});

const createSaleDependencies = () => ({
  loadData: (store, id) => db.table(store).get(id),
  loadMultipleData: (store, ids) => db.table(store).bulkGet(ids),
  saveData: (store, value) => db.table(store).put(value),
  STORES,
  queryBatchesByProductIdAndActive: async (productId, isActive) => (
    (await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray())
      .filter((batch) => batch.isActive === isActive)
  ),
  queryByIndex: (store, index, value) => db.table(store).where(index).equals(value).toArray(),
  executeSaleTransactionSafe: (sale, deductions) => salesRepository.executeSaleTransaction(sale, deductions),
  useStatsStore: { getState: () => ({ updateStatsForNewSale: vi.fn(async () => true) }) },
  roundCurrency,
  sendReceiptWhatsApp: vi.fn(async () => ({ status: 'not_requested' })),
  calculatePricingDetails,
  Logger: { time: vi.fn(), timeEnd: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }
});

const getBatchesInCreatedOrder = async (productId) => (
  (await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray())
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
);

describe('Apparel sale and cancellation through processSaleCore and Dexie', () => {
  let cloudDecisionSpy;
  let cloudShadowSpy;

  beforeEach(async () => {
    await openTestTenantRuntime();
    cloudDecisionSpy = vi.spyOn(salesCloudCashierService, 'shouldUseCloudCashierSale')
      .mockResolvedValue({ useCloud: false, reason: 'free_local_test' });
    cloudShadowSpy = vi.spyOn(salesCloudShadowService, 'syncSaleShadowAfterLocalCommit')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cloudDecisionSpy?.mockRestore();
    cloudShadowSpy?.mockRestore();
    closeTestTenantRuntime();
  });

  it('persists exact variant consumption and cancellation, blocks repeat restore, and rejects an exhausted size', async () => {
    const product = dexieProduct('shirt');
    const batches = [
      dexieBatch('s-black', 'shirt', 3, '2026-11-01T00:00:00.000Z', { talla: 'S', color: 'Negro' }),
      dexieBatch('m-black', 'shirt', 5, '2026-11-02T00:00:00.000Z', { talla: 'M', color: 'Negro' }),
      dexieBatch('m-blue', 'shirt', 4, '2026-11-03T00:00:00.000Z', { talla: 'M', color: 'Azul' })
    ];
    await db.table(STORES.MENU).put(product);
    await db.table(STORES.PRODUCT_BATCHES).bulkPut(batches);

    const runSale = async (item) => processSaleCore({
      order: [item],
      paymentData: { paymentMethod: 'tarjeta', amountPaid: 24, saldoPendiente: 0, sendReceipt: false },
      total: 24,
      allProducts: await db.table(STORES.MENU).toArray(),
      features: { hasRecipes: false, hasKDS: false, hasLabFields: false },
      companyName: 'QA Apparel',
      tempPrescriptionData: null
    }, createSaleDependencies());

    const saleResult = await runSale(makeVariantLine('m-black', 2));
    expect(saleResult).toMatchObject({
      success: true,
      financialResult: { sourceMode: 'local_committed' }
    });

    const afterSaleBatches = await getBatchesInCreatedOrder('shirt');
    expect(afterSaleBatches.map((batch) => batch.stock)).toEqual([3, 3, 4]);
    expect(afterSaleBatches.reduce((sum, batch) => sum + batch.stock, 0)).toBe(10);
    const persistedSale = await db.table(STORES.SALES).get(saleResult.saleId);
    expect(persistedSale.items[0]).toMatchObject({
      parentId: 'shirt',
      isVariant: true,
      batchId: 'm-black',
      quantity: 2,
      batchesUsed: [{ batchId: 'm-black', ingredientId: 'shirt', quantity: 2 }]
    });

    const cancelDeps = {
      db,
      STORES,
      restoreStockFromCancellation: (items) => productsRepository.restoreStockFromCancellation(items),
      generateId: () => `cancel-${saleResult.saleId}`,
      assertActorCurrent: vi.fn(),
      now: () => '2026-11-17T12:00:00.000Z',
      Logger: { error: vi.fn() }
    };
    const cancellationInput = {
      saleId: saleResult.saleId,
      currentSales: [persistedSale],
      restoreStock: true
    };
    const firstCancel = await cancelSaleCore(cancellationInput, cancelDeps);
    expect(firstCancel).toMatchObject({ success: true, code: 'CANCELLED', restoreStock: true });

    const afterCancellation = await getBatchesInCreatedOrder('shirt');
    expect(afterCancellation.map((batch) => batch.stock)).toEqual([3, 5, 4]);
    expect(afterCancellation.reduce((sum, batch) => sum + batch.stock, 0)).toBe(12);
    const retry = await cancelSaleCore(cancellationInput, cancelDeps);
    expect(retry).toMatchObject({ success: true, code: 'ALREADY_CANCELLED', alreadyCancelled: true });
    expect((await getBatchesInCreatedOrder('shirt')).map((batch) => batch.stock)).toEqual([3, 5, 4]);

    await db.table(STORES.PRODUCT_BATCHES).put({
      ...afterCancellation.find((batch) => batch.id === 'm-black'),
      stock: 0,
      isActive: false,
      status: 'inactive'
    });
    const beforeExhaustedAttempt = await getBatchesInCreatedOrder('shirt');
    const exhaustedResult = await runSale(makeVariantLine('m-black', 1));
    expect(exhaustedResult).toMatchObject({
      success: false,
      message: expect.stringContaining('no esta activo')
    });
    expect((await getBatchesInCreatedOrder('shirt')).map((batch) => batch.stock))
      .toEqual(beforeExhaustedAttempt.map((batch) => batch.stock));
    expect(await db.table(STORES.SALES).count()).toBe(1);
  });

  it('keeps a SKU-resolved hardware lot in ordinary allocation and Cloud mapping', async () => {
    const hammer = dexieProduct('hammer', {
      rubroContext: 'hardware',
      hasVariants: false,
      batchManagement: { enabled: true, selectionStrategy: 'fifo' }
    });
    await db.table(STORES.MENU).put(hammer);
    await db.table(STORES.PRODUCT_BATCHES).bulkPut([
      dexieBatch('hammer-old', 'hammer', 2, '2026-11-01T00:00:00.000Z'),
      dexieBatch('hammer-sku', 'hammer', 2, '2026-11-02T00:00:00.000Z')
    ]);

    const skuItem = await productsRepository.searchProductBySKU('HAMMER-SKU');
    expect(skuItem).toMatchObject({
      id: 'hammer',
      rubroContext: 'hardware',
      isVariant: true,
      batchId: 'hammer-sku'
    });
    const catalogProduct = await db.table(STORES.MENU).get('hammer');
    const ordinary = build({
      product: catalogProduct,
      items: [{ ...skuItem, quantity: 1 }],
      batches: {
        hammer: await db.table(STORES.PRODUCT_BATCHES).where('productId').equals('hammer').toArray()
      }
    });
    expect(ordinary.batchesToDeduct[0]).toMatchObject({ batchId: 'hammer-old', quantity: 1 });

    const cloudPayload = mapLocalCheckoutToCloudSale({
      sale: { id: 'hardware-sku-sale', total: 12 },
      processedItems: [skuItem],
      paymentData: { paymentMethod: 'cash', amountPaid: 12 },
      total: 12,
      inventoryEnabled: true,
      productCatalog: [catalogProduct],
      batchCatalog: new Map([['hammer', await db.table(STORES.PRODUCT_BATCHES).where('productId').equals('hammer').toArray()]])
    });
    expect(cloudPayload.items[0].batch_id).toBeNull();
  });
});
