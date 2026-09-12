import {
  ACTOR_RUNTIME_ERROR_CODES,
  ActorRuntimeError,
  actorRuntimeController
} from './actorRuntimeController';
import {
  getLicenseKeyFromDetails,
  getPlanFeaturesFromLicenseDetails,
  SYNC_ENTITY_TYPES,
  SYNC_OPERATIONS
} from '../sync/syncConstants';
import { getTenantRuntimeReadiness } from '../db/tenantRuntimeRouter';
import { useAppStore } from '../../store/useAppStore';

export const PRODUCT_PERMISSION = 'products';
export const INVENTORY_PERMISSION = 'inventory';

export const PRODUCT_INVENTORY_AUTHORITY_MODES = Object.freeze({
  LEGACY_LOCAL_OWNER: 'legacy_local_owner',
  ACTOR_BOUND: 'actor_bound',
  DENIED: 'denied'
});

const uniqueRequirements = (requirements = []) => [...new Set(requirements)];
const normalizeText = (value) => String(value ?? '').trim().toLowerCase();
const parseTime = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const hasInitialBatches = (payload = {}) => (
  Array.isArray(payload?.initialBatches) && payload.initialBatches.length > 0
);

export const hasInitialProductStock = (product = {}) => (
  [product?.stock, product?.committedStock, product?.committed_stock]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0)
);

export const getProductInventoryMutationRequirements = ({
  entityType,
  operation,
  payload = {}
} = {}) => {
  if (entityType === SYNC_ENTITY_TYPES.CATEGORY) return [PRODUCT_PERMISSION];
  if (entityType === SYNC_ENTITY_TYPES.PRODUCT_BATCH) return [INVENTORY_PERMISSION];
  if (entityType === SYNC_ENTITY_TYPES.INVENTORY_ENTRY) return [INVENTORY_PERMISSION];

  if (entityType === SYNC_ENTITY_TYPES.PRODUCT) {
    if (operation === SYNC_OPERATIONS.DELETE) {
      return [PRODUCT_PERMISSION, INVENTORY_PERMISSION];
    }
    const isNewProduct = payload?.isNewProduct === true
      || operation === SYNC_OPERATIONS.CREATE
      || operation === 'created';
    return uniqueRequirements([
      PRODUCT_PERMISSION,
      ...(hasInitialBatches(payload) || (isNewProduct && hasInitialProductStock(payload?.product))
        ? [INVENTORY_PERMISSION]
        : [])
    ]);
  }

  return [];
};

const getPlanCode = (licenseDetails = {}) => normalizeText(
  licenseDetails?.plan_code
  || licenseDetails?.plan?.code
  || licenseDetails?.plan
  || licenseDetails?.subscription_plan
  || licenseDetails?.product_code
  || licenseDetails?.details?.plan_code
);

const isExplicitFreePlanCode = (planCode) => Boolean(
  planCode
  && !planCode.includes('pro')
  && !planCode.includes('basic')
  && (planCode.includes('free') || planCode.includes('trial'))
);

const isExplicitlyDisabled = (features, key) => (
  features?.[key] === false || features?.[key] === 'false'
);

const legacyLocalOwnerDenied = (reason, details = {}) => ({
  allowed: false,
  reason,
  ...details
});

