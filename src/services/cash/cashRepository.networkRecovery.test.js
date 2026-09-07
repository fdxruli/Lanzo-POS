import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEVICE_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const DEVICE_UUID_B = '650e8400-e29b-41d4-a716-446655440001';
const STATION_A = `cash_station_device_${DEVICE_UUID_A}`;
const STATION_B = `cash_station_device_${DEVICE_UUID_B}`;

const runtime = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    readOnly: false,
    stateKnown: false,
    networkUnavailable: false,
    licenseKey: 'license-test',
    actor: { actorKey: 'admin:one', isStaff: false, staffUserId: null }
  },
  station: {
    deviceFingerprint: 'fp-browser-a',
    localStationKey: 'local:device:fp-browser-a',
    cashStationId: null,
    deviceId: null,
    identityState: 'legacy_unresolved'
  },
  current: vi.fn(),
  stationState: vi.fn(),
  localState: vi.fn(),
  projection: vi.fn(),
  history: vi.fn()
}));

vi.mock('../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../cloud', () => ({ invalidateCloudCacheAfterCashMutation: vi.fn() }));
vi.mock('../sync/idempotency', () => ({ generateIdempotencyKey: vi.fn(() => 'idempotency-key') }));
vi.mock('../sync/syncConstants', () => ({
  SYNC_ENTITY_TYPES: { CASH_SESSION: 'cash_session' },
  SYNC_OPERATIONS: { OPEN: 'open', ADJUST: 'adjust', CLOSE: 'close' }
}));
vi.mock('../sync/posSyncOrchestrator', () => ({ posSyncOrchestrator: { pullIncremental: vi.fn() } }));
vi.mock('./cashCloudRepository', () => ({
  cashCloudRepository: {
    getCurrentCashSession: (...args) => runtime.current(...args),
    getCashStationState: (...args) => runtime.stationState(...args),
    pullCashSnapshot: vi.fn()
  }
}));
vi.mock('./cashLocalRepository', () => ({
  cashLocalRepository: {
    getFinancialState: (...args) => runtime.localState(...args),
    loadProjection: (...args) => runtime.projection(...args),
    getHistory: (...args) => runtime.history(...args),
    applyCloudCashSession: vi.fn(),
    applyCloudCashSessions: vi.fn(),
    applyCloudCashMovement: vi.fn(),
    applyCloudCashMovements: vi.fn()
  },
  getCashLocalProjectionDiagnostics: () => ({
    invalidCashSessionRecords: 0,
    invalidCashMovementRecords: 0
  })
}));
vi.mock('./cashStation', () => ({
  getCashStationIdentity: () => runtime.station,
  CASH_STATION_IDENTITY_STATE: {
    CANONICAL: 'canonical',
    LOCAL: 'local',
    LEGACY_UNRESOLVED: 'legacy_unresolved'
  },
  isCanonicalCashStation: (value) => Boolean(value && !String(value).startsWith('local:device:')),
  areCashStationsEquivalent: (left, right) => Boolean(left && right && left === right),
  persistCashStationBinding: vi.fn(),
  getCashStationIdFromCloudResponse: (response = {}) => response?.cash_station?.id
    || response?.cash_station_id
    || response?.cashStationId
    || response?.cash_session?.cash_station_id
    || null
}));
vi.mock('./cashActor', () => ({
  CASH_CLOUD_OFFLINE_MESSAGE: 'Caja cloud sin conexión.',
  getCashMode: () => runtime.mode
}));
vi.mock('./cashPermissions', () => ({ assertCanUseCashRegister: vi.fn(), canAuditCashSessions: vi.fn(() => true) }));
vi.mock('./cashMapper', () => ({ localClosingToCloudPayload: vi.fn((value) => value), localOpeningToCloudPayload: vi.fn((value) => value) }));
vi.mock('../financial/financialIntentLedger', () => ({
  markFinancialIntentProjectionApplied: vi.fn(),
  markFinancialIntentProjectionFailed: vi.fn()
}));
vi.mock('../financial/financialProjectionRegistry', () => ({ registerFinancialProjectionHandler: vi.fn() }));
vi.mock('./cashSyncHandler', () => ({}));

import Logger from '../Logger';
import { cashRepository } from './cashRepository';

const cachedSession = {
  id: 'cash-local-known',
  estado: 'abierta',
  actorKey: 'admin:one',
  cashStationId: STATION_A,
  fecha_apertura: '2026-09-06T09:00:00.000Z'
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.mode.online = true;
  runtime.mode.readOnly = false;
  runtime.mode.stateKnown = false;
  runtime.mode.networkUnavailable = false;
  runtime.current.mockReset();
  runtime.stationState.mockReset();
  runtime.localState.mockResolvedValue({
    status: 'OWN_SESSION_OPEN',
    code: null,
    cashSession: cachedSession,
    stationOpenCashSession: cachedSession,
    cashStationId: STATION_A,
    actorKey: 'admin:one',
    stateKnown: false,
    online: true,
    cloudEnabled: true
  });
  runtime.projection.mockResolvedValue({ movements: [], totals: { ventasContado: '0', abonosFiado: '0' } });
  runtime.history.mockResolvedValue([cachedSession]);
});

describe('cashRepository network recovery', () => {
  it('does not throw for Failed to fetch and logs the outage once', async () => {
    runtime.current.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(cashRepository.getCurrentCashSession()).resolves.toMatchObject({
      success: true,
      readOnly: true,
      stateKnown: false,
      networkUnavailable: true,
      financialCode: 'CASH_NETWORK_UNAVAILABLE',
      cashSession: { id: cachedSession.id }
    });
    await cashRepository.getCurrentCashSession();
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(runtime.stationState).not.toHaveBeenCalled();
  });

  it('converts ERR_CONNECTION_CLOSED into a safe read-only result without a second warning', async () => {
    runtime.current.mockRejectedValue(new Error('net::ERR_CONNECTION_CLOSED'));

    await expect(cashRepository.getCurrentCashSession()).resolves.toMatchObject({
      readOnly: true,
      stateKnown: false,
      networkUnavailable: true,
      financialCode: 'CASH_NETWORK_UNAVAILABLE'
    });
    expect(Logger.warn).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, 503])('maps temporary HTTP %s to the same protected result', async (status) => {
    runtime.current.mockRejectedValue(Object.assign(new Error(`HTTP ${status}`), { status }));

    await expect(cashRepository.getCurrentCashSession()).resolves.toMatchObject({
      success: true,
      readOnly: true,
      stateKnown: false,
      networkUnavailable: true,
      financialCode: 'CASH_NETWORK_UNAVAILABLE'
    });
  });

  it('keeps a real online station mismatch as a financial inconsistency, not a network outage', async () => {
    runtime.current.mockResolvedValue({
      success: true,
      cash_session: {
        id: 'cash-b',
        status: 'open',
        actor_key: 'admin:one',
        cash_station_id: STATION_B
      },
      actor_key: 'admin:one'
    });
    runtime.stationState.mockResolvedValue({
      success: true,
      cash_station: { id: STATION_A, device_id: DEVICE_UUID_A },
      station_open_cash_session: null
    });

    await expect(cashRepository.getCurrentCashSession()).resolves.toMatchObject({
      success: true,
      readOnly: true,
      stateKnown: false,
      networkUnavailable: false,
      financialCode: 'CASH_SESSION_STATION_MISMATCH'
    });
    expect(runtime.stationState).toHaveBeenCalledTimes(1);
  });
});
