import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { layawayRepository } from '../layaways';
import { useAppStore } from '../../../store/useAppStore';
import { salesRepository } from '../sales';
import { getAvailableStock } from '../utils';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

const layaway = (id, quantity = 2, item = {}) => ({
  id, customerId: 'customer-1', customerName: 'Cliente',
  items: [{ productId: 'shirt', quantity, price: 100, ...item }],
  totalAmount: quantity * 100,
  deadline: '2099-12-15'
});

const product = (extra = {}) => ({
  id: 'shirt', name: 'Playera', trackStock: true, isActive: true,
  stock: 10, committedStock: 0, ...extra
});
const physical = async () => {
  const record = await db.table(STORES.MENU).get('shirt');
  return { stock: record.stock, committed: record.committedStock, available: getAvailableStock(record) };
};

const normalSale = (id, qty, batchId = null) => salesRepository.executeSaleTransaction({
  id, timestamp: new Date().toISOString(), items: [{
    id: 'shirt', parentId: 'shirt', productId: 'shirt',
    quantity: qty, price: 100, stockDeducted: qty,
    ...(batchId ? { batchesUsed: [{ batchId, quantity: qty }] } : {})
  }], total: qty * 100, subtotal: qty * 100, paymentMethod: 'tarjeta'
}, batchId ? [{ productId: 'shirt', batchId, quantity: qty }] : []);

beforeEach(async () => {
  useAppStore.setState({ licenseDetails: { license_key: 'FREE-A' } });
  await openTestTenantRuntime();
  await db.table(STORES.COMPANY).put({ id: 'company:FREE-A', license_key: 'FREE-A', timezone: 'America/Merida' });
  for (const table of [
    STORES.MENU, STORES.PRODUCT_BATCHES, STORES.LAYAWAYS, STORES.SALES,
    STORES.DAILY_STATS, STORES.CAJAS, STORES.MOVIMIENTOS_CAJA,
    STORES.INVENTORY_EVENTS, STORES.TRANSACTION_LOG, STORES.SEQUENCES
  ]) await db.table(table).clear();
});
afterEach(async () => {
  await closeTestTenantRuntime();
  useAppStore.setState({ licenseDetails: null });
});

