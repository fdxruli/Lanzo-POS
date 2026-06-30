import { describe, expect, it } from 'vitest';
import {
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

  it('marca como caducado un producto STRICT con stock padre pero sin lotes disponibles', () => {
    const product = {
      id: 'strict-without-batches',
      trackStock: true,
      stock: 9,
      expirationMode: 'STRICT',
      batchManagement: { enabled: true },
    };

    expect(isExpiredForPosMenu(product, [], now)).toBe(true);
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
});
