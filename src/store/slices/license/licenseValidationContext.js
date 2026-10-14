import {
  actorRuntimeController,
  runWithActorHandle
} from '../../../services/auth/actorRuntimeController';

export const LICENSE_VALIDATION_CONTEXT_STALE = 'LICENSE_VALIDATION_CONTEXT_STALE';

const normalizeId = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const getActorBinding = (actor = {}) => ({
  status: actor.status || null,
  actorType: actor.actorType || null,
  actorId: actor.actorId || null,
  actorKey: actor.actorKey || null,
  sessionId: actor.sessionId || null,
  generation: Number.isFinite(actor.generation) ? actor.generation : null,
  tenantOpaqueId: actor.tenant?.opaqueId || null,
  tenantGeneration: Number.isFinite(actor.tenant?.generation) ? actor.tenant.generation : null,
  tenantDatabaseName: actor.tenant?.databaseName || null,
  deviceRef: actor.deviceRef || null
});

const getDeviceRole = (state = {}) => (
  state.currentDeviceRole || state.licenseDetails?.device_role || null
);

const getLicenseKey = (state = {}) => normalizeId(
  state.licenseDetails?.license_key ||
  state.adminLoginLicenseKey ||
  state.staffLoginLicenseKey
);

const sameBinding = (left, right) => (
  left.status === right.status &&
  left.actorType === right.actorType &&
  left.actorId === right.actorId &&
  left.actorKey === right.actorKey &&
  left.sessionId === right.sessionId &&
  left.generation === right.generation &&
  left.tenantOpaqueId === right.tenantOpaqueId &&
  left.tenantGeneration === right.tenantGeneration &&
  left.tenantDatabaseName === right.tenantDatabaseName &&
  left.deviceRef === right.deviceRef
);

const createStaleContextError = () => {
  const error = new Error(LICENSE_VALIDATION_CONTEXT_STALE);
  error.code = LICENSE_VALIDATION_CONTEXT_STALE;
  return error;
};

export const isLicenseValidationContextStaleError = (error) => (
  error?.code === LICENSE_VALIDATION_CONTEXT_STALE
);

export const captureLicenseValidationContext = (state, requestedLicenseKey = null) => {
  const actorSnapshot = actorRuntimeController.getState();
  let actorHandle = null;
  if (actorSnapshot?.status === 'granted') {
    try {
      actorHandle = actorRuntimeController.capture();
    } catch {
      throw createStaleContextError();
    }
  }

  return Object.freeze({
    licenseKey: normalizeId(requestedLicenseKey || getLicenseKey(state)),
    deviceRole: getDeviceRole(state),
    actorBinding: Object.freeze(getActorBinding(actorSnapshot)),
    actorHandle
  });
};

export const isLicenseValidationContextCurrent = (context, state) => {
  if (!context?.licenseKey) return false;
  if (getLicenseKey(state) !== context.licenseKey) return false;
  if (getDeviceRole(state) !== context.deviceRole) return false;

  return sameBinding(
    context.actorBinding,
    getActorBinding(actorRuntimeController.getState())
  );
};

export const assertLicenseValidationContextCurrent = (context, state) => {
  if (!isLicenseValidationContextCurrent(context, state)) {
    throw createStaleContextError();
  }

  if (context.actorHandle?.assertCurrent) {
    try {
      context.actorHandle.assertCurrent();
    } catch {
      throw createStaleContextError();
    }
  }
  return true;
};

export const persistWithinLicenseValidationContext = async (context, get, operation) => {
  const state = typeof get === 'function' ? get() : get;
  assertLicenseValidationContextCurrent(context, state);

  if (!context.actorHandle) return operation();

  try {
    return await runWithActorHandle(
      context.actorHandle,
      ({ guardedWrite }) => guardedWrite(operation)
    );
  } catch (error) {
    if (String(error?.code || '').startsWith('ACTOR_')) {
      throw createStaleContextError();
    }
    throw error;
  }
};
