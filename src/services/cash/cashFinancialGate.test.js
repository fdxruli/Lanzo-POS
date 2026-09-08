import { describe, expect, it } from 'vitest';
import {
  CASH_FINANCIAL_CODES,
  CASH_FINANCIAL_STATUS,
  CashFinancialError,
  assertCashFinancialWriteAccess,
  deriveCashFinancialState
} from './cashFinancialGate';

const DEVICE_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const STATION_A = `cash_station_device_${DEVICE_UUID_A}`;
const LOCAL_STATION_A = 'local:device:fp-browser-a';

const session = (actorKey, id = 'c1') => ({
  id,
  status: 'open',
  actorKey,
  cashStationId: STATION_A
});

describe('cash financial gate', () => {
  it('keeps the previous owner and requires an explicit handoff for another actor', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: STATION_A,
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
      cashStationId: STATION_A,
      cashSession: session('staff:b')
    });

    expect(state.status).toBe(CASH_FINANCIAL_STATUS.OWN_SESSION_OPEN);
    expect(assertCashFinancialWriteAccess({
      state,
      actorKey: 'staff:b',
      cashStationId: STATION_A,
      cashSessionId: 'c1'
    }).id).toBe('c1');
  });

  it('blocks an unknown cloud station while offline instead of opening a new box', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: STATION_A,
      online: false,
      cloudEnabled: true,
      stateKnown: false
    });

    expect(state.status).toBe(CASH_FINANCIAL_STATUS.BLOCKED);
    expect(state.code).toBe(CASH_FINANCIAL_CODES.HANDOFF_REQUIRES_ONLINE);
    expect(() => assertCashFinancialWriteAccess({ state, actorKey: 'staff:b' }))
      .toThrow(CashFinancialError);
  });

  it('blocks every financial write while cloud state is unknown, even with a cached open session', () => {
    const state = deriveCashFinancialState({
      actorKey: 'staff:b',
      cashStationId: STATION_A,
      cashSession: session('staff:b'),
      online: true,
      cloudEnabled: true,
      stateKnown: false,
      networkUnavailable: true
    });

    expect(state.code).toBe(CASH_FINANCIAL_CODES.NETWORK_UNAVAILABLE);
    expect(state.status).toBe(CASH_FINANCIAL_STATUS.BLOCKED);
    expect(() => assertCashFinancialWriteAccess({
      state,
      actorKey: 'staff:b',
      cashStationId: STATION_A,
      cashSessionId: 'c1'
    })).toThrow(CashFinancialError);
  });

  it('does not reinterpret a session when the station differs', () => {
    const state = deriveCashFinancialState({
      actorKey: 'admin:a',
      cashStationId: STATION_A,
      cashSession: session('admin:a')
    });

    let error = null;
    try {
      assertCashFinancialWriteAccess({
        state,
        actorKey: 'admin:a',
        cashStationId: 'cash_station_device_650e8400-e29b-41d4-a716-446655440001',
        cashSessionId: 'c1'
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(CashFinancialError);
    expect(error.code).toBe(CASH_FINANCIAL_CODES.STATION_MISMATCH);
  });

  it('rejects a canonical cloud station when the caller only has a local storage key', () => {
    const state = deriveCashFinancialState({
      actorKey: 'admin:a',
      cashStationId: LOCAL_STATION_A,
      localStationKey: LOCAL_STATION_A,
      cashSession: {
        ...session('admin:a'),
        cashStationId: STATION_A
      }
    });

    expect(() => assertCashFinancialWriteAccess({
      state,
      actorKey: 'admin:a',
      localStationKey: LOCAL_STATION_A,
      cashSessionId: 'c1'
    })).toThrowError(expect.objectContaining({ code: CASH_FINANCIAL_CODES.STATION_MISMATCH }));
  });

  it('accepts an exact canonical station without using the browser fingerprint', () => {
    const state = deriveCashFinancialState({
      actorKey: 'admin:a',
      cashStationId: STATION_A,
      cashSession: {
        ...session('admin:a'),
        cashStationId: STATION_A
      }
    });

    expect(assertCashFinancialWriteAccess({
      state,
      actorKey: 'admin:a',
      cashStationId: STATION_A,
      cashSessionId: 'c1'
    })).toMatchObject({ cashStationId: 'cash_station_device_550e8400-e29b-41d4-a716-446655440000' });
  });
});