const resolveLegacyLocalOwnerContext = (state = useAppStore.getState()) => {
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const planCode = getPlanCode(licenseDetails);

  if (!isExplicitFreePlanCode(planCode)) {
    return legacyLocalOwnerDenied('plan_not_explicit_free', { planCode, explicitFree: false });
  }

  if (!licenseDetails || !licenseKey) {
    return legacyLocalOwnerDenied('license_identity_missing', { planCode, explicitFree: true });
  }
  if (licenseDetails.valid !== true) {
    return legacyLocalOwnerDenied('license_not_valid', { planCode, explicitFree: true });
  }
  if (normalizeText(state?.appStatus) !== 'ready') {
    return legacyLocalOwnerDenied('app_not_ready', { planCode, explicitFree: true });
  }

  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  if (
    !isExplicitlyDisabled(features, 'cloud_pos_sync')
    || !isExplicitlyDisabled(features, 'cloud_products_sync')
  ) {
    return legacyLocalOwnerDenied('free_cloud_features_not_explicitly_disabled', {
      planCode,
      explicitFree: true
    });
  }
  if (!isExplicitlyDisabled(features, 'staff_roles')) {
    return legacyLocalOwnerDenied('free_staff_roles_not_explicitly_disabled', {
      planCode,
      explicitFree: true
    });
  }

  const maxDevices = Number(
    licenseDetails?.max_devices
    ?? licenseDetails?.details?.max_devices
  );
  if (!Number.isFinite(maxDevices) || maxDevices !== 1) {
    return legacyLocalOwnerDenied('free_single_device_contract_not_proven', {
      planCode,
      explicitFree: true,
      maxDevices: Number.isFinite(maxDevices) ? maxDevices : null
    });
  }

  const deviceRole = normalizeText(
    state?.currentDeviceRole
    || licenseDetails?.device_role
    || licenseDetails?.details?.device_role
    || 'admin'
  );
  if (
    deviceRole !== 'admin'
    || state?.currentStaffUser
    || licenseDetails?.staff_user
    || licenseDetails?.details?.staff_user
  ) {
    return legacyLocalOwnerDenied('free_staff_or_non_admin_context', {
      planCode,
      explicitFree: true,
      deviceRole
    });
  }
  if (licenseDetails?.admin_identity_required === true) {
    return legacyLocalOwnerDenied('free_admin_identity_required', {
      planCode,
      explicitFree: true
    });
  }

  const expiresAt = parseTime(licenseDetails?.expires_at);
  const graceEnds = parseTime(
    licenseDetails?.grace_period_ends
    || licenseDetails?.gracePeriodEnds
    || state?.gracePeriodEnds
  );
  const now = Date.now();
  if (expiresAt && expiresAt <= now && (!graceEnds || graceEnds <= now)) {
    return legacyLocalOwnerDenied('free_license_expired', { planCode, explicitFree: true });
  }

  const readiness = getTenantRuntimeReadiness();
  const tenant = readiness?.ready ? readiness?.runtime : null;
  if (
    !tenant?.opaqueId
    || !tenant?.databaseName
    || !Number.isFinite(tenant?.generation)
  ) {
    return legacyLocalOwnerDenied('free_tenant_runtime_not_ready', {
      planCode,
      explicitFree: true
    });
  }

  return {
    allowed: true,
    explicitFree: true,
    planCode,
    licenseKey,
    tenant: Object.freeze({
      opaqueId: tenant.opaqueId,
      databaseName: tenant.databaseName,
      generation: tenant.generation
    }),
    deviceRole,
    cloudEligible: false
  };
};

export const resolveProductInventoryMutationAuthority = (state = useAppStore.getState()) => {
  const local = resolveLegacyLocalOwnerContext(state);
  if (local.allowed) {
    return Object.freeze({
      mode: PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER,
      ...local
    });
  }

  if (local.explicitFree && local.reason === 'free_admin_identity_required') {
    return Object.freeze({
      mode: PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND,
      reason: local.reason,
      planCode: local.planCode || null,
      cloudEligible: false
    });
  }

  if (local.explicitFree) {
    return Object.freeze({
      mode: PRODUCT_INVENTORY_AUTHORITY_MODES.DENIED,
      reason: local.reason,
      planCode: local.planCode || null,
      cloudEligible: false
    });
  }

  return Object.freeze({
    mode: PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND,
    reason: local.reason,
    planCode: local.planCode || null,
    cloudEligible: true
  });
};

const assertActorBoundModeStillCurrent = () => {
  const authority = resolveProductInventoryMutationAuthority();
  if (authority.mode !== PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_actor_bound_authority_no_longer_valid',
      currentAuthorityMode: authority.mode,
      currentAuthorityReason: authority.reason || null,
      planCode: authority.planCode || null
    });
  }
  return authority;
};

const assertSameLegacyLocalOwnerContext = (captured) => {
  const current = resolveLegacyLocalOwnerContext();
  if (!current.allowed) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'legacy_local_owner_context_no_longer_valid',
      currentReason: current.reason || null
    });
  }

  if (
    current.licenseKey !== captured.licenseKey
    || current.planCode !== captured.planCode
    || current.deviceRole !== captured.deviceRole
    || current.tenant.opaqueId !== captured.tenant.opaqueId
    || current.tenant.databaseName !== captured.tenant.databaseName
    || current.tenant.generation !== captured.tenant.generation
  ) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'legacy_local_owner_context_changed',
      capturedLicenseKey: captured.licenseKey,
      currentLicenseKey: current.licenseKey,
      capturedTenant: captured.tenant,
      currentTenant: current.tenant
    });
  }

  return current;
};

