import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { salesRepository } from '../sales';
import { productsRepository } from '../products';
import { buildProcessedItemsAndDeductions, commitStock } from '../../sales/inventoryFlow';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

const product = (id, stock, extra = {}) => ({
  id, name: id, name_lower: id, stock, committedStock: 0,
  isActive: true, trackStock: true, productType: 'ingredient',
  createdAt: new Date().toISOString(), ...extra
});

describe('restaurant recipe simple-stock atomic sale', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    for (const store of [STORES.MENU, STORES.PRODUCT_BATCHES, STORES.SALES,
      STORES.INVENTORY_EVENTS, STORES.TRANSACTION_LOG, STORES.SEQUENCES]) {
      await db.table(store).clear();
    }
  });
  afterEach(() => closeTestTenantRuntime());

  it('deducts every non-batch component exactly once and reverses the same quantities', async () => {
    const dish = product('dish', 0, {
      productType: 'sellable', trackStock: false,
      recipe: [{ ingredientId: 'chicken', quantity: 0.15 }, { ingredientId: 'bread', quantity: 1 }]
    });
    const chicken = product('chicken', 1, { cost: 10 });
    const bread = product('bread', 10, { cost: 2 });
    await db.table(STORES.MENU).bulkPut([dish, chicken, bread]);

    const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
      itemsToProcess: [{ id: 'dish', quantity: 2, price: 100 }],
      allProducts: [dish, chicken, bread],
      batchesMap: new Map(),
      roundCurrency: (v) => Math.round(v * 100) / 100
    });
    expect(processedItems[0].cost).toBe(3.5); // ($10 * 0.3 + $2 * 2) / 2 plates
    const sale = {
      id: 'recipe-sale-1', items: processedItems, timestamp: new Date().toISOString(),
      total: '200.00', abono: '200.00', saldoPendiente: '0.00',
      paymentMethod: 'tarjeta', status: 'closed'
    };
    const result = await salesRepository.executeSaleTransaction(sale, batchesToDeduct);
    expect(result.success).toBe(true);
    expect((await db.table(STORES.MENU).get('dish')).stock).toBe(0);
    expect((await db.table(STORES.MENU).get('chicken')).stock).toBeCloseTo(0.7, 5);
    expect((await db.table(STORES.MENU).get('bread')).stock).toBe(8);
    const movements = await db.table(STORES.INVENTORY_EVENTS).toArray();
    expect(movements).toHaveLength(2);
    expect(movements.map((event) => event.productId).sort()).toEqual(['bread', 'chicken']);
    await productsRepository.restoreStockFromCancellation(processedItems);
    expect((await db.table(STORES.MENU).get('chicken')).stock).toBeCloseTo(1, 5);
    expect((await db.table(STORES.MENU).get('bread')).stock).toBe(10);
  });

  it('turns a saved table ingredient reservation into physical consumption once', async () => {
    const dish = product('dish', 0, { productType: 'sellable', trackStock: false,
      recipe: [{ ingredientId: 'chicken', quantity: 0.15 }, { ingredientId: 'bread', quantity: 1 }] });
    const chicken = product('chicken', 1);
    const bread = product('bread', 10);
    await db.table(STORES.MENU).bulkPut([dish, chicken, bread]);

    const [reserved] = await commitStock([{ id: 'dish', quantity: 2 }], {
      db, STORES, allProducts: [dish, chicken, bread]
    });
    expect((await db.table(STORES.MENU).get('chicken')).committedStock).toBeCloseTo(0.3, 5);
    expect((await db.table(STORES.MENU).get('chicken')).stock).toBe(1);
    const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
      itemsToProcess: [reserved], allProducts: [dish, chicken, bread], batchesMap: new Map(),
      roundCurrency: (v) => Math.round(v * 100) / 100
    });
    const sale = { id: 'reserved-recipe-sale', items: processedItems, total: '200.00',
      timestamp: new Date().toISOString(), abono: '200.00', saldoPendiente: '0.00',
      paymentMethod: 'tarjeta', status: 'closed' };
    expect((await salesRepository.executeSaleTransaction(sale, batchesToDeduct)).success).toBe(true);
    const updatedChicken = await db.table(STORES.MENU).get('chicken');
    expect(updatedChicken.stock).toBeCloseTo(0.7, 5);
    expect(updatedChicken.committedStock).toBe(0);
    expect((await db.table(STORES.MENU).get('bread')).stock).toBe(8);
    expect((await db.table(STORES.MENU).get('bread')).committedStock).toBe(0);
  });

  it('rolls back the entire sale when one component lacks physical stock', async () => {
    const dish = product('dish', 0, { productType: 'sellable', trackStock: false,
      recipe: [{ ingredientId: 'chicken', quantity: 0.15 }, { ingredientId: 'bread', quantity: 1 }] });
    const chicken = product('chicken', 1);
    const bread = product('bread', 1);
    await db.table(STORES.MENU).bulkPut([dish, chicken, bread]);
    const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
      itemsToProcess: [{ id: 'dish', quantity: 2 }], allProducts: [dish, chicken, bread],
      batchesMap: new Map(), roundCurrency: (v) => Math.round(v * 100) / 100
    });
    const sale = { id: 'short-recipe-sale', items: processedItems, total: '200.00',
      timestamp: new Date().toISOString(), abono: '200.00', saldoPendiente: '0.00',
      paymentMethod: 'tarjeta', status: 'closed' };
    const result = await salesRepository.executeSaleTransaction(sale, batchesToDeduct);
    expect(result.success).toBe(false);
    expect((await db.table(STORES.MENU).get('chicken')).stock).toBe(1);
    expect((await db.table(STORES.MENU).get('bread')).stock).toBe(1);
    expect(await db.table(STORES.SALES).get(sale.id)).toBeUndefined();
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

});
