// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn()
}));
vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../cloudNotificationService', () => ({
  buildRpcAuthArgs: mocks.auth
}));

import { fetchCloudSyncConflictDiagnostics } from '../cloudSyncConflictDiagnostics';

const authArgs = {
  p_license_key: 'my-license',
  p_device_fingerprint: 'my-device',
  p_security_token: 'device-secret',
  p_staff_session_token: 'admin-session'
};
const summary = {
  success: true,
  pending_count: 5,
  entities: [{ type: 'product', count: 3 }, { type: 'customer', count: 2 }],
  conflict_types: [{ type: 'VERSION_CONFLICT', count: 5 }],
  last_incident_at: '2026-11-12T13:00:00Z',
  checked_at: '2026-11-12T14:00:00Z',
  local_payload: { password: 'never-return-this' }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(authArgs);
});

describe('Cloud sync conflict diagnosis read-only client', () => {
  it('uses verified actor credentials and returns current safe aggregate only', async () => {
    mocks.rpc.mockResolvedValue({ data: summary, error: null });
    const data = await fetchCloudSyncConflictDiagnostics({ license_key: 'my-license' });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('pos_get_sync_conflict_diagnostics_v1', authArgs);
    expect(data).toEqual({
      available: true,
      summary: {
        pendingCount: 5, entities: summary.entities,
        conflictTypes: summary.conflict_types,
        checkedAt: summary.checked_at, lastIncidentAt: summary.last_incident_at
      }
    });
    expect(JSON.stringify(data)).not.toContain('never-return-this');
  });

  it('keeps stage 1 safe if RPC is not installed yet', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect(await fetchCloudSyncConflictDiagnostics({ license_key: 'my-license' }))
      .toEqual({ available: false, summary: null });
  });

  it('reports zero pending without treating it as full synchronization', async () => {
    mocks.rpc.mockResolvedValue({ data: {
      success: true, pending_count: 0, entities: [], conflict_types: []
    }, error: null });
    expect((await fetchCloudSyncConflictDiagnostics({})).summary).toMatchObject({
      pendingCount: 0, entities: []
    });
  });

  it('does not conceal access denial or network failure', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(fetchCloudSyncConflictDiagnostics({})).rejects.toMatchObject({ code: '42501' });
    mocks.rpc.mockRejectedValueOnce(new Error('network offline'));
    await expect(fetchCloudSyncConflictDiagnostics({})).rejects.toThrow('network offline');
  });

  it('rejects malformed responses instead of inventing counts', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: true, pending_count: null, entities: [] }, error: null });
    await expect(fetchCloudSyncConflictDiagnostics({})).rejects.toThrow('INVALID_SYNC_DIAGNOSTIC_RESPONSE');
  });
});
