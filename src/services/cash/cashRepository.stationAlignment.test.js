import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    licenseKey: 'license-test',
    actor: { actorKey: 'admin:shared', isStaff: false, deviceRole: 'admin' }
  },
  station: {
    deviceFingerprint: 'fp-browser-a',
    localStationKey: 'local:device:fp-browser-a',
    cashStationId: null,
    deviceId: null,
    identityState: 'legacy_unresolved'
  },
  actorContext: {
    actorKey: 'admin:shared',
    generation: 1,
    assertCurrent: vi.fn()
  },
  openCashSession: vi.fn(),
  applyCloudCashSession: vi.fn(),
  pullIncremental: vi.fn(() => Promise.resolve()),
  invalidateCashCache: vi.fn(),
  registerProjectionHandler: vi.fn(),
  persistBinding: vi.fn()
}));

const normalizeStation = (value) => String(value || '').trim();
const DEVICE_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const DEVICE_UUID_B = '650e8400-e29b-41d4-a716-446655440001';
const STATION_A = `cash_station_device_${DEVICE_UUID_A}`;
const STATION_B = `cash_station_device_${DEVICE_UUID_B}`;
const isCanonicalStation = (value) => /^cash_station_device_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeStation(value));

vi.mock('../Logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../cloud', () => ({
  invalidateCloudCacheAfterCashMutation: (...args) => runtime.invalidateCashCache(...args)
}));
vi.mock('../sync/idempotency', () => ({ generateIdempotencyKey: vi.fn(() => 'generated-key') }));
vi.mock('../sync/syncConstants', () => ({
  SYNC_ENTITY_TYPES: { CASH_SESSION: 'cash_session' },
  SYNC_OPERATIONS: { OPEN: 'open', CLOSE: 'close' }
}));
vi.mock('../sync/posSyncOrchestrator', () => ({
  posSyncOrchestrator: { pullIncremental: (...args) => runtime.pullIncremental(...args) }
}));
vi.mock('./cashCloudRepository', () => ({
  cashCloudRepository: { openCashSession: (...args) => runtime.openCashSession(...args) }
}));
vi.mock('./cashLocalRepository', () => ({
  cashLocalRepository: {
    applyCloudCashSession: (...args) => runtime.applyCloudCashSession(...args)
  }
}));
vi.mock('./cashStation', () => ({
  CASH_STATION_IDENTITY_STATE: {
    CANONICAL: 'canonical',
    LOCAL: 'local',
    LEGACY_UNRESOLVED: 'legacy_unresolved'
  },
  getCashStationIdentity: () => runtime.station,
  isCanonicalCashStation: (value) => isCanonicalStation(value),
  areCashStationsEquivalent: (left, right) => Boolean(
    isCanonicalStation(left)
    && isCanonicalStation(right)
    && normalizeStation(left) === normalizeStation(right)
  ),
  persistCashStationBinding: (...args) => runtime.persistBinding(...args),
  getCashStationIdFromCloudResponse: (response = {}) => [
    response?.cash_station?.id,
    response?.cashStation?.id,
    response?.cash_station_id,
    response?.cashStationId,
    response?.resolvedCashStationId,
    response?.cash_session?.cash_station_id,
    response?.cash_session?.cashStationId,
    response?.cash_session?.metadata?.cash_station_id,
    response?.cash_session?.metadata?.cashStationId
  ].map(normalizeStation).find(Boolean) || null
}));
vi.mock('./cashFinancialGate', () => ({
  CASH_FINANCIAL_CODES: {
    HANDOFF_REQUIRED: 'CASH_HANDOFF_REQUIRED',
    HANDOFF_REQUIRES_ONLINE: 'CASH_HANDOFF_REQUIRES_ONLINE',
    STATION_UNRESOLVED: 'CASH_STATION_UNRESOLVED',
    STATION_MISMATCH: 'CASH_SESSION_STATION_MISMATCH',
    SESSION_REQUIRED: 'CASH_SESSION_REQUIRED'
  },
  CASH_FINANCIAL_STATUS: {
    HANDOFF_REQUIRED: 'HANDOFF_REQUIRED',
    BLOCKED: 'BLOCKED',
    NO_SESSION: 'NO_SESSION'
  },
  assertCashFinancialWriteAccess: vi.fn(),
  captureCashActorContext: () => runtime.actorContext,
  CashFinancialError: class CashFinancialError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'CashFinancialError';
      this.code = code;
      this.details = details;
    }
  },
  deriveCashFinancialState: vi.fn(() => ({ status: 'READY' }))
}));
vi.mock('./cashActor', () => ({
  CASH_CLOUD_OFFLINE_MESSAGE: 'Caja cloud sin conexión.',
  getCashMode: () => runtime.mode
}));
vi.mock('./cashPermissions', () => ({
  assertCanUseCashRegister: vi.fn(),
  canAuditCashSessions: vi.fn(() => true)
}));
vi.mock('./cashMapper', () => ({
  localClosingToCloudPayload: vi.fn((value) => value),
  localOpeningToCloudPayload: vi.fn((value) => value)
}));
vi.mock('../financial/financialIntentLedger', () => ({
  markFinancialIntentProjectionApplied: vi.fn(),
  markFinancialIntentProjectionFailed: vi.fn()
}));
vi.mock('../financial/financialProjectionRegistry', () => ({
  registerFinancialProjectionHandler: (...args) => runtime.registerProjectionHandler(...args)
}));
vi.mock('./cashSyncHandler', () => ({}));

