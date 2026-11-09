import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { salesRepository } from '../sales';
import { productsRepository } from '../products';
import { buildProcessedItemsAndDeductions, commitStock } from '../../sales/inventoryFlow';
import { validateStockBeforeSale } from '../../sales/stockValidation';
import {
  captureDirectPartialAuthorization,
  getDirectPartialRecipeSnapshot,
  matchesDirectPartialAuthorization
} from '../../sales/directPartialAuthorization';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

const makeProduct = (id, stock, extra = {}) => ({
  id, name: id, name_lower: id, stock, committedStock: 0,
  isActive: true, trackStock: true, productType: 'ingredient',
  createdAt: new Date().toISOString(), ...extra
});
const makeDish = (id, recipe) => makeProduct(id, 0, {
  productType: 'sellable', trackStock: false, recipe
});
const actor = { actorKey: 'admin:direct-partial-test', tenant: { opaqueId: 'tenant-pr441' } };
const price = (amount) => Math.round(amount * 100) / 100;
const saleFor = async ({ id, items, catalog, maxMissing = {}, override = {} }) => {
  const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
    itemsToProcess: items, allProducts: catalog, batchesMap: new Map(),
    roundCurrency: price, allowDirectPartial: true
  });
  const attemptId = id + ':attempt';
  await db.table(STORES.SALES).put({
    id, status: 'open', checkoutAttemptId: attemptId, checkoutActorKey: actor.actorKey
  });
  return {
    sale: {
      id, items: processedItems, timestamp: new Date().toISOString(),
      total: '100.00', abono: '100.00', saldoPendiente: '0.00',
      paymentMethod: 'tarjeta', status: 'closed',
      localCommitBinding: { actorKey: actor.actorKey, tenant: actor.tenant },
      localCheckoutAttemptId: attemptId,
      metadata: { directPartialInventoryAuthorization: {
        version: 1, mode: 'direct_recipe_v1', saleId: id, attemptId,
        actorKey: actor.actorKey, tenant: actor.tenant.opaqueId,
        recipeSnapshot: Object.fromEntries(Array.from(new Set(items.map((item) => item.parentId || item.id)))
          .map((productId) => [productId, getDirectPartialRecipeSnapshot(catalog.find((product) => product.id === productId))])),
        maxMissing, ...override
      } }
    },
    batchesToDeduct
  };
};