const captureLegacyLocalOwnerMutation = (authority) => {
  const captured = Object.freeze({
    licenseKey: authority.licenseKey,
    planCode: authority.planCode,
    tenant: authority.tenant,
    deviceRole: authority.deviceRole
  });

  return Object.freeze({
    mode: PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER,
    authorityMode: PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER,
    cloudEligible: false,
    licenseKey: captured.licenseKey,
    actorType: null,
    actorId: null,
    actorKey: null,
    generation: null,
    tenant: captured.tenant,
    assertCurrent() {
      return assertSameLegacyLocalOwnerContext(captured);
    }
  });
};

const captureActorBoundMutation = (requirements = {}, authority = {}) => {
  const handle = actorRuntimeController.capture();
  for (const permission of uniqueRequirements([
    ...(requirements.products ? [PRODUCT_PERMISSION] : []),
    ...(requirements.inventory ? [INVENTORY_PERMISSION] : [])
  ])) {
    handle.assertCurrent(permission);
  }
  return Object.freeze({
    ...handle,
    mode: PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND,
    authorityMode: PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND,
    cloudEligible: authority.cloudEligible !== false
  });
};

export const captureProductInventoryMutation = (requirements = {}) => {
  const authority = resolveProductInventoryMutationAuthority();
  if (authority.mode === PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER) {
    return captureLegacyLocalOwnerMutation(authority);
  }
  if (authority.mode === PRODUCT_INVENTORY_AUTHORITY_MODES.DENIED) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED, {
      reason: 'legacy_local_owner_gate_failed',
      gateReason: authority.reason || null,
      planCode: authority.planCode || null
    });
  }
  return captureActorBoundMutation(requirements, authority);
};

export const isLegacyLocalOwnerProductInventoryAuthority = (handle) => (
  handle?.authorityMode === PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER
  || handle?.mode === PRODUCT_INVENTORY_AUTHORITY_MODES.LEGACY_LOCAL_OWNER
);

const isActorBoundProductInventoryAuthority = (handle) => (
  handle?.authorityMode === PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND
  || handle?.mode === PRODUCT_INVENTORY_AUTHORITY_MODES.ACTOR_BOUND
);

export const assertProductInventoryMutationCurrent = (handle, requirements = {}) => {
  if (!handle || typeof handle.assertCurrent !== 'function') {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_actor_handle_missing'
    });
  }

  if (isActorBoundProductInventoryAuthority(handle)) {
    assertActorBoundModeStillCurrent();
  }
  handle.assertCurrent();
  for (const permission of uniqueRequirements([
    ...(requirements.products ? [PRODUCT_PERMISSION] : []),
    ...(requirements.inventory ? [INVENTORY_PERMISSION] : [])
  ])) {
    handle.assertCurrent(permission);
  }
  return true;
};

export const actorOriginFromHandle = (handle) => {
  if (!handle?.actorKey || isLegacyLocalOwnerProductInventoryAuthority(handle)) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_actor_origin_missing'
    });
  }
  return {
    actorType: handle.actorType,
    actorId: handle.actorId,
    actorKey: handle.actorKey,
    actorGeneration: handle.generation
  };
};

export const assertProductInventoryOperationActorCurrent = (operation = {}) => {
  const requirements = getProductInventoryMutationRequirements(operation);
  if (requirements.length === 0) return null;

  assertActorBoundModeStillCurrent();

  const originActorKey = operation.originActorKey;
  const originGeneration = Number(operation.originActorGeneration);
  if (
    operation.actorSensitivity !== 'actor_bound'
    || typeof originActorKey !== 'string'
    || originActorKey.length === 0
    || !Number.isFinite(originGeneration)
  ) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_outbox_actor_origin_unresolved',
      entityType: operation.entityType || null,
      entityId: operation.entityId || null
    });
  }

  const current = actorRuntimeController.assertGranted();
  if (current.actorKey !== originActorKey || current.generation !== originGeneration) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
      reason: 'product_inventory_outbox_actor_context_stale',
      originActorKey,
      originGeneration,
      currentActorKey: current.actorKey,
      currentGeneration: current.generation
    });
  }

  for (const permission of requirements) {
    actorRuntimeController.assertGranted(permission);
  }
  return current;
};
