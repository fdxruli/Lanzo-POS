import { describe, expect, it } from 'vitest';
import {
  buildBusinessCashSummary,
  canShowBusinessCashSummary,
  getCashSessionAge
} from './businessCashSummary';

const session = (id, expected, overrides = {}) => ({
  id,
  status: 'open',
  opening_amount: '0',
  cash_sales_total: '0',
  customer_payments_total: '0',
  cash_entries_total: '0',
  cash_exits_total: '0',
  expected_cash_total: String(expected ?? 0),
  opened_at: '2026-08-10T12:00:00.000Z',
  ...overrides
});

describe('buildBusinessCashSummary', () => {
  it('uses one admin session as both business and current cash', () => {
    const current = session('admin-a', 75);
    expect(buildBusinessCashSummary([current], current)).toMatchObject({ openCount: 1, expectedCashTotal: '75', currentActorTotal: '75', otherAdminTotal: '0', staffTotal: '0' });
  });

  it('does not double count the current session included by admin_open_sessions', () => {
    const current = session('admin-current', 75);
    expect(buildBusinessCashSummary([session('admin-old', 1196), current], current)).toMatchObject({ openCount: 2, expectedCashTotal: '1271', currentActorTotal: '75', otherAdminTotal: '1196' });
  });

  it('separates multiple admins and staff using canonical expected cash totals', () => {
    const current = session('admin-current', 75);
    const summary = buildBusinessCashSummary([
      session('admin-old', 1196), current,
      session('staff-1', 81, { device_role: 'staff', staff_user_id: 'staff-1' }),
      session('staff-2', 0, { actor_key: 'staff:staff-2' })
    ], current);
    expect(summary).toMatchObject({ openCount: 4, expectedCashTotal: '1352', currentActorTotal: '75', otherAdminTotal: '1196', staffTotal: '81' });
  });

  it('excludes closed, cancelled and deleted sessions and never returns NaN', () => {
    const summary = buildBusinessCashSummary([
      session('open', 0, { expected_cash_total: null }),
      session('closed', 100, { status: 'closed' }),
      session('cancelled', 100, { status: 'cancelled' }),
      session('deleted', 100, { deleted_at: '2026-08-10T12:00:00.000Z' })
    ]);
    expect(summary).toMatchObject({ openCount: 1, expectedCashTotal: '0' });
    expect(Number.isNaN(Number(summary.expectedCashTotal))).toBe(false);
  });
});

describe('getCashSessionAge', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');
  it.each([
    ['2026-08-14T02:00:00.000Z', 'normal'],
    ['2026-08-14T00:00:00.000Z', 'warning'],
    ['2026-08-13T12:00:00.000Z', 'important'],
    ['2026-08-11T12:00:00.000Z', 'review']
  ])('classifies an opened session as %s', (openedAt, level) => {
    expect(getCashSessionAge(openedAt, now).level).toBe(level);
  });
});

describe('canShowBusinessCashSummary', () => {
  it('only enables the administrative cloud summary while online', () => {
    expect(canShowBusinessCashSummary({ isCloudCash: true, adminOpenSessions: [] })).toBe(true);
    expect(canShowBusinessCashSummary({ isCloudCash: true, isReadOnly: true, adminOpenSessions: [] })).toBe(false);
    expect(canShowBusinessCashSummary({ isCloudCash: true, cashActor: { isStaff: true }, adminOpenSessions: [] })).toBe(false);
    expect(canShowBusinessCashSummary({ isCloudCash: false, adminOpenSessions: [] })).toBe(false);
  });
});
