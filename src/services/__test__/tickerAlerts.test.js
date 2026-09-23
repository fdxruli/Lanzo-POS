import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryTickerInventoryAlerts } from '../tickerAlerts';

describe('queryTickerInventoryAlerts', () => {
  let testDb;

  beforeEach(async () => {
    testDb = new Dexie(`ticker-alerts-${crypto.randomUUID()}`, {
      indexedDB,
      IDBKeyRange
    });
    testDb.version(1).stores({
      menu: 'id, lowStockAlertStatus',
      product_batches: 'id, productId, [activeStockStatus+alertTargetDate]'
    });
    await testDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.delete();
  });

  it('materializa stock bajo y próximos a vencer desde candidatos locales', async () => {
    await testDb.table('menu').bulkAdd([
      {
        id: 'low',
        name: 'Leche',
        stock: 4,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 1
      },
      {
        id: 'healthy',
        name: 'Cafe',
        stock: 20,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      },
      {
        id: 'expiring',
        name: 'Yogur',
        stock: 10,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      }
    ]);
    await testDb.table('product_batches').add({
      id: 'batch-expiring',
      productId: 'expiring',
      stock: 3,
      committedStock: 0,
      isActive: true,
      activeStockStatus: 1,
      alertTargetDate: '2026-06-13T12:00:00.000Z'
    });

    const batchWhere = vi.spyOn(testDb.table('product_batches'), 'where');
    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.catalogSize).toBe(3);
    expect(result.alerts.map(alert => alert.id)).toEqual([
      'stock-low',
      'expiry-batch-expiring'
    ]);
    expect(result.alerts[0]).toMatchObject({
      type: 'low-stock',
      availableStock: 4,
      minStock: 5
    });
    expect(result.alerts[1]).toMatchObject({
      type: 'expiry',
      expiryDays: 2
    });
    expect(batchWhere).toHaveBeenCalledWith(
      '[activeStockStatus+alertTargetDate]'
    );
  });

  it('aplica el limite del ticker después de construir el snapshot operacional completo', async () => {
    await testDb.table('menu').bulkAdd(
      Array.from({ length: 10 }, (_, index) => ({
        id: `low-${index}`,
        name: `Low ${index}`,
        stock: 1,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 1
      }))
    );

    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.catalogSize).toBe(10);
    expect(result.alerts).toHaveLength(8);
  });

  it('mantiene agotados y lotes ya vencidos visibles con prioridad crítica', async () => {
    await testDb.table('menu').bulkAdd([
      {
        id: 'out',
        name: 'Agotado',
        stock: 2,
        committedStock: 3,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      },
      {
        id: 'expired-parent',
        name: 'Caducado',
        stock: 10,
        committedStock: 0,
        minStock: 5,
        trackStock: true,
        isActive: true,
        lowStockAlertStatus: 0
      }
    ]);
    await testDb.table('product_batches').add({
      id: 'batch-expired',
      productId: 'expired-parent',
      stock: 2,
      committedStock: 0,
      isActive: true,
      activeStockStatus: 1,
      alertTargetDate: '2026-06-10T00:00:00.000Z'
    });

    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date(2026, 5, 11, 12, 0, 0),
      limit: 8
    });

    expect(result.alerts).toEqual([
      expect.objectContaining({
        id: 'expiry-batch-expired',
        type: 'expired',
        urgency: 0,
        expiryDays: -1
      }),
      expect.objectContaining({
        id: 'stock-out',
        type: 'out-of-stock',
        urgency: 0,
        availableStock: -1
      })
    ]);
  });
});