import { cashRepository, cashRepositoryInternals } from './cashRepository';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.station = {
    deviceFingerprint: 'fp-browser-a',
    localStationKey: 'local:device:fp-browser-a',
    cashStationId: null,
    deviceId: null,
    identityState: 'legacy_unresolved'
  };
  runtime.mode.actor = { actorKey: 'admin:shared', isStaff: false, deviceRole: 'admin' };
  runtime.openCashSession.mockResolvedValue({
    success: true,
    cash_station: { id: STATION_A, device_id: DEVICE_UUID_A },
    cash_session: {
      id: 'cash-a',
      status: 'open',
      actor_key: 'admin:shared',
      cash_station_id: STATION_A
    }
  });
  runtime.applyCloudCashSession.mockImplementation(async (session) => ({
    ...session,
    cashStationId: session.cash_station_id
      || session.cashStationId
      || session.metadata?.cash_station_id
      || null
  }));
});

describe('cashRepository cloud station alignment', () => {
  it('accepts the canonical station returned for the authenticated fingerprint', async () => {
    const result = await cashRepository.openCashSession({ montoInicial: '100' });

    expect(result).toMatchObject({
      success: true,
      cashStationId: STATION_A,
      cashSession: {
        id: 'cash-a',
        cashStationId: STATION_A
      }
    });
    expect(runtime.persistBinding).toHaveBeenCalledWith(expect.objectContaining({
      deviceFingerprint: 'fp-browser-a',
      cashStationId: STATION_A,
      deviceId: DEVICE_UUID_A
    }));
    expect(runtime.applyCloudCashSession).toHaveBeenCalledWith(expect.objectContaining({
      cash_station_id: STATION_A
    }));
  });

  it('rejects station B when the device is already bound to station A', async () => {
    runtime.station = {
      deviceFingerprint: 'fp-browser-a',
      localStationKey: 'local:device:fp-browser-a',
      cashStationId: STATION_A,
      deviceId: DEVICE_UUID_A,
      identityState: 'canonical'
    };
    runtime.openCashSession.mockResolvedValue({
      success: true,
      cash_station: { id: STATION_B, device_id: DEVICE_UUID_B },
      cash_session: {
        id: 'cash-b',
        status: 'open',
        actor_key: 'admin:shared',
        cash_station_id: STATION_B
      }
    });

    await expect(cashRepository.openCashSession({ montoInicial: '100' }))
      .rejects.toMatchObject({ code: 'CASH_SESSION_STATION_MISMATCH' });
    expect(runtime.persistBinding).not.toHaveBeenCalled();
    expect(runtime.applyCloudCashSession).not.toHaveBeenCalled();
  });

  it('does not accept a raw or partial station identifier as cloud authority', () => {
    expect(() => cashRepositoryInternals.assertCloudResponseStation({
      response: { cash_station_id: 'station-A' }
    })).toThrowError(expect.objectContaining({ code: 'CASH_STATION_UNRESOLVED' }));

    expect(() => cashRepositoryInternals.assertCloudResponseStation({
      response: { cash_station_id: STATION_A, resolvedCashStationId: STATION_B }
    })).toThrowError(expect.objectContaining({ code: 'CASH_SESSION_STATION_MISMATCH' }));
  });

  it('rejects a session from station B when cloud authority says the request is for station A', () => {
    expect(() => cashRepositoryInternals.assertCloudResponseStation({ response: {
      cash_station_id: STATION_A,
      cash_session: {
        id: 'cash-b',
        status: 'open',
        actor_key: 'admin:shared',
        cash_station_id: STATION_B
      }
    } })).toThrowError(expect.objectContaining({ code: 'CASH_SESSION_STATION_MISMATCH' }));
  });

  it('does not infer station B from the browser fingerprint when the server returns B', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      cash_station: { id: STATION_B, device_id: DEVICE_UUID_B },
      cash_session: { id: 'cash-b', status: 'open', actor_key: 'admin:shared', cash_station_id: STATION_B }
    });

    await expect(cashRepository.openCashSession({ montoInicial: '100' }))
      .resolves.toMatchObject({ cashStationId: STATION_B });
  });

  it('uses the canonical server preflight station even when its id is not the local alias', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      resolvedCashStationId: STATION_A,
      cash_station: { id: STATION_A, device_id: DEVICE_UUID_A },
      cash_session: { id: 'cash-internal-a', status: 'open', actor_key: 'admin:shared', cash_station_id: STATION_A }
    });

    const result = await cashRepository.openCashSession({ montoInicial: '100' });

    expect(result).toMatchObject({
      success: true,
      cashStationId: STATION_A,
      cashSession: { cashStationId: STATION_A }
    });
  });

  it('rejects inconsistent station evidence instead of accepting a shared prefix', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      resolvedCashStationId: STATION_A,
      cash_station: { id: `${STATION_A}_suffix` },
      cash_session: { id: 'cash-suffix', status: 'open', actor_key: 'admin:shared', cash_station_id: `${STATION_A}_suffix` }
    });

    await expect(cashRepository.openCashSession({ montoInicial: '100' }))
      .rejects.toMatchObject({ code: 'CASH_SESSION_STATION_MISMATCH' });
  });
});
