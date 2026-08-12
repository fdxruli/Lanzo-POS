import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTenant: vi.fn(),
  getDeviceId: vi.fn(),
  getSecurityToken: vi.fn(),
  getActorToken: vi.fn(),
  rpc: vi.fn()
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: mocks.rpc },
  getStableDeviceId: mocks.getDeviceId,
  getDeviceSecurityToken: mocks.getSecurityToken,
  getActorSessionToken: mocks.getActorToken
}));

vi.mock('../../tenant/localTenantGuard', () => ({
  assertLocalTenantSyncAccess: mocks.assertTenant
}));

import { posSyncClient } from '../posSyncClient';

describe('posSyncClient tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTenant.mockResolvedValue({ status: 'pass' });
    mocks.getDeviceId.mockResolvedValue('synthetic-device');
    mocks.getSecurityToken.mockResolvedValue('synthetic-security-token');
    mocks.getActorToken.mockResolvedValue('synthetic-actor-token');
    mocks.rpc.mockResolvedValue({
      data: { success: true, events: [], latest_change_seq: 0 },
      error: null
    });
  });

  it('rejects before reading credentials or issuing an RPC on mismatch', async () => {
    mocks.assertTenant.mockRejectedValue(Object.assign(new Error('blocked'), {
      code: 'LOCAL_TENANT_SYNC_BLOCKED'
    }));

    await expect(posSyncClient.pullSyncEvents({
      licenseKey: 'TENANT-B'
    })).rejects.toMatchObject({ code: 'LOCAL_TENANT_SYNC_BLOCKED' });

    expect(mocks.getDeviceId).not.toHaveBeenCalled();
    expect(mocks.getSecurityToken).not.toHaveBeenCalled();
    expect(mocks.getActorToken).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the existing RPC flow for a validated same-tenant context', async () => {
    await expect(posSyncClient.pullSyncEvents({
      licenseKey: 'TENANT-A',
      sinceChangeSeq: 7
    })).resolves.toMatchObject({ success: true, latestChangeSeq: 0 });

    expect(mocks.assertTenant).toHaveBeenCalledWith(
      { license_key: 'TENANT-A' },
      { reason: 'pos_sync_auth_context' }
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('pos_pull_sync_events', expect.objectContaining({
      p_license_key: 'TENANT-A',
      p_since_change_seq: 7
    }));
  });
});
