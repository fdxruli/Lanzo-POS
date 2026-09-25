import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  assertGranted: vi.fn()
}));

vi.mock('../../supabase', () => ({
  supabaseClient: {
    functions: {
      invoke: runtime.invoke
    }
  },
  getStableDeviceId: vi.fn(async () => 'synthetic-device'),
  getDeviceSecurityToken: vi.fn(async () => 'synthetic-device-token')
}));

vi.mock('../../auth/actorRuntimeController', () => ({
  actorRuntimeController: {
    assertGranted: runtime.assertGranted,
    getState: () => ({ actorType: 'admin' })
  }
}));

import { getAIAgentUsageStatus } from '../../aiService';

const auth = {
  licenseKey: 'synthetic-license',
  deviceFingerprint: 'synthetic-device',
  deviceSecurityToken: 'synthetic-device-token',
  staffSessionToken: 'synthetic-admin-session'
};

const functionError = (payload, status) => ({
  context: new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
});

describe('getAIAgentUsageStatus', () => {
  beforeEach(() => {
    runtime.invoke.mockReset();
    runtime.assertGranted.mockReset();
  });

  it('returns the successful read-only usage snapshot', async () => {
    runtime.invoke.mockResolvedValue({
      data: {
        success: true,
        limit: 15,
        used: 4,
        remaining: 11,
        period_end: '2026-10-01T00:00:00Z'
      },
      error: null
    });

    await expect(getAIAgentUsageStatus({ auth })).resolves.toMatchObject({
      limit: 15,
      used: 4,
      remaining: 11,
      isLimitReached: false
    });
    expect(runtime.assertGranted).toHaveBeenCalledWith('ai_agents');
    expect(runtime.invoke).toHaveBeenCalledWith('lanzo-ai-agent', {
      body: { action: 'usage', auth }
    });
  });

  it('surfaces AI_AGENT_LIMIT_REACHED as a counter state instead of a lookup failure', async () => {
    runtime.invoke.mockResolvedValue({
      data: null,
      error: functionError({
        success: false,
        code: 'AI_AGENT_LIMIT_REACHED',
        limit: 15,
        used: 15,
        remaining: 0,
        period_end: '2026-10-01T00:00:00Z'
      }, 429)
    });

    await expect(getAIAgentUsageStatus({ auth })).resolves.toMatchObject({
      limit: 15,
      used: 15,
      remaining: 0,
      isLimitReached: true
    });
  });

  it('surfaces AI_AGENT_LIMIT_DISABLED as zero available without inventing 0 / 0 usage', async () => {
    runtime.invoke.mockResolvedValue({
      data: null,
      error: functionError({
        success: false,
        code: 'AI_AGENT_LIMIT_DISABLED',
        limit: 0,
        used: 0,
        remaining: 0
      }, 403)
    });

    await expect(getAIAgentUsageStatus({ auth })).resolves.toMatchObject({
      limit: 0,
      used: 0,
      remaining: 0,
      isLimitConfigured: true,
      isLimitReached: false
    });
  });

  it('does not turn authorization failures into visible quota snapshots', async () => {
    runtime.invoke.mockResolvedValue({
      data: null,
      error: functionError({
        success: false,
        code: 'AI_AGENT_PERMISSION_REQUIRED',
        limit: 0,
        used: 0,
        remaining: 0
      }, 403)
    });

    await expect(getAIAgentUsageStatus({ auth })).rejects.toMatchObject({
      code: 'AI_AGENT_PERMISSION_REQUIRED',
      statusCode: 403
    });
  });
});
