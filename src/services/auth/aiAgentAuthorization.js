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

const hasBoundActorContext = (actorSnapshot) => (
  actorSnapshot?.status === ACTOR_RUNTIME_STATUS.GRANTED
  && typeof actorSnapshot.actorKey === 'string'
  && actorSnapshot.actorKey.trim().length > 0
  && typeof actorSnapshot.actorId === 'string'
  && actorSnapshot.actorId.trim().length > 0
  && typeof actorSnapshot.sessionId === 'string'
  && actorSnapshot.sessionId.trim().length > 0
  && typeof actorSnapshot.deviceRef === 'string'
  && actorSnapshot.deviceRef.trim().length > 0
  && typeof actorSnapshot.tenant?.opaqueId === 'string'
  && actorSnapshot.tenant.opaqueId.trim().length > 0
  && typeof actorSnapshot.tenant?.databaseName === 'string'
  && actorSnapshot.tenant.databaseName.trim().length > 0
  && Number.isFinite(actorSnapshot.tenant?.generation)
);

/**
 * UI access state for the commercial AI center.
 *
 * This is deliberately separate from the existing execution assertion: the
 * center may be shown to an authenticated Admin on an incompatible plan so
 * the user receives a clear availability message, but only a fully-bound
 * actor with the existing entitlement can enter the center itself.
 */
export const getCommercialAIAgentAccessState = ({ licenseDetails, actorSnapshot } = {}) => {
  const actorPermission = hasCurrentActorAIAgentPermission(actorSnapshot);
  const contextBound = hasBoundActorContext(actorSnapshot);
  const entitlement = hasAIAgentsEntitlement(licenseDetails);

  if (!actorPermission || !contextBound) {
    return Object.freeze({
      canSeeEntry: false,
      canEnter: false,
      reason: 'ACTOR_CONTEXT_REQUIRED',
      message: 'No tienes permiso para acceder a los agentes IA comerciales.'
    });
  }

  if (!entitlement) {
    return Object.freeze({
      canSeeEntry: true,
      canEnter: false,
      reason: 'AI_AGENTS_NOT_AVAILABLE',
      message: 'Los agentes IA comerciales requieren un plan compatible.'
    });
  }

  return Object.freeze({
    canSeeEntry: true,
    canEnter: true,
    reason: null,
    message: null
  });
};

export const assertCurrentAIAgentActor = () => (
  actorRuntimeController.assertGranted(AI_AGENT_PERMISSION)
);
