import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildContext: vi.fn()
}));

vi.mock('../supabase', () => ({
  supabaseClient: { rpc: (...args) => fixtures.rpc(...args) }
}));

vi.mock('../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: (...args) => fixtures.buildContext(...args)
}));

import { postDowngradeCashReconciliation } from './postDowngradeCashReconciliation';

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.buildContext.mockResolvedValue({
    licenseKey: 'TEST-LICENSE',
    deviceFingerprint: 'device-a',
    securityToken: 'security-a',
    staffSessionToken: 'owner-session-a'
  });
});

describe('postDowngradeCashReconciliation', () => {
  it('lists only through the dedicated historical bridge contract', async () => {
    fixtures.rpc.mockResolvedValue({
      data: {
        success: true,
        cash_sessions: [{ id: 'cash-a', status: 'open' }],
        pending_count: 1
      },
      error: null
    });

    const result = await postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' });

    expect(fixtures.rpc).toHaveBeenCalledWith('pos_list_post_downgrade_cash_sessions', {
      p_license_key: 'TEST-LICENSE',
      p_device_fingerprint: 'device-a',
      p_security_token: 'security-a',
      p_actor_session_token: 'owner-session-a'
    });
    expect(result).toMatchObject({ success: true, pendingCount: 1 });
  });

  it('uses the dedicated detail contract and normalizes its read model', async () => {
    fixtures.rpc.mockResolvedValue({
      data: {
        success: true,
        cash_session: { id: 'cash-a', status: 'open' },
        movements: [{ id: 'movement-a' }],
        audit_events: [{ id: 'audit-a' }]
      },
      error: null
    });

    const result = await postDowngradeCashReconciliation.detail({
      licenseKey: 'TEST-LICENSE',
      cashSessionId: 'cash-a'
    });

    expect(fixtures.rpc).toHaveBeenCalledWith('pos_get_post_downgrade_cash_session_detail', expect.objectContaining({
      p_cash_session_id: 'cash-a'
    }));
    expect(result).toEqual({
      success: true,
      cashSession: { id: 'cash-a', status: 'open' },
      movements: [{ id: 'movement-a' }],
      auditEvents: [{ id: 'audit-a' }]
    });
  });

  it('does not expose raw PostgreSQL details for owner authorization failures', async () => {
    fixtures.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'POST_DOWNGRADE_CASH_OWNER_REQUIRED',
        details: 'internal function context'
      }
    });

    await expect(postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' }))
      .rejects.toMatchObject({
        bridgeCode: 'POST_DOWNGRADE_CASH_OWNER_REQUIRED',
        message: 'Sólo el propietario puede reconciliar cajas pendientes después del cambio de plan.'
      });
  });

  it('preserves refreshed conflict snapshots for the existing audit modal', async () => {
    fixtures.rpc.mockResolvedValue({
      data: {
        success: false,
        code: 'CASH_TOTALS_CHANGED',
        message: 'server message',
        cash_session: { id: 'cash-a', server_version: 8 }
      },
      error: null
    });

    const result = await postDowngradeCashReconciliation.close({
      licenseKey: 'TEST-LICENSE',
      cashSessionId: 'cash-a',
      closingMode: 'admin_audited',
      countedAmount: '100',
      nextShiftFund: '0',
      reasonCode: 'abandoned_session',
      comments: 'Conteo revisado.',
      expectedVersion: 7,
      idempotencyKey: 'bridge-key-a'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'CASH_TOTALS_CHANGED',
      internalCode: 'CASH_TOTALS_CHANGED',
      response: {
        cash_session: { id: 'cash-a', server_version: 8 }
      }
    });
  });

  it('keeps non-actionable internal codes out of the modal-facing code field', async () => {
    fixtures.rpc.mockResolvedValue({
      data: {
        success: false,
        code: 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE',
        message: 'raw'
      },
      error: null
    });

    const result = await postDowngradeCashReconciliation.close({
      licenseKey: 'TEST-LICENSE',
      cashSessionId: 'cash-a',
      closingMode: 'admin_audited',
      countedAmount: '100',
      nextShiftFund: '0',
      reasonCode: 'abandoned_session',
      comments: 'Conteo revisado.',
      expectedVersion: 7,
      idempotencyKey: 'bridge-key-a'
    });

    expect(result).toMatchObject({
      success: false,
      code: null,
      internalCode: 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE',
      message: 'Esta caja no pertenece a las operaciones pendientes del plan anterior.'
    });
  });

  it('keeps an explicit empty list as a verified zero', async () => {
    fixtures.rpc.mockResolvedValue({
      data: { success: true, cash_sessions: [], pending_count: 0 },
      error: null
    });

    await expect(postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' }))
      .resolves.toMatchObject({ success: true, pendingCount: 0, cashSessions: [] });
  });

  it.each([
    { success: true, pending_count: 0 },
    { success: true, cash_sessions: [], pending_count: null },
    { success: true, cash_sessions: [], pending_count: 'not-a-count' },
    { success: true, cash_sessions: [], pending_count: 1 }
  ])('keeps a malformed or inconsistent list unknown: %j', async (data) => {
    fixtures.rpc.mockResolvedValue({ data, error: null });

    await expect(postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' }))
      .resolves.toMatchObject({
        success: false,
        code: null,
        internalCode: 'POST_DOWNGRADE_CASH_RESPONSE_INVALID',
        message: 'No se pudieron consultar las cajas pendientes del plan anterior.'
      });
  });

  it('maps missing or failed auth context to safe user-facing copy', async () => {
    fixtures.buildContext.mockRejectedValue(new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE raw details'));

    await expect(postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' }))
      .rejects.toMatchObject({
        bridgeCode: 'POST_DOWNGRADE_CASH_RECONCILIATION_FAILED',
        message: 'No se pudieron consultar las cajas pendientes del plan anterior.'
      });
  });

  it('does not expose unknown backend messages in the user-facing failure', async () => {
    fixtures.rpc.mockResolvedValue({
      data: {
        success: false,
        code: 'INTERNAL_SQL_FAILURE',
        message: 'permission denied in private.execute_admin_cash_close_v2 at line 81'
      },
      error: null
    });

    await expect(postDowngradeCashReconciliation.list({ licenseKey: 'TEST-LICENSE' }))
      .resolves.toMatchObject({
        success: false,
        code: null,
        internalCode: 'INTERNAL_SQL_FAILURE',
        message: 'No se pudieron consultar las cajas pendientes del plan anterior.'
      });
  });

});
