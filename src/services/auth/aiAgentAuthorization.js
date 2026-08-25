import { actorRuntimeController, ACTOR_RUNTIME_STATUS } from './actorRuntimeController';

export const AI_AGENT_PERMISSION = 'ai_agents';

export const hasAIAgentsEntitlement = (licenseDetails) => {
  if (!licenseDetails?.valid) return false;

  const features = licenseDetails.features || {};
  const planCode = String(
    licenseDetails.plan_code ||
    licenseDetails.planCode ||
    licenseDetails.plan ||
    ''
  ).toLowerCase();

  return (
    features.ai_agents === true ||
    licenseDetails.ai_agents === true ||
    planCode.includes('pro')
  );
};

export const hasCurrentActorAIAgentPermission = (actorSnapshot) => (
  actorSnapshot?.status === ACTOR_RUNTIME_STATUS.GRANTED && (
    actorSnapshot.actorType === 'admin' ||
    (actorSnapshot.actorType === 'staff' && Array.isArray(actorSnapshot.permissions) && actorSnapshot.permissions.includes(AI_AGENT_PERMISSION))
  )
);

export const canCurrentActorUseAIAgents = ({ licenseDetails, actorSnapshot }) => (
  hasAIAgentsEntitlement(licenseDetails) && hasCurrentActorAIAgentPermission(actorSnapshot)
);

export const assertCurrentAIAgentActor = () => (
  actorRuntimeController.assertGranted(AI_AGENT_PERMISSION)
);