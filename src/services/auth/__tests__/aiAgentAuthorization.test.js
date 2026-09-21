import { describe, expect, it } from 'vitest';
import {
  canCurrentActorUseAIAgents,
  getCommercialAIAgentAccessState,
  hasCurrentActorAIAgentPermission,
  hasAIAgentsEntitlement
} from '../aiAgentAuthorization';

const entitledLicense = { valid: true, features: { ai_agents: true } };
const staff = (permissions) => ({ status: 'granted', actorType: 'staff', permissions });
const admin = { status: 'granted', actorType: 'admin', permissions: ['*'] };
const boundAdmin = {
  ...admin,
  actorId: 'admin-a',
  actorKey: 'admin:admin-a',
  sessionId: 'session-a',
  deviceRef: 'device-a',
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 }
};
const boundStaff = {
  status: 'granted',
  actorType: 'staff',
  actorId: 'staff-a',
  actorKey: 'staff:staff-a',
  sessionId: 'session-staff-a',
  deviceRef: 'device-a',
  permissions: ['ai_agents'],
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 }
};

describe('AI Agent actor authority', () => {
  it('keeps plan entitlement independent from Staff permission', () => {
    expect(hasAIAgentsEntitlement(entitledLicense)).toBe(true);
    expect(hasCurrentActorAIAgentPermission(staff([]))).toBe(false);
    expect(canCurrentActorUseAIAgents({ licenseDetails: entitledLicense, actorSnapshot: staff([]) })).toBe(false);
    expect(canCurrentActorUseAIAgents({ licenseDetails: entitledLicense, actorSnapshot: staff(['ai_agents']) })).toBe(true);
  });

  it('treats missing, null, and non-boolean Staff authority as denied', () => {
    expect(hasCurrentActorAIAgentPermission(staff([]))).toBe(false);
    expect(hasCurrentActorAIAgentPermission({ status: 'granted', actorType: 'staff', permissions: ['ai_agents'] })).toBe(true);
    expect(hasCurrentActorAIAgentPermission({ status: 'granted', actorType: 'staff', permissions: [null] })).toBe(false);
    expect(hasCurrentActorAIAgentPermission({ status: 'locked', actorType: 'staff', permissions: ['ai_agents'] })).toBe(false);
  });

  it('keeps Admin authority separate from Staff permission JSON', () => {
    expect(canCurrentActorUseAIAgents({ licenseDetails: entitledLicense, actorSnapshot: admin })).toBe(true);
    expect(canCurrentActorUseAIAgents({ licenseDetails: { valid: true, features: { ai_agents: false } }, actorSnapshot: admin })).toBe(false);
  });

  it('does not infer AI authority from unrelated Staff permissions', () => {
    expect(hasCurrentActorAIAgentPermission(staff(['settings', 'products', 'reports', 'pos']))).toBe(false);
  });

  it('protects the center for Admin Pro/Nube while keeping Free/Local informational only', () => {
    expect(getCommercialAIAgentAccessState({
      licenseDetails: { valid: true, plan_code: 'nube', features: { ai_agents: true } },
      actorSnapshot: boundAdmin
    })).toMatchObject({ canSeeEntry: true, canEnter: true });

    expect(getCommercialAIAgentAccessState({
      licenseDetails: { valid: true, plan_code: 'free', features: { ai_agents: false } },
      actorSnapshot: boundAdmin
    })).toMatchObject({ canSeeEntry: true, canEnter: false, reason: 'AI_AGENTS_NOT_AVAILABLE' });
  });

  it('requires the existing Staff permission and a bound actor/tenant/device context', () => {
    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: boundStaff
    })).toMatchObject({ canSeeEntry: true, canEnter: true });

    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: { ...boundStaff, permissions: [] }
    }).canSeeEntry).toBe(false);

    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: { ...boundStaff, tenant: null }
    }).canEnter).toBe(false);

    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: { ...boundStaff, actorKey: '' }
    }).canEnter).toBe(false);

    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: { ...boundStaff, deviceRef: null }
    }).canSeeEntry).toBe(false);
  });

  it('denies invalid licenses and direct-route-like snapshots', () => {
    expect(getCommercialAIAgentAccessState({
      licenseDetails: { valid: false, features: { ai_agents: true } },
      actorSnapshot: boundAdmin
    }).canEnter).toBe(false);
    expect(getCommercialAIAgentAccessState({
      licenseDetails: entitledLicense,
      actorSnapshot: { status: 'locked', actorType: 'admin' }
    })).toMatchObject({ canSeeEntry: false, canEnter: false });
  });
});
