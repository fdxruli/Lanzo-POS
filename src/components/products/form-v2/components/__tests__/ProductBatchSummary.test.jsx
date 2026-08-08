import { describe, expect, it } from 'vitest';
import { getProductBatchSummary } from '../ProductBatchSummary';

describe('getProductBatchSummary', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');

  it('cuenta activos y muestra la caducidad FEFO vigente más próxima', () => {
    const result = getProductBatchSummary([
      { id: 'late', isActive: true, expiryDate: '2026-12-01' },
      { id: 'next', isActive: true, expiryDate: '2026-09-20' },
      { id: 'latest', isActive: true, expiryDate: '2027-01-05' },
      { id: 'archived', isActive: true, status: 'archived', expiryDate: '2026-08-08' }
    ], now);

    expect(result).toMatchObject({ activeBatchCount: 3, nextExpiryDate: '2026-09-20', nearestExpiryDate: '2026-09-20' });
  });

  it('no inventa una fecha cuando los lotes activos no la tienen', () => {
    expect(getProductBatchSummary([{ id: 'a', isActive: true }, { id: 'b', isActive: true, expiryDate: 'invalida' }], now))
      .toMatchObject({ activeBatchCount: 2, nextExpiryDate: null, nearestExpiryDate: null });
  });

  it('reporta que no hay lotes activos', () => {
    expect(getProductBatchSummary([{ id: 'inactive', isActive: false, expiryDate: '2026-10-15' }], now))
      .toMatchObject({ activeBatchCount: 0, nextExpiryDate: null, nearestExpiryDate: null });
  });
});
