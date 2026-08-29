import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    licenseKey: 'license-test',
    actor: { actorKey: 'admin:shared', isStaff: false, deviceRole: 'admin' }
  },
  station: {
    deviceId: 'A',
    cashStationId: 'local:device:A',
    identityState: 'deterministic-device-bound'
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
  registerProjectionHandler: vi.fn()
}));

const normalizeStation = (value) => String(value || '').trim();
const stationSuffix = (value) => {
  const normalized = normalizeStation(value);
  if (normalized.startsWith('local:device:')) return normalized.slice('local:device:'.length);
  if (normalized.startsWith('cash_station_device_')) return normalized.slice('cash_station_device_'.length);
  return null;
};

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
  getCashStationIdentity: () => runtime.station,
  areCashStationsEquivalent: (left, right) => {
    const leftId = normalizeStation(left);
    const rightId = normalizeStation(right);
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;
    return stationSuffix(leftId) !== null && stationSuffix(leftId) === stationSuffix(rightId);
  },
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

import { cashRepository } from './cashRepository';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.station = {
    deviceId: 'A',
    cashStationId: 'local:device:A',
    identityState: 'deterministic-device-bound'
  };
  runtime.mode.actor = { actorKey: 'admin:shared', isStaff: false, deviceRole: 'admin' };
  runtime.openCashSession.mockResolvedValue({
    success: true,
    cash_station: { id: 'cash_station_device_A' },
    cash_session: {
      id: 'cash-a',
      status: 'open',
      actor_key: 'admin:shared'
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
  it('accepts a canonical server session for the equivalent legacy local station', async () => {
    const result = await cashRepository.openCashSession({ montoInicial: '100' });

    expect(result).toMatchObject({
      success: true,
      cashStationId: 'cash_station_device_A',
      cashSession: {
        id: 'cash-a',
        cashStationId: 'cash_station_device_A'
      }
    });
    expect(runtime.applyCloudCashSession).toHaveBeenCalledWith(expect.objectContaining({
      cash_station_id: 'cash_station_device_A'
    }));
  });

  it('rejects a server session from device B while the client is on device A', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      cash_station: { id: 'cash_station_device_B' },
      cash_session: { id: 'cash-b', status: 'open', actor_key: 'admin:shared' }
    });

    await expect(cashRepository.openCashSession({ montoInicial: '100' }))
      .rejects.toMatchObject({ code: 'CASH_SESSION_STATION_MISMATCH' });
    expect(runtime.applyCloudCashSession).not.toHaveBeenCalled();
  });

  it('uses the canonical server preflight station even when its id is not the local alias', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      resolvedCashStationId: 'cash_station_device_internal_A',
      cash_station: { id: 'cash_station_device_internal_A' },
      cash_session: { id: 'cash-internal-a', status: 'open', actor_key: 'admin:shared' }
    });

    const result = await cashRepository.openCashSession({ montoInicial: '100' });

    expect(result).toMatchObject({
      success: true,
      cashStationId: 'cash_station_device_internal_A',
      cashSession: { cashStationId: 'cash_station_device_internal_A' }
    });
  });

  it('rejects inconsistent station evidence instead of accepting a shared prefix', async () => {
    runtime.openCashSession.mockResolvedValue({
      success: true,
      resolvedCashStationId: 'cash_station_device_A',
      cash_station: { id: 'cash_station_device_A_suffix' },
      cash_session: { id: 'cash-suffix', status: 'open', actor_key: 'admin:shared' }
    });

    await expect(cashRepository.openCashSession({ montoInicial: '100' }))
      .rejects.toMatchObject({ code: 'CASH_SESSION_STATION_MISMATCH' });
  });
});
