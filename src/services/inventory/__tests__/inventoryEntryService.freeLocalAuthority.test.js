import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class TestActorRuntimeError extends Error {
    constructor(code, details = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }

  return {
    TestActorRuntimeError,
    actorCapture: vi.fn(),
    state: null,
    tenantRuntime: {
      opaqueId: 'tenant-free-inventory',
      databaseName: 'LanzoDB_t_tenant-free-inventory',
      generation: 1
    }
  };
});

vi.mock('../../auth/actorRuntimeController', () => ({
  ACTOR_RUNTIME_STATUS: { LOCKED: 'locked' },
  ACTOR_RUNTIME_ERROR_CODES: {
    CONTEXT_LOCKED: 'ACTOR_CONTEXT_LOCKED',
    CONTEXT_STALE: 'ACTOR_CONTEXT_STALE'
  },
  ActorRuntimeError: mocks.TestActorRuntimeError,
  actorRuntimeController: {
    capture: mocks.actorCapture,
    getState: () => ({ status: 'locked' }),
    subscribe: vi.fn(),
    assertGranted: vi.fn(() => { throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED'); })
  }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => mocks.state }
}));

vi.mock('../../db/tenantRuntimeRouter', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTenantRuntimeReadiness: () => ({ ready: true, runtime: mocks.tenantRuntime })
  };
});

import { getActiveTenantDatabase } from '../../db/tenantRuntimeRouter';
import { db, STORES } from '../../db/dexie';
import { POS_SYNC_STORES } from '../../sync/syncConstants';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { salesRepository } from '../../db/sales';
import { customerCreditRepository } from '../../db/customerCreditRepository';
import { reportingService } from '../../db/reporting';
import { productsRepository } from '../../db/products';
import { cancelSaleCore } from '../../sales/cancelSaleCore';
import { summarizeLocalDashboardFinance } from '../../sales/dashboardFinancialSummary';
import { summarizeFinancialSales } from '../../sales/financialPolicy';
import { buildProcessedItemsAndDeductions } from '../../sales/inventoryFlow';
import { addInventoryEntry } from '../inventoryEntryService';

const freeLicense = () => ({
  license_key: 'LANZO-FREE-INVENTORY',
  valid: true,
  plan_code: 'free_trial',
  max_devices: 1,
  device_role: 'admin',
  features: {
    cloud_pos_sync: false,
    cloud_products_sync: false,
    staff_roles: false
  }
});

const strictProduct = () => ({
  id: 'product-free-strict',
  name: 'Producto con caducidad',
  stock: 0,
  cost: 10,
  price: 25,
  trackStock: true,
  recipe: [],
  isActive: true,
  expirationMode: 'STRICT',
  batchManagement: { enabled: true }
});

