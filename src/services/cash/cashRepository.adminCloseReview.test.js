import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    licenseKey: 'license-test',
    actor: { actorKey: 'admin:reviewer', isStaff: false }
  },
  actorContext: {
    actorKey: 'admin:reviewer',
    generation: 1,
    assertCurrent: vi.fn()
  },
  adminClose: vi.fn(),
  applyCloudCashSession: vi.fn(),
  markProjectionApplied: vi.fn(),
  markProjectionFailed: vi.fn(),
  invalidateCashCache: vi.fn(),
  pullIncremental: vi.fn(),
  registerProjectionHandler: vi.fn()
}));

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
  cashCloudRepository: { adminCloseCashSession: (...args) => runtime.adminClose(...args) }
}));
vi.mock('./cashLocalRepository', () => ({
  cashLocalRepository: {
    applyCloudCashSession: (...args) => runtime.applyCloudCashSession(...args)
  }
}));
vi.mock('./cashStation', () => ({
  getCashStationIdentity: vi.fn(),
  areCashStationsEquivalent: (left, right) => {
    const normalize = (value) => String(value || '').trim();
    const leftId = normalize(left);
    const rightId = normalize(right);
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;
    const suffix = (value) => value.startsWith('local:device:')
      ? value.slice('local:device:'.length)
      : value.startsWith('cash_station_device_')
        ? value.slice('cash_station_device_'.length)
        : null;
    return suffix(leftId) !== null && suffix(leftId) === suffix(rightId);
  },
  getCashStationIdFromCloudResponse: (response = {}) => response?.cash_station?.id
    || response?.cash_station_id
    || response?.resolvedCashStationId
    || response?.cash_session?.cash_station_id
    || null
}));
vi.mock('./cashFinancialGate', () => ({
  CASH_FINANCIAL_CODES: {
    HANDOFF_REQUIRED: 'CASH_HANDOFF_REQUIRED',
    STATION_UNRESOLVED: 'CASH_STATION_UNRESOLVED',
    STATION_MISMATCH: 'CASH_SESSION_STATION_MISMATCH',
    SESSION_REQUIRED: 'CASH_SESSION_REQUIRED'
  },
  CASH_FINANCIAL_STATUS: {
    HANDOFF_REQUIRED: 'HANDOFF_REQUIRED',
    BLOCKED: 'BLOCKED'
  },
  assertCashFinancialWriteAccess: vi.fn(),
  captureCashActorContext: () => runtime.actorContext,
  CashFinancialError: class CashFinancialError extends Error {
    constructor(code, message, details = {}) {
      super(message);
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
  markFinancialIntentProjectionApplied: (...args) => runtime.markProjectionApplied(...args),
  markFinancialIntentProjectionFailed: (...args) => runtime.markProjectionFailed(...args)
}));
vi.mock('../financial/financialProjectionRegistry', () => ({
  registerFinancialProjectionHandler: (...args) => runtime.registerProjectionHandler(...args)
}));
vi.mock('./cashSyncHandler', () => ({}));

import { cashRepository, cashRepositoryInternals } from './cashRepository';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.applyCloudCashSession.mockImplementation(async (session) => ({
    id: session.id,
    actorKey: session.actor_key,
    serverVersion: session.server_version,
    total_teorico_cloud: session.expected_cash_total
  }));
});

