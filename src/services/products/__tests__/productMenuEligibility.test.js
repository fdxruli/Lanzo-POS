import { describe, expect, it } from 'vitest';
import {
  getPosMenuExpirationState,
  isExpiredForPosMenu,
  isOutOfStockForPosMenu,
} from '../productMenuEligibility';

const now = new Date('2026-06-30T12:00:00.000Z');

describe('productMenuEligibility', () => {
  it('marca como agotado un producto simple sin stock disponible', () => {
    expect(isOutOfStockForPosMenu({
      id: 'simple-1',
      trackStock: true,
      stock: 0,
      committedStock: 0,
    })).toBe(true);
  });

  it('marca como caducado un producto STRICT con stock solo en lotes vencidos', () => {
    const product = {
      id: 'strict-1',
      trackStock: true,
      stock: 4,
      expirationMode: 'STRICT',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'b-1', productId: 'strict-1', stock: 4, isActive: true, expiryDate: '2026-06-29' },
    ];

    expect(isExpiredForPosMenu(product, batches, now)).toBe(true);
  });

  it('marca como regularizacion un producto STRICT con stock padre pero sin lotes disponibles', () => {
    const product = {
      id: 'strict-without-batches',
      trackStock: true,
      stock: 9,
      expirationMode: 'STRICT',
      batchManagement: { enabled: true },
    };

    const state = getPosMenuExpirationState(product, [], now);
    expect(state).toMatchObject({
      expired: false,
      regularizationRequired: true,
      noCurrentBatch: true,
      reason: 'stock_without_active_available_batches',
    });
    expect(isExpiredForPosMenu(product, [], now)).toBe(false);
  });

  it('mantiene vendible un producto STRICT con al menos un lote vigente', () => {
    const product = {
      id: 'strict-2',
      trackStock: true,
      stock: 6,
      expirationMode: 'STRICT',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'b-old', productId: 'strict-2', stock: 2, isActive: true, expiryDate: '2026-06-29' },
      { id: 'b-ok', productId: 'strict-2', stock: 4, isActive: true, expiryDate: '2026-07-01' },
    ];

    expect(isExpiredForPosMenu(product, batches, now)).toBe(false);
  });

  it('marca como caducado un producto SHELF_LIFE si todos sus lotes disponibles vencieron', () => {
    const product = {
      id: 'shelf-1',
      trackStock: true,
      stock: 3,
      expirationMode: 'SHELF_LIFE',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'b-1', productId: 'shelf-1', stock: 3, isActive: true, expiryDate: '2026-06-29' },
    ];

    expect(isExpiredForPosMenu(product, batches, now)).toBe(true);
  });

  it('no marca como caducado un producto SHELF_LIFE con lote futuro disponible', () => {
    const product = {
      id: 'volt',
      trackStock: true,
      stock: 2,
      expirationMode: 'SHELF_LIFE',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'batch-volt-initial', productId: 'volt', stock: 2, isActive: true, expiryDate: '2027-01-24' },
    ];

    expect(getPosMenuExpirationState(product, batches, now)).toMatchObject({
      expired: false,
      regularizationRequired: false,
      noCurrentBatch: false,
    });
    expect(isExpiredForPosMenu(product, batches, now)).toBe(false);
  });

  it('marca SHELF_LIFE con lote activo sin fecha como regularizacion, no caducado real', () => {
    const product = {
      id: 'shelf-missing-date',
      trackStock: true,
      stock: 2,
      expirationMode: 'SHELF_LIFE',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'batch-missing', productId: 'shelf-missing-date', stock: 2, isActive: true },
    ];

    const state = getPosMenuExpirationState(product, batches, now);
    expect(state).toMatchObject({
      expired: false,
      regularizationRequired: true,
      noCurrentBatch: true,
      reason: 'shelf_life_batch_missing_target_date',
    });
    expect(isExpiredForPosMenu(product, batches, now)).toBe(false);
  });

  it('marca STRICT con lote activo sin fecha como regularizacion, no caducado real', () => {
    const product = {
      id: 'strict-missing-date',
      trackStock: true,
      stock: 3,
      expirationMode: 'STRICT',
      batchManagement: { enabled: true },
    };

    const batches = [
      { id: 'batch-missing', productId: 'strict-missing-date', stock: 3, isActive: true },
    ];

    const state = getPosMenuExpirationState(product, batches, now);
    expect(state).toMatchObject({
      expired: false,
      regularizationRequired: true,
      noCurrentBatch: true,
      reason: 'strict_batch_missing_expiry_date',
    });
    expect(isExpiredForPosMenu(product, batches, now)).toBe(false);
  });
});
