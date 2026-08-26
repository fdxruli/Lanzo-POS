import { describe, expect, it } from 'vitest';
import {
  canCurrentActorUseAIAgents,
  hasCurrentActorAIAgentPermission,
  hasAIAgentsEntitlement
} from '../aiAgentAuthorization';

const entitledLicense = { valid: true, features: { ai_agents: true } };
const staff = (permissions) => ({ status: 'granted', actorType: 'staff', permissions });
const admin = { status: 'granted', actorType: 'admin', permissions: ['*'] };

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
});