describe('PR441 direct recipe partial authorization in Dexie', () => {
  beforeEach(async () => {
    await openTestTenantRuntime();
    for (const store of [STORES.MENU, STORES.PRODUCT_BATCHES, STORES.SALES,
      STORES.INVENTORY_EVENTS, STORES.TRANSACTION_LOG, STORES.SEQUENCES]) {
      await db.table(store).clear();
    }
  });
  afterEach(() => closeTestTenantRuntime());

  it('aggregates shortage across dishes and binds approval to attempt/cart/actor/tenant', async () => {
    const dish = makeDish('dish', [{ ingredientId: 'flour', quantity: 2 }]);
    const flour = makeProduct('flour', 3, { unit: 'kg' });
    await db.table(STORES.MENU).bulkPut([dish, flour]);
    const order = [{ id: 'dish', quantity: 1 }, { id: 'dish', quantity: 2 }];
    const checked = await validateStockBeforeSale({
      itemsToProcess: order, productMap: new Map([[dish.id,dish]]),
      loadMultipleData: (_store, ids) => db.table(STORES.MENU).bulkGet(ids),
      STORES
    });
    expect(checked.ok).toBe(false);
    expect(checked.response.missingData).toEqual([expect.objectContaining({
      ingredientId: 'flour', needed: 6, available: 3, missing: 3, unit: 'kg'
    })]);
    expect(checked.response.eligibleForPartial).toBe(true);
    const context = {
      order, total: '100.00',
      paymentData: { paymentMethod: 'multiple', amountPaid: '100.00',
        payments: [{ method: 'cash', amount: '60.00' }, { method: 'card', amount: '40.00' }] },
      saleId:'sale-1', attemptId:'a1', actorContext:actor,
      recipeSnapshot: { dish: getDirectPartialRecipeSnapshot(dish) }
    };
    const proposal = captureDirectPartialAuthorization(context,checked.response.missingData);
    expect(matchesDirectPartialAuthorization(proposal,context)).toBe(true);
    expect(matchesDirectPartialAuthorization(proposal,{...context,order:[{id:'dish',quantity:4}]})).toBe(false);
    expect(matchesDirectPartialAuthorization(proposal,{...context,actorContext:{...actor,actorKey:'staff:other'}})).toBe(false);
    expect(matchesDirectPartialAuthorization(proposal,{...context,actorContext:{...actor,tenant:{opaqueId:'other'}}})).toBe(false);
    expect(matchesDirectPartialAuthorization(proposal,{...context,attemptId:'a2'})).toBe(false);
    expect(matchesDirectPartialAuthorization(proposal, {
      ...context,
      paymentData: { ...context.paymentData, payments: [
        { method: 'cash', amount: '30.00' }, { method: 'card', amount: '70.00' }
      ] }
    })).toBe(false);
    expect(matchesDirectPartialAuthorization(proposal, {
      ...context,
      recipeSnapshot: { dish: getDirectPartialRecipeSnapshot(makeDish('dish', [{ ingredientId: 'flour', quantity: 3 }])) }
    })).toBe(false);
  });

  it('consumes only free physical stock, preserves other table commitments, and records required/used/missing', async () => {
    const dish = makeDish('dish', [{ ingredientId:'flour',quantity:2 }]);
    const flour = makeProduct('flour',7,{committedStock:4});
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const {sale,batchesToDeduct} = await saleFor({
      id:'partial-a',items:[{id:'dish',quantity:3}],catalog:[dish,flour],maxMissing:{flour:3}
    });
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(true);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(4);
    expect((await db.table(STORES.MENU).get('flour')).committedStock).toBe(4);
    const saved=await db.table(STORES.SALES).get('partial-a');
    expect(saved.metadata.directPartialInventory.components[0]).toMatchObject({
      required:6, consumed:3, missing:3, committedBefore:4
    });
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(1);
    await expect(salesRepository.executeSaleTransaction(sale,batchesToDeduct)).rejects.toThrow();
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(4);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(1);
  });

  it('cancels a known shortage without writing a sale, charge or stock movement', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:4}]);
    const flour=makeProduct('flour',1);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const checked=await validateStockBeforeSale({
      itemsToProcess:[{id:'dish',quantity:1}],productMap:new Map([['dish',dish]]),
      loadMultipleData:(_store,ids)=>db.table(STORES.MENU).bulkGet(ids),STORES
    });
    expect(checked.response.errorType).toBe('STOCK_WARNING');
    expect(checked.response.missingData[0].missing).toBe(3);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(1);
    expect(await db.table(STORES.SALES).count()).toBe(0);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

  it('restores exactly the physical ingredient quantities used in a partial sale on cancellation', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:4}]);
    const flour=makeProduct('flour',4,{committedStock:2});
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const {sale,batchesToDeduct}=await saleFor({
      id:'partial-cancel',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{flour:2}
    });
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(true);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(2);
    const saved=await db.table(STORES.SALES).get('partial-cancel');
    await productsRepository.restoreStockFromCancellation(saved.items);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(4);
    expect((await db.table(STORES.MENU).get('flour')).committedStock).toBe(2);
  });

  it('allows all missing from a known ingredient already at zero without negative stock', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:2}]);
    const flour=makeProduct('flour',0);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const {sale,batchesToDeduct}=await saleFor({id:'zero',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{flour:2}});
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(true);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(0);
    expect((await db.table(STORES.SALES).get('zero')).metadata.directPartialInventory.components[0]).toMatchObject({ required:2,consumed:0,missing:2 });
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

  it('combines two dishes sharing one ingredient and never consumes a committed unit', async () => {
    const a=makeDish('a',[{ingredientId:'egg',quantity:2}]);
    const b=makeDish('b',[{ingredientId:'egg',quantity:3}]);
    const egg=makeProduct('egg',7,{committedStock:2});
    await db.table(STORES.MENU).bulkPut([a,b,egg]);
    const {sale,batchesToDeduct}=await saleFor({id:'shared',items:[{id:'a',quantity:2},{id:'b',quantity:1}],catalog:[a,b,egg],maxMissing:{egg:2}});
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(true);
    expect((await db.table(STORES.MENU).get('egg')).stock).toBe(2);
    expect((await db.table(STORES.MENU).get('egg')).committedStock).toBe(2);
    expect((await db.table(STORES.SALES).get('shared')).metadata.directPartialInventory.components[0]).toMatchObject({required:7,consumed:5,missing:2});
  });

  it('consumes a batch only up to its free stock and updates the ingredient projection', async () => {
    const dish=makeDish('dish',[{ingredientId:'milk',quantity:5}]);
    const milk=makeProduct('milk',10,{batchManagement:{enabled:true},unit:'lt'});
    await db.table(STORES.MENU).bulkPut([dish,milk]);
    await db.table(STORES.PRODUCT_BATCHES).bulkPut([
      {id:'m1',productId:'milk',stock:6,committedStock:4,trackStock:true,isActive:true,expiryDate:'2030-01-01',createdAt:'2026-01-01'},
      {id:'m2',productId:'milk',stock:4,committedStock:2,trackStock:true,isActive:true,expiryDate:'2031-01-01',createdAt:'2026-01-01'}
    ]);
    const {sale,batchesToDeduct}=await saleFor({id:'batch',items:[{id:'dish',quantity:1}],catalog:[dish,milk],maxMissing:{milk:1}});
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(true);
    expect((await db.table(STORES.PRODUCT_BATCHES).get('m1')).stock).toBe(4);
    expect((await db.table(STORES.PRODUCT_BATCHES).get('m2')).stock).toBe(2);
    expect((await db.table(STORES.MENU).get('milk')).stock).toBe(6);
    expect((await db.table(STORES.MENU).get('milk')).committedStock).toBe(6);
    expect((await db.table(STORES.SALES).get('batch')).metadata.directPartialInventory.components[0]).toMatchObject({required:5,consumed:4,missing:1});
  });

  it('rolls back all side effects if known shortage gets worse after confirmation', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:5}]);
    const flour=makeProduct('flour',2);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const {sale,batchesToDeduct}=await saleFor({id:'reconfirm',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{flour:1}});
    const result=await salesRepository.executeSaleTransaction(sale,batchesToDeduct);
    expect(result.success).toBe(false);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(2);
    expect((await db.table(STORES.SALES).get('reconfirm')).status).toBe('open');
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
    expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(0);
  });

  it('rejects a recipe changed in Dexie after partial authorization without charging', async () => {
    const dish = makeDish('dish', [{ ingredientId: 'flour', quantity: 2 }]);
    const flour = makeProduct('flour', 1);
    await db.table(STORES.MENU).bulkPut([dish, flour]);
    const { sale, batchesToDeduct } = await saleFor({
      id: 'recipe-changed', items: [{ id: 'dish', quantity: 1 }],
      catalog: [dish, flour], maxMissing: { flour: 1 }
    });
    await db.table(STORES.MENU).put(makeDish('dish', [{ ingredientId: 'flour', quantity: 3 }]));

    const result = await salesRepository.executeSaleTransaction(sale, batchesToDeduct);
    expect(result.success).toBe(false);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(1);
    expect((await db.table(STORES.SALES).get('recipe-changed')).status).toBe('open');
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

  it('rejects forged actor, tenant, attempt and table reservation without charging', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:1}]);
    const flour=makeProduct('flour',1);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    for (const [id,override] of Object.entries({
      actor:{actorKey:'staff:wrong'}, tenant:{tenant:'other'}, attempt:{attemptId:'wrong'}
    })) {
      const {sale,batchesToDeduct}=await saleFor({id,items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{},override});
      expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(false);
    }
    const {sale,batchesToDeduct}=await saleFor({id:'table',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{}});
    sale.items[0].inventoryReservation={source:'table',committedQuantity:1};
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(false);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(1);
  });

  it('fails closed for inactive or expired ingredients', async () => {
    const dish=makeDish('dish',[{ingredientId:'milk',quantity:2}]);
    const milk=makeProduct('milk',2,{batchManagement:{enabled:true},expirationMode:'STRICT'});
    await db.table(STORES.MENU).bulkPut([dish,milk]);
    await db.table(STORES.PRODUCT_BATCHES).put({
      id:'expired',productId:'milk',stock:2,committedStock:0,
      trackStock:true,isActive:true,expiryDate:'2020-01-01'
    });
    const {sale,batchesToDeduct}=await saleFor({id:'expired-sale',items:[{id:'dish',quantity:1}],catalog:[dish,milk],maxMissing:{milk:2}});
    expect((await salesRepository.executeSaleTransaction(sale,batchesToDeduct)).success).toBe(false);
    expect((await db.table(STORES.PRODUCT_BATCHES).get('expired')).stock).toBe(2);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

  it('serializes two boxes without stock overdraft or duplicated movements', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:4}]);
    const flour=makeProduct('flour',5);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const left=await saleFor({id:'box-a',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{flour:4}});
    const right=await saleFor({id:'box-b',items:[{id:'dish',quantity:1}],catalog:[dish,flour],maxMissing:{flour:4}});
    const results=await Promise.all([
      salesRepository.executeSaleTransaction(left.sale,left.batchesToDeduct),
      salesRepository.executeSaleTransaction(right.sale,right.batchesToDeduct)
    ]);
    expect(results.every((result)=>result.success)).toBe(true);
    expect((await db.table(STORES.MENU).get('flour')).stock).toBe(0);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(2);
    expect((await db.table(STORES.SALES).get('box-b')).metadata.directPartialInventory.components[0].missing
      + (await db.table(STORES.SALES).get('box-a')).metadata.directPartialInventory.components[0].missing).toBe(3);
  });

  it('keeps the strict full-reservation policy on saved tables', async () => {
    const dish=makeDish('dish',[{ingredientId:'flour',quantity:2}]);
    const flour=makeProduct('flour',3);
    await db.table(STORES.MENU).bulkPut([dish,flour]);
    const success=await commitStock([{id:'dish',quantity:1}],{db,STORES,allProducts:[dish,flour]});
    expect(success[0].inventoryReservation.source).toBe('table');
    await expect(commitStock([{id:'dish',quantity:1}],{db,STORES,allProducts:[dish,flour]})).rejects.toThrow();
    expect((await db.table(STORES.MENU).get('flour')).committedStock).toBe(2);
  });
});