describe('Apparel Free reserved_v1 / Dexie real', () => {
  it('reserves 2 of 10, sells the 8 free, rejects a ninth and delivers only once', async () => {
    await db.table(STORES.MENU).put(product());
    const created = await layawayRepository.create(layaway('l-new'));
    expect(created.layaway).toMatchObject({
      inventoryAccountingMode: 'reserved_v1', sourceMode: 'local',
      reservedInventory: [{ productId: 'shirt', quantity: 2 }]
    });
    expect(await physical()).toEqual({ stock: 10, committed: 2, available: 8 });

    expect((await normalSale('normal-8', 8)).success).toBe(true);
    expect(await physical()).toEqual({ stock: 2, committed: 2, available: 0 });
    const ninth = await normalSale('normal-9', 1);
    expect(ninth).toMatchObject({ success: false, isStockError: true });
    expect(await db.table(STORES.SALES).count()).toBe(1);

    await db.table(STORES.LAYAWAYS).update('l-new', { paidAmount: 200, status: 'ready' });
    const first = await layawayRepository.convertToSale('l-new');
    const retry = await layawayRepository.convertToSale('l-new');
    expect(first).toMatchObject({ success: true, duplicate: false });
    expect(retry).toMatchObject({ success: true, duplicate: true, saleId: first.saleId });
    expect(await physical()).toEqual({ stock: 0, committed: 0, available: 0 });
    expect((await db.table(STORES.LAYAWAYS).get('l-new'))).toMatchObject({
      status: 'completed', conversionSaleId: first.saleId, deliveredAt: expect.any(String)
    });
    expect((await db.table(STORES.SALES).toArray()).filter((sale) => sale.originalLayawayId === 'l-new')).toHaveLength(1);
    expect((await db.table(STORES.INVENTORY_EVENTS).toArray()).filter((event) => event.saleId === first.saleId))
      .toMatchObject([{ delta: -2, productId: 'shirt' }]);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });

  it('rejects excessive and missing-product reservations with full rollback', async () => {
    await db.table(STORES.MENU).put(product());
    await expect(layawayRepository.create(layaway('excess', 11)))
      .rejects.toMatchObject({ code: 'LAYAWAY_STOCK_INSUFFICIENT' });
    await expect(layawayRepository.create({
      ...layaway('missing'), items: [
        { productId: 'shirt', quantity: 2 },
        { productId: 'not-in-catalog', quantity: 1 }
      ]
    })).rejects.toMatchObject({ code: 'LAYAWAY_PRODUCT_NOT_FOUND' });
    expect(await physical()).toEqual({ stock: 10, committed: 0, available: 10 });
    expect(await db.table(STORES.LAYAWAYS).count()).toBe(0);
  });

  it('after selling 8, cancellation frees only its two units without restoring physical stock', async () => {
    await db.table(STORES.MENU).put(product());
    await layawayRepository.create(layaway('cancel-2'));
    expect((await normalSale('normal-8', 8)).success).toBe(true);
    await db.table(STORES.COMPANY).delete('company:FREE-A');
    await layawayRepository.cancel('cancel-2', 'Cliente', true, null, { assertActorCurrent: () => {} });
    expect(await physical()).toEqual({ stock: 2, committed: 0, available: 2 });
    expect((await db.table(STORES.LAYAWAYS).get('cancel-2')).status).toBe('cancelled');
    expect((await db.table(STORES.SALES).toArray()).filter((sale) => sale.originalLayawayId === 'cancel-2')).toHaveLength(0);
    await expect(layawayRepository.cancel('cancel-2', 'Cliente', true, null, { assertActorCurrent: () => {} }))
      .rejects.toThrow();
    expect(await physical()).toEqual({ stock: 2, committed: 0, available: 2 });
  });

  it('preserves commitments from other commercial flows', async () => {
    await db.table(STORES.MENU).put(product({ committedStock: 3 }));
    await layawayRepository.create(layaway('foreign-commit'));
    expect(await physical()).toEqual({ stock: 10, committed: 5, available: 5 });
    await layawayRepository.cancel('foreign-commit', 'Cliente', true, null, { assertActorCurrent: () => {} });
    expect(await physical()).toEqual({ stock: 10, committed: 3, available: 7 });
  });

  it('repeated concurrent reservations cannot exceed availability', async () => {
    await db.table(STORES.MENU).put(product());
    const attempts = await Promise.allSettled([
      layawayRepository.create(layaway('parallel-a', 6)),
      layawayRepository.create(layaway('parallel-b', 6))
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await physical()).toEqual({ stock: 10, committed: 6, available: 4 });
    expect(await db.table(STORES.LAYAWAYS).count()).toBe(1);
  });

  it('reserves the selected Apparel variant batch, preserving unrelated commitments', async () => {
    await db.table(STORES.MENU).put(product({
      stock: 10, committedStock: 3, batchManagement: { enabled: true }
    }));
    await db.table(STORES.PRODUCT_BATCHES).put({
      id: 'variant-blue-M', productId: 'shirt', stock: 10, committedStock: 3,
      isActive: true, status: 'active', sku: 'BLUE-M'
    });
    await layawayRepository.create(layaway('variant-l', 2, {
      parentId: 'shirt', batchId: 'variant-blue-M', isVariant: true
    }));
    expect((await db.table(STORES.PRODUCT_BATCHES).get('variant-blue-M')).committedStock).toBe(5);
    expect(await physical()).toEqual({ stock: 10, committed: 5, available: 5 });
    expect((await normalSale('batch-sale', 5, 'variant-blue-M')).success).toBe(true);
    expect(await physical()).toEqual({ stock: 5, committed: 5, available: 0 });

    await db.table(STORES.LAYAWAYS).update('variant-l', { paidAmount: 200, status: 'ready' });
    await layawayRepository.convertToSale('variant-l');
    expect((await db.table(STORES.PRODUCT_BATCHES).get('variant-blue-M')))
      .toMatchObject({ stock: 3, committedStock: 3 });
    expect(await physical()).toEqual({ stock: 3, committed: 3, available: 0 });
  });

  it('rejects a batch belonging to another product and does not reserve anything', async () => {
    await db.table(STORES.MENU).put(product({ batchManagement: { enabled: true } }));
    await db.table(STORES.PRODUCT_BATCHES).put({
      id: 'wrong-batch', productId: 'other-product', stock: 10, committedStock: 0, isActive: true
    });
    await expect(layawayRepository.create(layaway('invalid-batch', 2, { batchId: 'wrong-batch' })))
      .rejects.toMatchObject({ code: 'LAYAWAY_BATCH_MISMATCH' });
    expect(await db.table(STORES.LAYAWAYS).count()).toBe(0);
    expect(await physical()).toEqual({ stock: 10, committed: 0, available: 10 });
  });

  it('keeps untracked catalog products free of physical reservations', async () => {
    await db.table(STORES.MENU).put(product({ trackStock: false }));
    const { layaway: saved } = await layawayRepository.create(layaway('untracked', 2));
    expect(saved.reservedInventory).toEqual([]);
    expect(saved.untrackedInventoryLines).toEqual([0]);
    await db.table(STORES.LAYAWAYS).update('untracked', { paidAmount: 200, status: 'ready' });
    await layawayRepository.convertToSale('untracked');
    expect(await physical()).toEqual({ stock: 10, committed: 0, available: 10 });
  });

  it('legacy Local cancelled restores physical stock; legacy delivery never deducts twice', async () => {
    await db.table(STORES.MENU).put(product({ stock: 8 }));
    await db.table(STORES.LAYAWAYS).put({
      ...layaway('legacy-cancel'), status: 'active', paidAmount: 0, payments: []
    });
    await layawayRepository.cancel('legacy-cancel', 'Cliente', true, null, { assertActorCurrent: () => {} });
    expect(await physical()).toEqual({ stock: 10, committed: 0, available: 10 });
    await db.table(STORES.MENU).update('shirt', { stock: 8 });
    await db.table(STORES.LAYAWAYS).put({
      ...layaway('legacy-deliver'), status: 'ready', paidAmount: 200, payments: []
    });
    const delivery = await layawayRepository.convertToSale('legacy-deliver');
    expect((await layawayRepository.convertToSale('legacy-deliver'))).toMatchObject({
      duplicate: true, saleId: delivery.saleId
    });
    expect(await physical()).toEqual({ stock: 8, committed: 0, available: 8 });
    expect((await db.table(STORES.SALES).toArray()).filter((sale) => sale.originalLayawayId === 'legacy-deliver')).toHaveLength(1);
  });

  it('cloud snapshots are not interpreted as legacy local inventory', async () => {
    await db.table(STORES.MENU).put(product());
    await db.table(STORES.LAYAWAYS).put({
      ...layaway('cloud-local-copy'), sourceMode: 'cloud_committed',
      status: 'active', paidAmount: 0
    });
    await expect(layawayRepository.cancel('cloud-local-copy', 'Cliente', true, null, {
      assertActorCurrent: () => {}
    })).rejects.toMatchObject({ code: 'LAYAWAY_CLOUD_PROJECTION' });
    await expect(layawayRepository.convertToSale('cloud-local-copy'))
      .rejects.toMatchObject({ code: 'LAYAWAY_CLOUD_PROJECTION' });
    expect(await physical()).toEqual({ stock: 10, committed: 0, available: 10 });
  });
});
