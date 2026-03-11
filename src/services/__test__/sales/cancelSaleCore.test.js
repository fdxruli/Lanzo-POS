import { describe, expect, it, vi } from 'vitest';
import { cancelSaleCore } from '../../sales/cancelSaleCore';

const STORES = {
  SALES: 'sales',
  DELETED_SALES: 'deleted_sales',
  PRODUCT_BATCHES: 'product_batches',
  MENU: 'menu'
};

const makeDb = (batchesByProduct = {}) => ({
  table: vi.fn(() => ({
    where: vi.fn(() => ({
      equals: vi.fn((productId) => ({
        toArray: vi.fn(async () => batchesByProduct[productId] || [])
      }))
    }))
  }))
});

const makeDeps = (overrides = {}) => ({
  loadData: vi.fn(async () => null),
  saveDataSafe: vi.fn(async () => ({ success: true })),
  recycleData: vi.fn(async () => ({ success: true })),
  STORES,
  db: makeDb(),
  Logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  ...overrides
});

describe('cancelSaleCore', () => {
  it('cancela sin restaurar stock cuando restoreStock=false', async () => {
    const deps = makeDeps();
    const sale = { id: 'sale-1', timestamp: '2026-02-27T10:00:00.000Z', items: [] };

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        restoreStock: false,
        currentSales: [sale]
      },
      deps
    );

    expect(result).toEqual({
      success: true,
      code: 'DELETED',
      restoreStock: false,
      warnings: []
    });
    expect(deps.saveDataSafe).not.toHaveBeenCalled();
    expect(deps.recycleData).toHaveBeenCalledWith(
      STORES.SALES,
      STORES.DELETED_SALES,
      sale.id,
      'Eliminado manualmente - Inventario NO Devuelto (Merma)'
    );
  });

  it('restaura lotes y sincroniza stock visual del padre cuando restoreStock=true', async () => {
    const sale = {
      id: 'sale-2',
      timestamp: '2026-02-27T11:00:00.000Z',
      items: [
        {
          id: 'dish-1',
          batchesUsed: [
            { batchId: 'batch-1', ingredientId: 'ingredient-1', quantity: 3 }
          ]
        }
      ]
    };

    const deps = makeDeps({
      loadData: vi.fn(async (store, key) => {
        if (store === STORES.PRODUCT_BATCHES && key === 'batch-1') {
          return {
            id: 'batch-1',
            productId: 'ingredient-1',
            stock: 2,
            isActive: false
          };
        }

        if (store === STORES.MENU && key === 'ingredient-1') {
          return {
            id: 'ingredient-1',
            name: 'Harina',
            stock: 0,
            trackStock: true
          };
        }

        return null;
      }),
      db: makeDb({
        'ingredient-1': [
          { id: 'batch-1', stock: 5, isActive: true },
          { id: 'batch-archived', stock: 10, isActive: false }
        ]
      })
    });

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        restoreStock: true,
        currentSales: [sale]
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe('DELETED');
    expect(result.warnings).toEqual([]);
    expect(deps.saveDataSafe).toHaveBeenCalledWith(
      STORES.PRODUCT_BATCHES,
      expect.objectContaining({
        id: 'batch-1',
        stock: 5,
        isActive: true
      })
    );
    expect(deps.saveDataSafe).toHaveBeenCalledWith(
      STORES.MENU,
      expect.objectContaining({
        id: 'ingredient-1',
        stock: 5
      })
    );
  });

  it('restaura producto simple usando stockDeducted antes de quantity', async () => {
    const sale = {
      id: 'sale-3',
      timestamp: '2026-02-27T12:00:00.000Z',
      items: [
        {
          id: 'prod-1',
          quantity: 1,
          stockDeducted: 3
        }
      ]
    };

    const deps = makeDeps({
      loadData: vi.fn(async (store, key) => {
        if (store === STORES.MENU && key === 'prod-1') {
          return {
            id: 'prod-1',
            stock: 10,
            trackStock: true
          };
        }
        return null;
      })
    });

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        restoreStock: true,
        currentSales: [sale]
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(deps.saveDataSafe).toHaveBeenCalledWith(
      STORES.MENU,
      expect.objectContaining({
        id: 'prod-1',
        stock: 13
      })
    );
  });

  it('continua en modo best-effort y retorna warnings si falla una restauracion parcial', async () => {
    const sale = {
      id: 'sale-4',
      timestamp: '2026-02-27T13:00:00.000Z',
      items: [
        {
          id: 'dish-1',
          batchesUsed: [{ batchId: 'batch-fail', ingredientId: 'ing-1', quantity: 2 }]
        }
      ]
    };

    const deps = makeDeps({
      loadData: vi.fn(async (store, key) => {
        if (store === STORES.PRODUCT_BATCHES && key === 'batch-fail') {
          return { id: 'batch-fail', productId: 'ing-1', stock: 1, isActive: true };
        }
        return null;
      }),
      saveDataSafe: vi.fn(async () => ({ success: false, message: 'write failed' }))
    });

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        restoreStock: true,
        currentSales: [sale]
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe('DELETED');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].code).toBe('BATCH_SAVE_FAILED');
    expect(deps.recycleData).toHaveBeenCalledOnce();
  });

  it('retorna RECYCLE_FAILED cuando no puede mover la venta a papelera', async () => {
    const sale = { id: 'sale-5', timestamp: '2026-02-27T14:00:00.000Z', items: [] };
    const deps = makeDeps({
      recycleData: vi.fn(async () => ({ success: false, message: 'db locked' }))
    });

    const result = await cancelSaleCore(
      {
        saleTimestamp: sale.timestamp,
        restoreStock: false,
        currentSales: [sale]
      },
      deps
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('RECYCLE_FAILED');
    expect(result.message).toBe('db locked');
  });

  it('retorna NOT_FOUND cuando la venta no existe', async () => {
    const deps = makeDeps({
      loadData: vi.fn(async (store) => {
        if (store === STORES.SALES) return [];
        return null;
      })
    });

    const result = await cancelSaleCore(
      {
        saleTimestamp: '2026-02-27T15:00:00.000Z',
        restoreStock: false,
        currentSales: []
      },
      deps
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.warnings).toEqual([]);
  });
});

