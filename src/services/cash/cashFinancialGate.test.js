import { describe, expect, it } from 'vitest';
import {
  CASH_FINANCIAL_CODES,
  CASH_FINANCIAL_STATUS,
  CashFinancialError,
  assertCashFinancialWriteAccess,
  deriveCashFinancialState
} from './cashFinancialGate';

const session = (actorKey, id = 'c1') => ({
  id,
  status: 'open',
  actorKey,
  cashStationId: 'station-s'
});

describe('cash financial gate', () => {
  it('keeps the previous owner and requires an explicit handoff for another actor', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: 'station-s',
      stationOpenCashSession: session('admin:a')
    });

    expect(state.status).toBe(CASH_FINANCIAL_STATUS.HANDOFF_REQUIRED);
    expect(state.code).toBe(CASH_FINANCIAL_CODES.HANDOFF_REQUIRED);
    expect(state.cashSession).toBeNull();
    expect(state.stationOpenCashSession.actorKey).toBe('admin:a');
  });

  it('allows only the exact actor and station to mutate its own session', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: 'station-s',
      cashSession: session('staff:b')
    });

    expect(state.status).toBe(CASH_FINANCIAL_STATUS.OWN_SESSION_OPEN);
    expect(assertCashFinancialWriteAccess({
      state,
      actorKey: 'staff:b',
      cashStationId: 'station-s',
      cashSessionId: 'c1'
    }).id).toBe('c1');
  });

  it('blocks an unknown cloud station while offline instead of opening a new box', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: 'station-s',
      online: false,
      cloudEnabled: true,
      stateKnown: false
    });

    expect(state.status).toBe(CASH_FINANCIAL_STATUS.BLOCKED);
    expect(state.code).toBe(CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE);
    expect(() => assertCashFinancialWriteAccess({ state, actorKey: 'staff:b' }))
      .toThrow(CashFinancialError);
  });

  it('does not reinterpret a session when the station differs', () => {
    const state = deriveCashFinancialState({
      actorKey: 'admin:a',
      cashStationId: 'station-s',
      cashSession: session('admin:a')
    });

    let error = null;
    try {
      assertCashFinancialWriteAccess({
        state,
        actorKey: 'admin:a',
        cashStationId: 'station-other',
        cashSessionId: 'c1'
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(CashFinancialError);
    expect(error.code).toBe(CASH_FINANCIAL_CODES.STATION_MISMATCH);
  });

  it('accepts the canonical server station for a legacy local station alias', () => {
    const state = deriveCashFinancialState({
      actorKey: 'admin:a',
      cashStationId: 'local:device:A',
      cashSession: {
        ...session('admin:a'),
        cashStationId: 'cash_station_device_A'
      }
    });

    expect(assertCashFinancialWriteAccess({
      state,
      actorKey: 'admin:a',
      cashStationId: 'local:device:A',
      cashSessionId: 'c1'
    })).toMatchObject({ cashStationId: 'cash_station_device_A' });
  });
});
