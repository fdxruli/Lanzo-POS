import { describe, expect, it } from 'vitest';
import {
  getAgedOpenCashSessions,
  getConfirmedOpenCashSessions,
  getNextCashSessionAgeTransitionAt
} from './cashSessionAgeAttention';

const actorKey = 'admin:owner';
const now = Date.parse('2026-11-08T12:00:00.000Z');
const session = (id, hoursOld, overrides = {}) => ({
  id,
  actor_key: actorKey,
  status: 'open',
  opened_at: new Date(now - hoursOld * 60 * 60 * 1000).toISOString(),
  ...overrides
});

const cloudResult = (sessions, overrides = {}) => ({
  success: true,
  readOnly: false,
  networkUnavailable: false,
  stateKnown: true,
  mode: { cloudEnabled: true },
  actor: { actorKey },
  adminOpenSessions: sessions,
  response: { admin_open_sessions: sessions },
  ...overrides
});

describe('getConfirmedOpenCashSessions', () => {
  it('does not turn an error, unavailable state, or missing Cloud source into zero', () => {
    expect(getConfirmedOpenCashSessions({
      result: { ...cloudResult([]), response: {} },
      isCloudCash: true,
      actorKey
    })).toBeNull();
    expect(getConfirmedOpenCashSessions({
      result: { ...cloudResult([]), success: false },
      isCloudCash: true,
      actorKey
    })).toBeNull();
    expect(getConfirmedOpenCashSessions({
      result: { ...cloudResult([]), networkUnavailable: true },
      isCloudCash: true,
      actorKey
    })).toBeNull();
  });

  it('uses the authoritative Cloud list and deduplicates the current session', () => {
    const current = session('current', 4);
    const old = session('old', 25);
    const sessions = getConfirmedOpenCashSessions({
      result: cloudResult([current, old], { cashSession: current }),
      isCloudCash: true,
      actorKey
    });
    expect(sessions.map((item) => item.id)).toEqual(['current', 'old']);
  });

  it('uses only the current actor own local session', () => {
    const own = session('local-own', 30);
    const other = session('local-other', 45, { actor_key: 'admin:other' });
    const localResult = {
      success: true,
      stateKnown: true,
      readOnly: false,
      mode: { cloudEnabled: false },
      actor: { actorKey },
      cashSession: own
    };
    expect(getConfirmedOpenCashSessions({
      result: localResult,
      isCloudCash: false,
      actorKey
    })).toEqual([own]);
    expect(getConfirmedOpenCashSessions({
      result: { ...localResult, cashSession: other },
      isCloudCash: false,
      actorKey
    })).toEqual([]);
  });
});

describe('getAgedOpenCashSessions', () => {
  it('groups only 24 hour and older sessions, keeping three day sessions highest', () => {
    const aged = getAgedOpenCashSessions([
      session('warning', 12),
      session('important', 24),
      session('review', 72),
      session('invalid', 100, { opened_at: 'not-a-date' }),
      session('closed', 100, { status: 'closed' })
    ], now);

    expect(aged.map(({ session: item, age }) => [item.id, age.level])).toEqual([
      ['review', 'review'],
      ['important', 'important']
    ]);
  });

  it('schedules only the next age boundary for known open sessions', () => {
    const openedTenHoursAgo = session('soon', 10);
    const openedTwentyFiveHoursAgo = session('later', 25);
    const invalid = session('invalid', 5, { opened_at: 'not-a-date' });

    expect(getNextCashSessionAgeTransitionAt([
      openedTenHoursAgo,
      openedTwentyFiveHoursAgo,
      invalid
    ], now)).toBe(now + 2 * 60 * 60 * 1000);
    expect(getNextCashSessionAgeTransitionAt([
      session('already-old', 100, { opened_at: 'not-a-date' })
    ], now)).toBeNull();
  });
});
