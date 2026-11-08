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
    const chicken = product('chicken', 1);
    const bread = product('bread', 10);
    await db.table(STORES.MENU).bulkPut([dish, chicken, bread]);

    const { processedItems, batc¶»§q«^