describe('cashRepository administrative close review delivery', () => {
  it('rejects a current-session payload that belongs to another station', () => {
    const mode = { actor: { actorKey: 'admin:reviewer' } };

    expect(() => cashRepositoryInternals.assertResponseOwnSession({
      cash_session: {
        id: 'cash-station-a',
        actor_key: 'admin:reviewer',
        cash_station_id: 'station-a',
        status: 'open'
      }
    }, mode, 'station-b')).toThrowError(expect.objectContaining({
      code: 'CASH_SESSION_STATION_MISMATCH'
    }));
  });

  it.each(['VERSION_CONFLICT', 'CASH_TOTALS_CHANGED'])(
    'projects and surfaces the complete %s response without claiming closure',
    async (code) => {
      const response = {
        success: false,
        code,
        message: code === 'VERSION_CONFLICT'
          ? 'La versión de la caja cambió.'
          : 'Los totales de caja cambiaron.',
        cash_session: {
          id: 'cash-foreign-staff',
          actor_key: 'staff:owner',
          status: 'open',
          expected_cash_total: '1200',
          server_version: 5
        },
        financialIntentId: `intent-${code.toLowerCase()}`
      };
      runtime.adminClose.mockResolvedValue(response);

      const result = await cashRepository.adminCloseCashSession({
        cashSessionId: 'cash-foreign-staff',
        closingMode: 'admin_audited',
        countedAmount: '1180',
        nextShiftFund: '100',
        reasonCode: 'operational_error',
        comments: 'Revisión administrativa explícita.',
        expectedVersion: 4,
        idempotencyKey: 'original-human-confirmation-key'
      });

      expect(result).toEqual({
        success: false,
        code,
        message: response.message,
        response
      });
      expect(result.response).toBe(response);
      expect(runtime.adminClose).toHaveBeenCalledTimes(1);
      expect(runtime.adminClose).toHaveBeenCalledWith(expect.objectContaining({
        cashSessionId: 'cash-foreign-staff',
        expectedVersion: 4,
        idempotencyKey: 'original-human-confirmation-key'
      }));
      expect(runtime.applyCloudCashSession).toHaveBeenCalledOnce();
      expect(runtime.applyCloudCashSession).toHaveBeenCalledWith(response.cash_session);
      expect(runtime.markProjectionApplied).toHaveBeenCalledWith({
        intentId: response.financialIntentId,
        actorHandle: runtime.actorContext
      });
      expect(runtime.markProjectionFailed).not.toHaveBeenCalled();
      expect(runtime.invalidateCashCache).not.toHaveBeenCalled();
      expect(runtime.pullIncremental).not.toHaveBeenCalled();
    }
  );

  it('does not project an unrelated administrative rejection', async () => {
    const response = {
      success: false,
      code: 'ADMIN_CASH_CLOSE_REASON_REQUIRED',
      message: 'Falta el motivo.',
      cash_session: { id: 'cash-foreign-staff', status: 'open' },
      financialIntentId: 'intent-unrelated'
    };
    runtime.adminClose.mockResolvedValue(response);

    await expect(cashRepository.adminCloseCashSession({
      cashSessionId: 'cash-foreign-staff',
      closingMode: 'admin_audited',
      reasonCode: '',
      expectedVersion: 4,
      idempotencyKey: 'rejected-key'
    })).resolves.toMatchObject({ success: false, code: response.code, response });

    expect(runtime.applyCloudCashSession).not.toHaveBeenCalled();
    expect(runtime.markProjectionApplied).not.toHaveBeenCalled();
  });

  it('keeps the durable review response visible when local projection fails', async () => {
    const projectionError = Object.assign(new Error('No se pudo guardar la proyección.'), {
      code: 'CASH_LOCAL_PROJECTION_FAILED'
    });
    const response = {
      success: false,
      code: 'CASH_TOTALS_CHANGED',
      message: 'Los totales de caja cambiaron.',
      cash_session: {
        id: 'cash-foreign-staff',
        actor_key: 'staff:owner',
        status: 'open',
        expected_cash_total: '1210',
        server_version: 8
      },
      financialIntentId: 'intent-projection-failed'
    };
    runtime.adminClose.mockResolvedValue(response);
    runtime.applyCloudCashSession.mockRejectedValue(projectionError);

    const result = await cashRepository.adminCloseCashSession({
      cashSessionId: 'cash-foreign-staff',
      closingMode: 'admin_audited',
      countedAmount: '1180',
      nextShiftFund: '100',
      reasonCode: 'operational_error',
      comments: 'Revisión administrativa explícita.',
      expectedVersion: 7,
      idempotencyKey: 'projection-failure-key'
    });

    expect(result).toEqual({
      success: false,
      code: 'CASH_TOTALS_CHANGED',
      message: response.message,
      response
    });
    expect(result.response.cash_session).toBe(response.cash_session);
    expect(runtime.markProjectionApplied).not.toHaveBeenCalled();
    expect(runtime.markProjectionFailed).toHaveBeenCalledWith({
      intentId: response.financialIntentId,
      errorCode: 'CASH_LOCAL_PROJECTION_FAILED',
      actorHandle: runtime.actorContext
    });
    expect(runtime.invalidateCashCache).not.toHaveBeenCalled();
    expect(runtime.pullIncremental).not.toHaveBeenCalled();
  });
});
