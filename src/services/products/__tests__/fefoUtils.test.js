import { describe, expect, it } from 'vitest';
import {
  getAvailableBatchStock,
  getFefoWarningForSelection,
  getRecommendedFefoBatch,
  sortBatchesByFefo
} from '../fefoUtils';
import { getStrictExpirySaleGuard } from '../strictExpirySaleGuards';

describe('fefoUtils', () => {
  const today = new Date(2026, 5, 29);

  it('calcula stock disponible restando stock comprometido', () => {
    expect(getAvailableBatchStock({ stock: 10, committedStock: 3 })).toBe(7);
    expect(getAvailableBatchStock({ stock: 4, committed_stock: 10 })).toBe(0);
  });

  it('ordena lotes por fecha de caducidad y desempata por creación', () => {
    const sorted = sortBatchesByFefo([
      { id: 'b', expiryDate: '2026-07-10', createdAt: '2026-01-02' },
      { id: 'a', expiryDate: '2026-07-01', createdAt: '2026-01-03' },
      { id: 'c', expiryDate: '2026-07-01', createdAt: '2026-01-01' }
    ]);

    expect(sorted.map((batch) => batch.id)).toEqual(['c', 'a', 'b']);
  });

  it('recomienda el lote activo con stock que vence primero', () => {
    const product = { expirationMode: 'STRICT' };
    const recommended = getRecommendedFefoBatch([
      { id: 'newer', isActive: true, stock: 5, expiryDate: '2026-08-01', createdAt: '2026-01-01' },
      { id: 'oldest', isActive: true, stock: 5, expiryDate: '2026-07-01', createdAt: '2026-01-02' },
      { id: 'inactive', isActive: false, stock: 5, expiryDate: '2026-06-30', createdAt: '2026-01-03' }
    ], product, { now: today });

    expect(recommended.id).toBe('oldest');
  });

  it('no recomienda lotes vencidos en modo STRICT pero permite los que vencen hoy', () => {
    const product = { expirationMode: 'STRICT' };
    const recommended = getRecommendedFefoBatch([
      { id: 'expired', isActive: true, stock: 5, expiryDate: '2026-06-28', createdAt: '2026-01-01' },
      { id: 'today', isActive: true, stock: 5, expiryDate: '2026-06-29', createdAt: '2026-01-02' }
    ], product, { now: today });

    expect(recommended.id).toBe('today');
  });

  it('advierte cuando se elige un lote más nuevo que el recomendado', () => {
    const warning = getFefoWarningForSelection({
      product: { expirationMode: 'STRICT' },
      selectedBatch: { id: 'newer', isActive: true, stock: 5, sku: 'NUEVO', expiryDate: '2026-08-01' },
      recommendedBatch: { id: 'older', isActive: true, stock: 5, sku: 'VIEJO', expiryDate: '2026-07-01' },
      now: today
    });

    expect(warning.blocking).toBe(false);
    expect(warning.message).toContain('VIEJO');
  });

  it('bloquea venta STRICT cuando todo el stock disponible está vencido', () => {
    const guard = getStrictExpirySaleGuard({
      product: { expirationMode: 'STRICT', batchManagement: { enabled: true } },
      batches: [
        { id: 'expired', isActive: true, stock: 4.5, expiryDate: '2026-06-18' }
      ],
      now: today
    });

    expect(guard.blocked).toBe(true);
    expect(guard.expiredAvailableStock).toBe(4.5);
  });

  it('permite venta STRICT si existe lote vigente o que vence hoy', () => {
    const guard = getStrictExpirySaleGuard({
      product: { expirationMode: 'STRICT', batchManagement: { enabled: true } },
      batches: [
        { id: 'today', isActive: true, stock: 4.5, expiryDate: '2026-06-29' }
      ],
      now: today
    });

    expect(guard.blocked).toBe(false);
    expect(guard.recommendedBatch.id).toBe('today');
  });

  it('no convierte SHELF_LIFE vencido en bloqueo obligatorio', () => {
    const guard = getStrictExpirySaleGuard({
      product: { expirationMode: 'SHELF_LIFE', batchManagement: { enabled: true } },
      batches: [
        { id: 'expired', isActive: true, stock: 4.5, expiryDate: '2026-06-18' }
      ],
      now: today
    });

    expect(guard.blocked).toBe(false);
  });
});
