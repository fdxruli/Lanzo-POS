import { describe, expect, it } from 'vitest';
import { formatShelfLife, getProductBatchSummary, getProductBatchSummaryMap, getProductCardExpiryState } from '../productBatchSummary';

describe('product batch summaries', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');

  it('uses the nearest active batch instead of a product-level expiry date', () => {
    const summary = getProductBatchSummary([
      { id: 'later', productId: 'rice', isActive: true, expiryDate: '2026-09-20' },
      { id: 'near', productId: 'rice', isActive: true, expiryDate: '2026-08-12', manufacturerBatchId: 'AB-LOTE-001', supplier: 'Proveedor' }
    ], now);
    const state = getProductCardExpiryState({ id: 'rice', expiryDate: '2027-01-01' }, summary, now);

    expect(summary).toMatchObject({ nearestExpiryDate: '2026-08-12', manufacturerBatchId: 'AB-LOTE-001', supplier: 'Proveedor', batchId: 'near' });
    expect(state).toMatchObject({ expiryDate: '2026-08-12', isNearingExpiry: true, daysUntilExpiry: 4 });
  });

  it('creates summaries for all visible products in one map', () => {
    const summaries = getProductBatchSummaryMap([
      { id: 'a', productId: 'one', isActive: true, expiryDate: '2026-08-20' },
      { id: 'b', productId: 'two', isActive: true, expiryDate: '2026-08-10' }
    ], now);
    expect(summaries.get('one').nearestExpiryDate).toBe('2026-08-20');
    expect(summaries.get('two').nearestExpiryDate).toBe('2026-08-10');
  });

  it('formats the shelf-life product policy independently of the batch date', () => {
    expect(formatShelfLife(30, 'days')).toBe('30 días');
    expect(formatShelfLife(4, 'weeks')).toBe('4 semanas');
  });
});