describe('inventoryEntryService FREE/local authority', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.state = {
      appStatus: 'ready',
      licenseDetails: freeLicense(),
      currentDeviceRole: 'admin',
      currentAdminUser: null,
      currentStaffUser: null
    };
    mocks.actorCapture.mockImplementation(() => {
      throw new mocks.TestActorRuntimeError('ACTOR_CONTEXT_LOCKED');
    });
    await openTestTenantRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeTestTenantRuntime();
  });

  it('applies and deduplicates a general pharmacy STRICT FREE entry without an actor-bound outbox', async () => {
    await db.table(STORES.MENU).put({ ...strictProduct(),
      metadata: { pharmacy: { kind: 'other', status: 'pending' } }
    });

    const request = {
      operationId: 'free-local-entry-strict',
      productId: 'product-free-strict',
      quantity: 5,
      baseQuantity: 5,
      unitCost: 11,
      manufacturerBatchId: 'FAB-FREE-001',
      expiryDate: '2027-01-31'
    };

    const first = await addInventoryEntry(request);
    const retry = await addInventoryEntry(request);

    expect(first).toMatchObject({ success: true, pending: false, previousStock: 0, newStock: 5 });
    expect(retry).toMatchObject({ success: true, pending: false, duplicate: true, newStock: 5 });
    expect((await db.table(STORES.MENU).get('product-free-strict')).stock).toBe(5);

    const batches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals('product-free-strict').toArray();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      stock: 5,
      manufacturerBatchId: 'FAB-FREE-001',
      expiryDate: '2027-01-31'
    });

    const event = await db.table(STORES.INVENTORY_EVENTS).get('inventory-entry:free-local-entry-strict');
    expect(event).toMatchObject({
      synced: true,
      syncDisposition: 'local_only',
      result: { pending: false, newStock: 5 }
    });
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);
    expect(mocks.actorCapture).not.toHaveBeenCalled();
  });

  it('keeps documentary validation active for a Free/Local medicine receipt', async () => {
    const medicine = {
      ...strictProduct(), id: 'medicine-free-docs',
      metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    };
    await db.table(STORES.MENU).put(medicine);

    await expect(addInventoryEntry({
      operationId: 'free-medicine-missing-docs', productId: medicine.id,
      quantity: 2, baseQuantity: 2, supplier: null,
      manufacturerBatchId: 'FREE-VI-001', expiryDate: '2027-12-31'
    })).rejects.toMatchObject({ code: 'PHARMACY_PROVENANCE_REQUIRED' });

    expect((await db.table(STORES.MENU).get(medicine.id)).stock).toBe(0);
    expect(await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(medicine.id).count()).toBe(0);
    expect(await db.table(STORES.INVENTORY_EVENTS).count()).toBe(0);
  });

  it('does not allocate a sale from a zero-stock identity-only general lot', () => {
    const product = {
      id: 'general-empty-lot', name: 'Producto general', stock: 0, cost: 3,
      trackStock: true, isActive: true, expirationMode: 'NONE', batchManagement: { enabled: true }
    };
    const emptyBatch = {
      id: 'general-empty-batch', productId: product.id, stock: 0,
      trackStock: false, isActive: false, status: 'inactive'
    };

    expect(() => buildProcessedItemsAndDeductions({
      itemsToProcess: [{ id: product.id, productId: product.id, quantity: 1, price: 8 }],
      allProducts: [product], batchesMap: new Map([[product.id, [emptyBatch]]]),
      roundCurrency: (value) => Number(Number(value || 0).toFixed(2))
    })).toThrow(/Disponible 0, requerido 1/);
  });

  it('receives 10 and sells 2 units offline, preserving the documented batch and sale on reopen', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await db.table(STORES.MENU).put({ ...strictProduct(), id: 'medicine-vi',
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } }
    });
    const request = {
      operationId: 'free-pharmacy-vi', productId: 'medicine-vi', quantity: 10, baseQuantity: 10,
      supplier: 'Proveedor QA', manufacturerBatchId: 'VI-QA-001', expiryDate: '2027-12-31',
      occurredAt: '2026-11-17T14:00:00.000Z', metadata: { pharmacyReceipt: {
        version: 1, supplier: 'Proveedor QA', documentType: 'factura',
        documentReference: 'F-QA-001', receivedAt: '2026-11-17T14:00:00.000Z',
        manufacturerBatchId: 'VI-QA-001', expiryDate: '2027-12-31'
      } }
    };
    const first = await addInventoryEntry(request);
    const retry = await addInventoryEntry(request);
    expect(first.newStock).toBe(10);
    expect(retry.duplicate).toBe(true);
    expect((await db.table(STORES.MENU).get('medicine-vi')).stock).toBe(10);
    expect((await db.table(STORES.PRODUCT_BATCHES).get(first.batch.id)).stock).toBe(10);
    expect((await db.table(STORES.INVENTORY_EVENTS).where('productId').equals('medicine-vi').toArray())).toHaveLength(1);
    expect(await db.table(POS_SYNC_STORES.OUTBOX).count()).toBe(0);

    const sale = {
      id: 'free-pharmacy-sale', status: 'closed', timestamp: new Date().toISOString(),
      paymentMethod: 'tarjeta', total: 50, abono: 50, saldoPendiente: 0,
      items: [{ id: 'medicine-vi', productId: 'medicine-vi', batchId: first.batch.id, quantity: 2, price: 25 }]
    };
    const result = await salesRepository.executeSaleTransaction(sale, [
      { batchId: first.batch.id, productId: 'medicine-vi', quantity: 2 }
    ]);
    expect(result.success).toBe(true);
    const database = getActiveTenantDatabase();
    database.close();
    await database.open();
    expect((await db.table(STORES.MENU).get('medicine-vi')).stock).toBe(8);
    expect((await db.table(STORES.PRODUCT_BATCHES).get(first.batch.id)).stock).toBe(8);
    expect((await db.table(STORES.SALES).get(sale.id)).items[0].quantity).toBe(2);
    const history = await db.table(STORES.INVENTORY_EVENTS).get('inventory-entry:free-pharmacy-vi');
    expect(history.metadata.pharmacyReceipt).toMatchObject({
      supplier: 'Proveedor QA', documentReference: 'F-QA-001', manufacturerBatchId: 'VI-QA-001',
      expiryDate: '2027-12-31'
    });
  });

  it('allocates a 15-unit sale across 10 + 27 units in two lots and persists 22 after reopen', async () => {
    const product = { ...strictProduct(), id: 'medicine-vi-multi', name: 'Medicamento VI multi lote',
      metadata: { pharmacy: { version: 1, kind: 'medicine', fraction: 'VI', status: 'confirmed' } } };
    await db.table(STORES.MENU).put(product);
    const first = await addInventoryEntry({
      operationId: 'free-pharmacy-lot-a', productId: product.id, quantity: 10, baseQuantity: 10,
      supplier: 'Proveedor QA', manufacturerBatchId: 'VI-LOT-A', expiryDate: '2027-01-31',
      occurredAt: '2026-11-17T14:00:00.000Z', metadata: { pharmacyReceipt: {
        version: 1, supplier: 'Proveedor QA', documentType: 'factura', documentReference: 'FAC-A',
        receivedAt: '2026-11-17T14:00:00.000Z', manufacturerBatchId: 'VI-LOT-A', expiryDate: '2027-01-31'
      } }
    });
    const second = await addInventoryEntry({
      operationId: 'free-pharmacy-lot-b', productId: product.id, quantity: 27, baseQuantity: 27, unitCost: 14,
      supplier: 'Proveedor QA', manufacturerBatchId: 'VI-LOT-B', expiryDate: '2028-01-31',
      occurredAt: '2026-11-17T15:00:00.000Z', metadata: { pharmacyReceipt: {
        version: 1, supplier: 'Proveedor QA', documentType: 'factura', documentReference: 'FAC-B',
        receivedAt: '2026-11-17T15:00:00.000Z', manufacturerBatchId: 'VI-LOT-B', expiryDate: '2028-01-31'
      } }
    });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(first.batch.id)).toMatchObject({ cost: 10, costSource: 'catalog_at_receipt' });
    expect(await db.table(STORES.PRODUCT_BATCHES).get(second.batch.id)).toMatchObject({ cost: 14, costSource: 'receipt' });
    expect((await db.table(STORES.MENU).get(product.id)).stock).toBe(37);

    const currentBatches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(product.id).toArray();
    const allocation = buildProcessedItemsAndDeductions({
      itemsToProcess: [
        { id: product.id, productId: product.id, quantity: 10, price: 25, batchId: first.batch.id, automaticPharmacyBatch: true },
        { id: product.id, productId: product.id, quantity: 5, price: 25, batchId: second.batch.id, automaticPharmacyBatch: true }
      ],
      allProducts: [product],
      batchesMap: new Map([[product.id, currentBatches]]),
      roundCurrency: (value) => Math.round(value * 100) / 100,
      now: new Date('2026-11-18T12:00:00.000Z')
    });
    expect(allocation.batchesToDeduct).toEqual([
      { batchId: first.batch.id, quantity: 10, productId: product.id, fromCommittedStock: false },
      { batchId: second.batch.id, quantity: 5, productId: product.id, fromCommittedStock: false }
    ]);

    const sale = {
      id: 'free-pharmacy-multi-sale', status: 'closed', timestamp: new Date().toISOString(),
      paymentMethod: 'tarjeta', total: 375, abono: 375, saldoPendiente: 0,
      items: allocation.processedItems, payments: [{ id: 'free-card-payment', method: 'card', amount: 375 }]
    };
    const result = await salesRepository.executeSaleTransaction(sale, allocation.batchesToDeduct);
    expect(result.success).toBe(true);

    const database = getActiveTenantDatabase();
    database.close();
    await database.open();
    const storedProduct = await db.table(STORES.MENU).get(product.id);
    const storedBatches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(product.id).toArray();
    expect(storedProduct.stock).toBe(22);
    expect(storedBatches.reduce((sum, batch) => sum + batch.stock, 0)).toBe(22);
    expect(storedBatches.find((batch) => batch.id === first.batch.id).stock).toBe(0);
    expect(storedBatches.find((batch) => batch.id === second.batch.id).stock).toBe(22);
    const persistedSale = await db.table(STORES.SALES).get(sale.id);
    expect(summarizeFinancialSales([persistedSale])).toMatchObject({
      totalRevenue: 375, totalCost: 170, grossProfit: 205, hasMissingCosts: false
    });
    expect(persistedSale.items.map((item) => [item.batchId, item.quantity]))
      .toEqual([[first.batch.id, 10], [second.batch.id, 5]]);
    expect(await db.table(STORES.INVENTORY_EVENTS).where('productId').equals(product.id)
      .filter((event) => event.type === 'INVENTORY_ENTRY').count()).toBe(2);

    const cancel = {
      saleId: sale.id, restoreStock: true, refunds: [{ method: 'card', amount: 375 }]
    };
    const deps = {
      db, STORES, generateId: () => 'free-pharmacy-multi-reversal',
      assertActorCurrent: vi.fn(),
      restoreStockFromCancellation: (items) => productsRepository.restoreStockFromCancellation(items)
    };
    expect(await cancelSaleCore(cancel, deps)).toMatchObject({ success: true, code: 'CANCELLED' });
    expect(await cancelSaleCore(cancel, deps)).toMatchObject({ success: true, code: 'ALREADY_CANCELLED' });
    expect((await db.table(STORES.MENU).get(product.id)).stock).toBe(37);
    expect((await db.table(STORES.PRODUCT_BATCHES).bulkGet([first.batch.id, second.batch.id]))
      .map((row) => row.stock)).toEqual([10, 27]);
    const report = await reportingService.getDashboardReport({ incluirCanceladas: true });
    expect(summarizeFinancialSales(report.sales)).toMatchObject({ totalRevenue: 0, totalCost: 0, grossProfit: 0 });
  });

  it('keeps local credit in the sale period and subsequent collections in the payment period', async () => {
    const customerId = 'free-financial-customer';
    await db.table(STORES.CUSTOMERS).put({ id: customerId, debt: '0', debtCents: 0 });
    const product = { ...strictProduct(), id: 'pharmacy-credit-item', stock: 10, cost: 60, price: 120,
      trackStock: false, batchManagement: { enabled: false },
      metadata: { pharmacy: { kind: 'other' } } };
    await db.table(STORES.MENU).put(product);
    const sale = {
      id: 'free-financial-credit', status: 'closed', timestamp: '2026-07-19T05:59:59.000Z',
      paymentMethod: 'fiado', total: 120, abono: 0, saldoPendiente: 120, customerId,
      items: [{ id: product.id, productId: product.id, quantity: 1, price: 120, cost: 60 }]
    };
    expect((await salesRepository.executeSaleTransaction(sale)).success).toBe(true);
    const firstPayment = await customerCreditRepository.processPayment(customerId, 50, 'transferencia');
    expect(firstPayment).toMatchObject({ success: true, newDebt: '70' });
    const database = getActiveTenantDatabase();
    database.close();
    await database.open();

    const salesRange = { start: '2026-07-18T06:00:00.000Z', end: '2026-07-19T05:59:59.999Z' };
    const salesReport = await reportingService.getDashboardReport({ rangoFechas: salesRange });
    const paymentsReport = await reportingService.getDashboardReport({ rangoFechas: {
      start: new Date(Date.now() - 60_000).toISOString()
    } });
    expect(summarizeLocalDashboardFinance({ ...salesReport, currentDebt: 70 })).toMatchObject({
      totalSales: 120, creditGenerated: { value: 120 }, collected: { value: 0 }, currentDebt: { value: 70 }
    });
    expect(summarizeLocalDashboardFinance({ ...paymentsReport, currentDebt: 70 })).toMatchObject({
      totalSales: 0, creditGenerated: { value: 0 }, collected: { value: 50 }, currentDebt: { value: 70 }
    });
    expect((await customerCreditRepository.processPayment(customerId, 70, 'tarjeta')).newDebt).toBe('0');
    const persisted = await db.table(STORES.SALES).get(sale.id);
    expect(persisted).toMatchObject({ abono: 0, saldoPendiente: 0 });
    expect(summarizeLocalDashboardFinance({ sales: [persisted] }).creditGenerated.value).toBe(120);
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
  });

  it('preserves incomplete cost for a single sale allocated across known and unknown lots', async () => {
    const product = {
      ...strictProduct(), id: 'general-mixed-cost',
      metadata: { pharmacy: { kind: 'other' } }
    };
    await db.table(STORES.MENU).put(product);
    const known = await addInventoryEntry({
      operationId: 'known-local-lot', productId: product.id, quantity: 1, baseQuantity: 1,
      manufacturerBatchId: 'KNOWN', expiryDate: '2027-01-31'
    });
    const unknown = await addInventoryEntry({
      operationId: 'unknown-local-lot', productId: product.id, quantity: 2, baseQuantity: 2,
      unitCost: 0, manufacturerBatchId: 'UNKNOWN', expiryDate: '2028-01-31'
    });
    const allocation = buildProcessedItemsAndDeductions({
      itemsToProcess: [{ id: product.id, productId: product.id, quantity: 2, price: 25 }],
      allProducts: [await db.table(STORES.MENU).get(product.id)],
      batchesMap: new Map([[product.id, await db.table(STORES.PRODUCT_BATCHES).bulkGet([known.batch.id, unknown.batch.id])]]),
      roundCurrency: (value) => Math.round(value * 100) / 100,
      now: new Date('2026-11-18T12:00:00.000Z')
    });
    const sale = {
      id: 'free-mixed-cost-sale', status: 'closed', timestamp: '2026-11-18T12:00:00.000Z',
      paymentMethod: 'tarjeta', total: 50, abono: 50, saldoPendiente: 0,
      items: allocation.processedItems
    };
    expect((await salesRepository.executeSaleTransaction(sale, allocation.batchesToDeduct)).success).toBe(true);
    const persisted = await db.table(STORES.SALES).get(sale.id);
    expect(persisted.items[0]).toMatchObject({ cost: null, inventoryCostTotal: null,
      batchesUsed: [{ cost: 10, costSource: 'lot_at_sale' }, { cost: 0, costSource: null }] });
    expect(summarizeFinancialSales([persisted], new Map([[product.id, 10]]))).toMatchObject({
      totalRevenue: 50, hasMissingCosts: true, missingCostItems: 2
    });
  });

});
