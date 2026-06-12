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

  it('materializa solo alertas obtenidas por indices', async () => {
    await testDb.table('menu').bulkAdd([
      {
        id: 'low',
        name: 'Leche',
        stock: 4,
        committedStock: 0,
        trackStock: true,
        lowStockAlertStatus: 1
      },
      {
        id: 'healthy',
        name: 'Cafe',
        stock: 20,
        committedStock: 0,
        trackStock: true,
        lowStockAlertStatus: 0
      },
      {
        id: 'expiring',
        name: 'Yogur',
        stock: 10,
        trackStock: true,
        lowStockAlertStatus: 0
      }
    ]);
    await testDb.table('product_batches').add({
      id: 'batch-expiring',
      productId: 'expiring',
      activeStockStatus: 1,
      alertTargetDate: '2026-06-13T12:00:00.000Z'
    });

    const menuWhere = vi.spyOn(testDb.table('menu'), 'where');
    const batchWhere = vi.spyOn(testDb.table('product_batches'), 'where');
    const result = await queryTickerInventoryAlerts({
      database: testDb,
      now: new Date('2026-06-11T12:00:00'),
      limit: 8
    });

    expect(result.catalogSize).toBe(3);
    expect(result.alerts.map(alert => alert.id)).toEqual([
      'stock-low',
      'expiry-batch-expiring'
    ]);
    expect(menuWhere).toHaveBeenCalledWith('lowStockAlertStatus');
    expect(batchWhere).toHaveBeenCalledWith(
      '[activeStockStatus+alertTargetDate]'
    );
  });
});
