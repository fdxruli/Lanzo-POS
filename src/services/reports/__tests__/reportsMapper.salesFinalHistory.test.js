import { describe, expect, it } from 'vitest';
import { reportsMapper } from '../reportsMapper';

describe('reportsMapper sales final history', () => {
  it('preserves authoritative sales source, status and cancellation fields from Supabase rows', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{
        sale_id: 'sale-source-test',
        source_mode: 'legacy_imported',
        status: 'cancelled',
        cancelled_at: '2026-09-21T12:34:56.000Z',
        cancellation_id: 'cancel-source-test',
        net_total: 125,
        items_count: 0,
        items_quantity: 0
      }],
      total_count: 1,
      limit: 100,
      offset: 0,
      has_more: false
    });

    expect(mapped.rows).toHaveLength(1);
    expect(mapped.rows[0]).toMatchObject({
      source_mode: 'legacy_imported',
      sourceMode: 'legacy_imported',
      status: 'cancelled',
      cancelled_at: '2026-09-21T12:34:56.000Z',
      cancelledAt: '2026-09-21T12:34:56.000Z',
      cancellation_id: 'cancel-source-test',
      cancellationId: 'cancel-source-test'
    });
  });

  it('preserves camelCase sourceMode without silently replacing it', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{
        sale_id: 'sale-cloud-test',
        sourceMode: 'cloud_committed',
        status: 'closed',
        total: 50
      }]
    });

    expect(mapped.rows[0].sourceMode).toBe('cloud_committed');
    expect(mapped.rows[0].source_mode).toBe('cloud_committed');
    expect(mapped.rows[0].status).toBe('closed');
  });
});
