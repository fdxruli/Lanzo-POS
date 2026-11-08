import { describe, expect, it } from 'vitest';
import { reportsMapper } from '../reportsMapper';

describe('reportsMapper sales final history', () => {
  it('preserves scope, range and authoritative page metadata for reconciliation', () => {
    const dateRange = {
      date_from: '2026-10-09T12:00:00.000Z',
      date_to: '2026-11-08T12:00:00.000Z'
    };
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      scope: 'mine',
      date_range: dateRange,
      rows: [],
      total_count: 0,
      limit: 50,
      offset: 0,
      has_more: false
    });

    expect(mapped).toMatchObject({
      scope: 'mine',
      dateRange,
      totalCount: 0,
      offset: 0,
      hasMore: false,
      raw: { scope: 'mine', date_range: dateRange, total_count: 0, has_more: false }
    });
  });

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
    expect(mapped.rows[0].sourceModeKnown).toBe(true);
    expect(mapped.rows[0].source_mode_known).toBe(true);
    expect(mapped.rows[0].status).toBe('closed');
  });

  it('preserves a legacy shadow status as shadow even when source_mode is absent', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{
        sale_id: 'sale-shadow-fallback',
        status: 'shadow',
        total: 75
      }]
    });

    expect(mapped.rows[0]).toMatchObject({
      sourceMode: 'shadow',
      source_mode: 'shadow',
      sourceModeKnown: false,
      status: 'shadow'
    });
  });

  it('keeps the legacy cloud fallback for compatibility but marks a missing source as unknown', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{
        sale_id: 'sale-missing-source',
        status: 'closed',
        total: 75
      }]
    });

    expect(mapped.rows[0]).toMatchObject({
      sourceMode: 'cloud_committed',
      source_mode: 'cloud_committed',
      sourceModeKnown: false,
      source_mode_known: false,
      status: 'closed'
    });
  });

  it('preserves missing financial values and unknown totals instead of filling them with zero or page size', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{ sale_id: 'sale-without-financial-values', status: 'closed' }],
      limit: 50,
      offset: 0
    });

    expect(mapped.rows[0].total).toBeNull();
    expect(mapped.rows[0].amountPaid).toBeNull();
    expect(mapped.rows[0].balanceDue).toBeNull();
    expect(mapped.totalCount).toBeNull();
    expect(mapped.total_count).toBeNull();
    expect(mapped.hasMore).toBe(false);
  });

  it('does not assign the current time to a sale whose date is missing', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{ sale_id: 'sale-without-date', status: 'closed' }]
    });

    expect(mapped.rows[0].timestamp).toBeNull();
    expect(mapped.rows[0].soldAt).toBeNull();
  });

  it('marks local fallback rows as local when cloud source fields are absent', () => {
    const mapped = reportsMapper.normalizeSalesFinalHistoryPayload({
      rows: [{ id: 'local-sale', status: 'closed', total: 15 }],
      total_count: 1
    }, { mode: 'local' });

    expect(mapped.rows[0]).toMatchObject({
      sourceMode: 'local',
      sourceModeKnown: false
    });
  });
});
