import Logger from '../Logger';
import { ACTOR_RUNTIME_STATUS, actorRuntimeController, isActorRuntimeError } from '../auth/actorRuntimeController';
import { ownsScopedPosRealtimeListener } from './scopedPosRealtimeListener';
import {
  buildPosRealtimeTopic,
  startPosRealtimeListener,
  stopPosRealtimeListener
} from '../posRealtime';
import { posSyncClient } from './posSyncClient';
import { syncMetaService } from './syncMetaService';
import { getCloudSyncProtocolFamilyForEntity, syncOutboxService } from './syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudPosSyncEnabled,
  POS_SYNC_FOCUS_PULL_COOLDOWN_MS,
  POS_SYNC_REALTIME_PULL_DEBOUNCE_MS,
  POS_SYNC_DEFERRED_PULL_RETRY,
  shouldDeferPosBootstrapStartHook,
  SYNC_LIMITS,
  SYNC_STATUS
} from './syncConstants';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError,
  runWithLocalTenantSyncLease
} from '../tenant/localTenantGuard';
import { classifyActorAuthorityError } from '../auth/actorAuthorityErrors';
import { hasActorAnyPermission } from './actorPermission';
import { LOCAL_TENANT_STATUS, localTenantAccessController } from '../tenant/localTenantPolicy';
import { isCloudClientUpdateRequired } from './cloudSyncProtocolV2';

const entityHandlers = new Map();
const activityListeners = new Set();
// Opt-in singleton ownership. Default callers never install this binding.
let executionScope = null;
let legacyWorkStarted = false;
let scopedStop = null;
const canSchedule = (owner = executionScope) => !owner || (
  owner === executionScope && owner.isContextCurrent() && owner.getSnapshot().accepting
);
const observeJob = (label, factory) => executionScope
  ? executionScope.run(`pos:${label}`, factory) : (legacyWorkStarted = true, factory());
const unknownHandler = label => executionScope?.markUnobservable(`pos_handler_lifetime:${label}`);


const runtime = {
  started: false,
  startInProgress: false,
  startAttempt: 0,
  generation: 0,
  licenseKey: null,
  status: SYNC_STATUS.DISABLED,
  pullInProgress: false,
  pendingPull: false,
  outboxInProgress: false,
  realtimePullScheduled: false,
  realtimePullTimer: null,
  deferredPullTimer: null,
  deferredPullPending: false,
  deferredHandlerReads: new Set(),
  deferredHandlerBlocked: new Set(),
  permissionRefreshEntityTypes: new Set(),
  deferredPullRetryAttempt: 0,
  deferredPullRetryAfterMs: 0,
  lastPullReason: null,
  lastPullStartedAt: 0,
  lastPullFinishedAt: 0,
  lastForegroundPullAt: 0,
  realtimeChannel: null,
  realtimeStatus: SYNC_STATUS.DISABLED,
  realtimeTopic: null,
  onlineListener: null,
  visibilityListener: null,
  offlineListener: null
};

const setActivityFlag = (name, value) => {
  if (runtime[name] === value) return;
  runtime[name] = value;
  activityListeners.forEach((listener) => {
    try { listener(); } catch { /* Activity observers must not interfere with sync work. */ }
  });
};

const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const hasDeferredHandlerReadWork = () => runtime.deferredHandlerReads.size > 0;
const hasDeferredReadWork = () => runtime.deferredPullPending || hasDeferredHandlerReadWork();
const hasSchedulableDeferredReadWork = () => runtime.deferredPullPending
  || [...runtime.deferredHandlerReads].some((entityType) => !runtime.deferredHandlerBlocked.has(entityType)
    && entityHandlers.get(entityType)?.onEvents)
  || [...runtime.permissionRefreshEntityTypes].some((entityType) => entityHandlers.get(entityType)?.onEvents);

const isRuntimeGenerationCurrent = (generation, licenseKey = runtime.licenseKey) => (
  runtime.generation === generation && runtime.licenseKey === licenseKey
  && (!executionScope || executionScope.isContextCurrent())
);

let outboxTimer = null;
let unsubscribeOutboxChanges = null;
let unsubscribeOutboxContext = null;
let outboxWakeRequested = false;
let actorRevision = 0;

const clearOutboxTimer = () => {
  outboxTimer?.cancel();
  outboxTimer = null;
};

const scheduleOutbox = (retryAt = Date.now()) => {
  if (!runtime.started || !isBrowserOnline() || !canSchedule()
    || actorRuntimeController.getState().status !== ACTOR_RUNTIME_STATUS.GRANTED) return;
  if (runtime.outboxInProgress) {
    outboxWakeRequested = true;
    return;
  }
  if (outboxTimer && outboxTimer.retryAt <= retryAt) return;
  clearOutboxTimer();

  const owner = executionScope;
  const { generation, licenseKey } = runtime;
  const wake = () => {
    outboxTimer = null;
    if (!canSchedule(owner) || !isRuntimeGenerationCurrent(generation, licenseKey)) return;
    return posSyncOrchestrator.processOutbox('scheduled').catch((error) => {
      if (!isLocalTenantAccessError(error)) Logger.warn('[PosSync] Outbox programado falló:', error);
    });
  };
  const delay = Math.min(2_147_483_647, Math.max(0, retryAt - Date.now()));
  if (owner) {
    const timer = owner.schedule('pos:outbox', wake, delay);
    outboxTimer = { retryAt, cancel: () => timer.cancel() };
  } else {
    const timer = setTimeout(wake, delay);
    outboxTimer = { retryAt, cancel: () => clearTimeout(timer) };
  }
};

const stopOutboxSources = () => {
  clearOutboxTimer();
  clearDeferredPullTimer();
  outboxWakeRequested = false;
  unsubscribeOutboxChanges?.();
  unsubscribeOutboxChanges = null;
  unsubscribeOutboxContext?.();
  unsubscribeOutboxContext = null;
  if (runtime.offlineListener && typeof window !== 'undefined') {
    window.removeEventListener('offline', runtime.offlineListener);
  }
  runtime.offlineListener = null;
};

const outboxActorSignature = (actor) => JSON.stringify([
  actor.status, actor.generation, actor.sessionId, actor.actorKey, [...actor.permissions].sort()
]);

const startOutboxSources = () => {
  let signature = outboxActorSignature(actorRuntimeController.getState());
  let previousActor = actorRuntimeController.getState();
  const actorChanged = actorRuntimeController.subscribe((actor) => {
    const nextSignature = outboxActorSignature(actor);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const priorActor = previousActor;
    previousActor = actor;
    const newlyGrantedHandlers = new Set();
    if (actor.status === ACTOR_RUNTIME_STATUS.GRANTED) {
      for (const [entityType, handler] of entityHandlers.entries()) {
        const permissions = handler?.actorPermissions ?? handler?.actorPermission;
        if (!permissions || hasActorAnyPermission(priorActor, permissions)
          || !hasActorAnyPermission(actor, permissions)) continue;
        newlyGrantedHandlers.add(handler);
        runtime.permissionRefreshEntityTypes.add(entityType);
      }
    }
    actorRevision += 1;
    clearOutboxTimer();
    scheduleOutbox();
    clearDeferredPullTimer();
    if (actor.status === ACTOR_RUNTIME_STATUS.GRANTED && runtime.started
      && (hasDeferredReadWork() || newlyGrantedHandlers.size > 0)) {
      runtime.deferredHandlerBlocked.clear();
      posSyncOrchestrator.schedulePullIncremental('actor_context_changed').catch((error) => {
        Logger.warn('[PosSync] Pull tras cambio de actor fallo:', error, { diagnosticOperation: 'sync.pull' });
      });
    }
  });
  const tenantChanged = localTenantAccessController.subscribe((state) => {
    actorRevision += 1;
    clearOutboxTimer();
    unsubscribeOutboxChanges?.();
    unsubscribeOutboxChanges = null;
    clearDeferredPullTimer();
    if (state.status === LOCAL_TENANT_STATUS.GRANTED) {
      scheduleOutbox();
      if (hasDeferredReadWork() && runtime.started) {
        runtime.deferredHandlerBlocked.clear();
        posSyncOrchestrator.schedulePullIncremental('tenant_context_changed').catch((error) => {
          Logger.warn('[PosSync] Pull tras cambio de tenant fallo:', error, { diagnosticOperation: 'sync.pull' });
        });
      }
    }
  });
  unsubscribeOutboxContext = () => {
    actorChanged();
    tenantChanged();
  };
  if (typeof window !== 'undefined') {
    runtime.offlineListener = () => {
      clearOutboxTimer();
      clearDeferredPullTimer();
    };
    window.addEventListener('offline', runtime.offlineListener);
  }
};

const applyRuntimeStatus = async (
  status,
  { licenseKey = runtime.licenseKey, reason = null, generation = null } = {}
) => {
  if (generation !== null && generation !== undefined && !isRuntimeGenerationCurrent(generation, licenseKey)) return false;
  if (licenseKey) {
    await assertLocalTenantSyncAccess(
      { license_key: licenseKey },
      { reason: `pos_sync_status_${status}` }
    );
  }

  if (generation !== null && generation !== undefined && !isRuntimeGenerationCurrent(generation, licenseKey)) return false;

  runtime.status = status;

  // An unauthenticated stop has no tenant namespace in which metadata can be
  // written. Keeping this state in memory avoids creating ambiguous legacy rows.
  if (!licenseKey) {
    if (reason) Logger.log({ diagnosticOperation: 'sync.status', diagnosticState: status });
    return;
  }

  await syncMetaService.setRealtimeStatus(status, licenseKey);
  if (generation !== null && generation !== undefined && !isRuntimeGenerationCurrent(generation, licenseKey)) return false;

  if (status === SYNC_STATUS.DISABLED) {
    await syncMetaService.setSyncEnabled(false, licenseKey);
  } else {
    await syncMetaService.setSyncEnabled(true, licenseKey);
  }

  if (generation !== null && generation !== undefined && !isRuntimeGenerationCurrent(generation, licenseKey)) return false;

  if (reason) {
    Logger.log({ diagnosticOperation: 'sync.status', diagnosticState: status });
  }
  return true;
};

let runtimeStatusQueue = Promise.resolve();
const setRuntimeStatus = (status, options = {}) => {
  const update = () => applyRuntimeStatus(status, options);
  const pending = runtimeStatusQueue.then(update, update);
  runtimeStatusQueue = pending.catch(() => undefined);
  return pending;
};

const clearRealtimePullTimer = () => {
  if (!runtime.realtimePullTimer) return;

  if (runtime.realtimePullTimer?.cancel) {
    runtime.realtimePullTimer.cancel();
  } else if (typeof window !== 'undefined') {
    window.clearTimeout(runtime.realtimePullTimer);
  } else {
    clearTimeout(runtime.realtimePullTimer);
  }

  runtime.realtimePullTimer = null;
  runtime.realtimePullScheduled = false;
};

const clearDeferredPullTimer = () => {
  const timer = runtime.deferredPullTimer;
  if (!timer) return;
  if (timer?.cancel) timer.cancel();
  else if (typeof window !== 'undefined') window.clearTimeout(timer);
  else clearTimeout(timer);
  runtime.deferredPullTimer = null;
};

const setDeferredReadPending = async (
  pending,
  { licenseKey = runtime.licenseKey, generation = runtime.generation, capturedActorRevision = actorRevision } = {}
) => {
  if (!isRuntimeGenerationCurrent(generation, licenseKey) || capturedActorRevision !== actorRevision) return false;

  const nextPending = Boolean(pending);
  const changed = runtime.deferredPullPending !== nextPending;
  if (changed) {
    const persisted = await syncMetaService.setDeferredReadPending(nextPending, licenseKey);
    if (persisted === false || !isRuntimeGenerationCurrent(generation, licenseKey)
      || capturedActorRevision !== actorRevision) return false;
  }
  runtime.deferredPullPending = nextPending;
  if (!hasSchedulableDeferredReadWork()) {
    clearDeferredPullTimer();
    if (!hasDeferredReadWork()) {
      runtime.deferredPullRetryAttempt = 0;
      runtime.deferredPullRetryAfterMs = 0;
    }
  }
  return true;
};

const persistDeferredHandlerRead = async (
  entityType,
  { state = 'deferred', handler = entityHandlers.get(entityType), licenseKey = runtime.licenseKey,
    generation = runtime.generation, capturedActorRevision = actorRevision } = {}
) => {
  if (!entityType || !isRuntimeGenerationCurrent(generation, licenseKey)
    || capturedActorRevision !== actorRevision) return false;

  const next = new Set(runtime.deferredHandlerReads);
  const handlerEntityTypes = handler
    ? [...entityHandlers.entries()].filter(([, candidate]) => candidate === handler).map(([type]) => type)
    : [entityType];
  if (state === 'complete') {
    next.delete(entityType);
    handlerEntityTypes.forEach((type) => next.delete(type));
  } else {
    next.add(entityType);
  }

  const persisted = await syncMetaService.setDeferredHandlerReads([...next], licenseKey);
  if (persisted === false || !isRuntimeGenerationCurrent(generation, licenseKey)
    || capturedActorRevision !== actorRevision) return false;

  runtime.deferredHandlerReads = next;
  handlerEntityTypes.forEach((type) => {
    if (state === 'permission' || state === 'offline' || state === 'blocked') {
      runtime.deferredHandlerBlocked.add(type);
    } else {
      runtime.deferredHandlerBlocked.delete(type);
    }
  });
  if (state === 'complete') {
    runtime.permissionRefreshEntityTypes.delete(entityType);
    handlerEntityTypes.forEach((type) => runtime.permissionRefreshEntityTypes.delete(type));
  }

  if (!hasSchedulableDeferredReadWork()) clearDeferredPullTimer();
  if (!hasDeferredReadWork()) {
    runtime.deferredPullRetryAttempt = 0;
    runtime.deferredPullRetryAfterMs = 0;
  }
  return true;
};

const scheduleDeferredPullRecovery = (reason = 'deferred_retry') => {
  if (!hasSchedulableDeferredReadWork() || runtime.deferredPullTimer || !runtime.started
    || !runtime.licenseKey || !isBrowserOnline() || !canSchedule()) return false;

  let actorHandle;
  try {
    actorHandle = actorRuntimeController.capture();
  } catch {
    return false;
  }

  const owner = executionScope;
  const { generation, licenseKey } = runtime;
  const capturedActorRevision = actorRevision;
  const retryIndex = Math.min(runtime.deferredPullRetryAttempt, 10);
  const exponentialDelayMs = Math.min(
    POS_SYNC_DEFERRED_PULL_RETRY.MAX_DELAY_MS,
    POS_SYNC_DEFERRED_PULL_RETRY.BASE_DELAY_MS * (2 ** retryIndex)
  );
  const delayMs = Math.max(exponentialDelayMs, Number(runtime.deferredPullRetryAfterMs) || 0);
  runtime.deferredPullRetryAfterMs = 0;
  runtime.deferredPullRetryAttempt = Math.min(runtime.deferredPullRetryAttempt + 1, Number.MAX_SAFE_INTEGER);

  const wake = () => {
    runtime.deferredPullTimer = null;
    if (!hasSchedulableDeferredReadWork() || !runtime.started || !isBrowserOnline()
      || !canSchedule(owner) || !isRuntimeGenerationCurrent(generation, licenseKey)
      || actorRevision !== capturedActorRevision) return null;
    try {
      actorHandle.assertCurrent();
    } catch {
      return null;
    }
    return posSyncOrchestrator.pullIncremental(reason);
  };

  try {
    runtime.deferredPullTimer = owner
      ? owner.schedule('pos:deferred_pull', wake, delayMs)
      : setTimeout(wake, delayMs);
    Logger.log('[POS Sync] Lectura aplazada; siguiente intento programado.', { delayMs });
    return true;
  } catch (error) {
    runtime.deferredPullTimer = null;
    if (!isLocalTenantAccessError(error)) {
      Logger.warn('[PosSync] No se pudo programar recuperación de lectura:', error);
    }
    return false;
  }
};

const isRecoverablePullFailure = (error) => {
  if (!error || isLocalTenantAccessError(error) || isActorRuntimeError(error)
    || classifyActorAuthorityError(error)) return false;
  const code = String(error.code || error.response?.code || '').toUpperCase();
  if (['401', '403', '42501', 'PGRST301', 'PGRST302'].includes(code)) return false;
  if (error.retryable === true || error.response?.retryable === true
    || error.catalogSyncContext?.retryable === true) return true;
  if (error.retryable === false || error.response?.retryable === false
    || error.catalogSyncContext?.retryable === false) return false;

  const status = Number(error.status ?? error.response?.status);
  if (status === 401 || status === 403) return false;
  if (status === 408 || status === 429 || status >= 500) return true;
  return !error.code;
};

const stopRealtimeChannel = async () => {
  const channelToStop = runtime.realtimeChannel;
  runtime.realtimeChannel = null;
  runtime.realtimeStatus = SYNC_STATUS.DISABLED;
  runtime.realtimeTopic = null;
  if (!channelToStop) {
    return;
  }
  await stopPosRealtimeListener(channelToStop);
};

const runEntityStartHooks = async ({ licenseDetails, licenseKey, reason }) => {
  for (const [entityType, handler] of entityHandlers.entries()) {
    if (!handler?.onStart) continue;

    try {
      if (executionScope && !canSchedule()) return;
      unknownHandler(`start:${entityType}`);
      const result = await runWithLocalTenantSyncLease(
        { license_key: licenseKey },
        { reason: `pos_sync_start_handler_${entityType}` },
        () => {
          if (executionScope && !canSchedule()) return { skipped: true, reason: 'scope_closed' };
          return handler.onStart({ licenseDetails, licenseKey, reason });
        }
      );
      if (result?.success === false && result.error && isRecoverablePullFailure(result.error)) {
        const retryAfterSeconds = Number(result.error.retryAfterSeconds
          ?? result.error.response?.retry_after_seconds
          ?? result.error.response?.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          runtime.deferredPullRetryAfterMs = Math.max(
            runtime.deferredPullRetryAfterMs,
            Math.min(retryAfterSeconds * 1000, 15 * 60 * 1000)
          );
        }
        if (await persistDeferredHandlerRead(entityType, {
          state: 'deferred', handler, licenseKey, generation: runtime.generation, capturedActorRevision: actorRevision
        })) scheduleDeferredPullRecovery('snapshot_start_deferred');
      } else if (result?.recoveryPending === true || result?.deltaRequired === true) {
        if (await persistDeferredHandlerRead(entityType, {
          state: 'deferred', handler, licenseKey, generation: runtime.generation, capturedActorRevision: actorRevision
        })) scheduleDeferredPullRecovery(result.recoveryPending ? 'snapshot_delta_pending' : 'module_delta_required');
      }
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn(`[PosSync] Handler ${entityType} fallo en onStart:`, error);
    }
  }
};

const isModulePermissionFailure = (error) => {
  const code = String(error?.code || error?.response?.code || '').toUpperCase();
  return code === 'ACTOR_PERMISSION_DENIED'
    || code === 'POS_PERMISSION_DENIED'
    || code.startsWith('POS_PERMISSION_DENIED:')
    || code === 'NO_PERMISSION'
    || ['CUSTOMER_PERMISSION_REQUIRED', 'CASH_PERMISSION_REQUIRED', 'PRODUCT_PERMISSION_REQUIRED', 'PRODUCTS_PERMISSION_REQUIRED'].includes(code);
};

const clearPermissionRefreshForHandler = (entityType, handler) => {
  runtime.permissionRefreshEntityTypes.delete(entityType);
  for (const pendingType of runtime.permissionRefreshEntityTypes) {
    if (entityHandlers.get(pendingType) === handler) runtime.permissionRefreshEntityTypes.delete(pendingType);
  }
};

const hasDeferredHandlerReadFor = (handler) => [...runtime.deferredHandlerReads].some((entityType) => (
  entityHandlers.get(entityType) === handler
));

const dispatchPulledEvents = async (
  events = [],
  licenseKey = runtime.licenseKey,
  { isCurrent = null, entityTypes = [], force = false, generation = runtime.generation,
    capturedActorRevision = actorRevision } = {}
) => {
  const grouped = (Array.isArray(events) ? events : []).reduce((acc, event) => {
    const key = event.entity_type || event.entityType || 'generic';
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(event);
    return acc;
  }, new Map());
  for (const entityType of entityTypes) {
    if (!grouped.has(entityType)) grouped.set(entityType, []);
  }
  if (grouped.size === 0) return { applied: true, processedHandlers: new Set() };

  const processedHandlers = new Set();
  let retryableFailure = false;
  let recoverableFailureError = null;
  for (const [entityType, entityEvents] of grouped.entries()) {
    const handler = entityHandlers.get(entityType);
    if (!handler?.onEvents) continue;
    if (isCurrent && !isCurrent()) return { applied: false, retryable: false, reason: 'context_stale', processedHandlers };

    let handlerResult;
    try {
      if (executionScope && !canSchedule()) {
        return { applied: false, retryable: false, reason: 'scope_closed', processedHandlers };
      }
      unknownHandler(`events:${entityType}`);
      handlerResult = await runWithLocalTenantSyncLease(
        { license_key: licenseKey },
        { reason: `pos_sync_event_handler_${entityType}` },
        () => {
          if (executionScope && !canSchedule()) return { skipped: true, reason: 'scope_closed' };
          if (isCurrent && !isCurrent()) return { skipped: true, reason: 'context_stale' };
          return handler.onEvents(entityEvents, {
            licenseKey,
            force: force || runtime.deferredHandlerReads.has(entityType),
            reason: force ? 'deferred_handler_retry' : 'pos_sync_events'
          });
        }
      );
    } catch (error) {
      clearPermissionRefreshForHandler(entityType, handler);
      if (isLocalTenantAccessError(error)) throw error;
      if (isCurrent && !isCurrent()) {
        return { applied: false, retryable: false, reason: 'context_stale', processedHandlers };
      }
      if (isActorRuntimeError(error) && !isModulePermissionFailure(error)) {
        return { applied: false, retryable: false, reason: 'authority_lost', processedHandlers };
      }
      if (isModulePermissionFailure(error)) {
        const persisted = await persistDeferredHandlerRead(entityType, {
          state: 'permission', handler, licenseKey, generation, capturedActorRevision
        });
        if (!persisted) return { applied: false, retryable: false, reason: 'permission_marker_persist_failed', processedHandlers };
        continue;
      }

      Logger.warn(`[PosSync] Handler ${entityType} fallo al consumir eventos:`, error);
      if (isRecoverablePullFailure(error)) {
        const retryAfterSeconds = Number(error.retryAfterSeconds ?? error.response?.retry_after_seconds
          ?? error.response?.retryAfterSeconds);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          runtime.deferredPullRetryAfterMs = Math.max(
            runtime.deferredPullRetryAfterMs,
            Math.min(retryAfterSeconds * 1000, 15 * 60 * 1000)
          );
        }
        const persisted = await persistDeferredHandlerRead(entityType, {
          state: 'deferred', handler, licenseKey, generation, capturedActorRevision
        });
        if (!persisted) return { applied: false, retryable: true, reason: 'deferred_marker_persist_failed', processedHandlers };
        retryableFailure = true;
        recoverableFailureError ||= error;
        continue;
      }
      if (runtime.deferredHandlerReads.has(entityType)) {
        runtime.deferredHandlerBlocked.add(entityType);
      }
      return { applied: false, retryable: false, reason: error?.code || 'handler_failed', processedHandlers };
    }

    if (isCurrent && !isCurrent()) {
      return { applied: false, retryable: false, reason: 'context_stale', processedHandlers };
    }
    processedHandlers.add(handler);
    clearPermissionRefreshForHandler(entityType, handler);

    const result = handlerResult || {};
    const reason = String(result.reason || '');
    const isPermissionSkip = result.skipped === true && reason === 'actor_permission_missing';
    const isOfflineSkip = result.skipped === true && reason === 'offline';
    const isNotApplicableSkip = result.skipped === true && reason === 'module_not_applicable';
    const isContextSkip = result.skipped === true
      && ['context_invalidated', 'context_stale', 'scope_closed', 'runtime_changed'].includes(reason);
    if (isContextSkip) {
      return { applied: false, retryable: false, reason: reason || 'context_invalidated', processedHandlers };
    }

    if (isPermissionSkip || isOfflineSkip) {
      const persisted = await persistDeferredHandlerRead(entityType, {
        state: isPermissionSkip ? 'permission' : 'offline',
        handler,
        licenseKey,
        generation,
        capturedActorRevision
      });
      if (!persisted) {
        return { applied: false, retryable: false, reason: 'handler_skip_marker_persist_failed', processedHandlers };
      }
      continue;
    }

    if (isNotApplicableSkip) continue;
    const handlerDeferred = result.sync_deferred === true || result.syncDeferred === true
      || (result.deferred === true && reason !== 'bootstrap_deferred_snapshot');
    const handlerRetryable = handlerDeferred || result.retryable === true;
    if (handlerRetryable) {
      const persisted = await persistDeferredHandlerRead(entityType, {
        state: 'deferred', handler, licenseKey, generation, capturedActorRevision
      });
      if (!persisted) {
        return { applied: false, retryable: true, reason: 'deferred_marker_persist_failed', processedHandlers };
      }
      retryableFailure = true;
      continue;
    }
    if (result.skipped === true || result.success === false || result.applied === false) {
      if (runtime.deferredHandlerReads.has(entityType)) runtime.deferredHandlerBlocked.add(entityType);
      return { applied: false, retryable: false, reason: reason || 'handler_incomplete', processedHandlers };
    }

    if (hasDeferredHandlerReadFor(handler)) {
      const persisted = await persistDeferredHandlerRead(entityType, {
        state: 'complete', handler, licenseKey, generation, capturedActorRevision
      });
      if (!persisted) {
        return { applied: false, retryable: true, reason: 'deferred_marker_clear_failed', processedHandlers };
      }
    }
  }
  return {
    applied: !retryableFailure,
    retryable: retryableFailure,
    reason: retryableFailure ? 'handler_read_deferred' : null,
    error: recoverableFailureError,
    processedHandlers
  };
};

// Shared by startup and the first online event after an offline start.
// The existing provider owns subscription, retries and teardown in both cases.
const startRealtimeChannel = ({ posTopic, licenseKey, generation }) => {
  if (!isRuntimeGenerationCurrent(generation, licenseKey) || !runtime.started || !canSchedule() || runtime.realtimeChannel) return;
  runtime.realtimeChannel = startPosRealtimeListener({
    posTopic,
    executionScope,
    callbacks: {
      onPosChangeAvailable: ({ eventType, entity, changeSeq } = {}) => {
        if (!isRuntimeGenerationCurrent(generation, licenseKey) || !runtime.started || !canSchedule()) return;
        Logger.log('[POS Sync] Realtime avisó cambios; programando pull incremental.', {
          eventType,
          entity,
          changeSeq
        });

        return posSyncOrchestrator.schedulePullIncremental('realtime').catch((error) => {
          Logger.warn('[PosSync] Pull por realtime fallo:', error, { diagnosticOperation: 'sync.pull' });
        });
      },
      onStatusChange: ({ status, reason: statusReason }) => {
        if (!isRuntimeGenerationCurrent(generation, licenseKey) || !runtime.started || !canSchedule()) return;
        runtime.realtimeStatus = status;
        return observeJob('realtime_status', () => setRuntimeStatus(status, {
          licenseKey,
          generation,
          reason: statusReason
        })).catch((error) => {
          Logger.warn('[PosSync] Cambio de estado realtime bloqueado:', error);
        });
      },
      onConnectionRestored: () => {
        if (!isRuntimeGenerationCurrent(generation, licenseKey) || !runtime.started || !canSchedule()) return;
        return posSyncOrchestrator.schedulePullIncremental('realtime_restored').catch((error) => {
          Logger.warn('[PosSync] Pull tras recuperar realtime fallo:', error, { diagnosticOperation: 'sync.pull' });
        });
      }
    }
  });

  if (executionScope && !ownsScopedPosRealtimeListener(runtime.realtimeChannel, executionScope)) {
    executionScope.markUnobservable('pos_realtime_internal_reconnect_lifetime');
  }

  runtime.realtimeTopic = posTopic;
};

const attachOnlineListener = () => {
  if (typeof window === 'undefined') return;

  const owner = executionScope;
  if (!runtime.onlineListener) {
    runtime.onlineListener = async () => {
      if (!canSchedule(owner) || !runtime.started) return;
      const generation = runtime.generation;
      const licenseKey = runtime.licenseKey;
      const posTopic = runtime.realtimeTopic;
      if (!runtime.realtimeChannel && posTopic) {
        try {
          await observeJob('online_realtime', () => startRealtimeChannel({ posTopic, licenseKey, generation }));
        } catch (error) {
          Logger.warn('[PosSync] Inicio de realtime al reconectar fallo:', error);
        }
      }
      if (!isRuntimeGenerationCurrent(generation, licenseKey) || !runtime.started || !canSchedule(owner)) return;
      Logger.log('[POS Sync] Procesando outbox online.');

      try {
        await posSyncOrchestrator.processOutbox('online');
      } catch (error) {
        Logger.warn('[PosSync] Outbox al reconectar fallo:', error, { diagnosticOperation: 'sync.outbox' });
      }

      if (!canSchedule(owner)) return;
      runtime.deferredHandlerBlocked.clear();
      posSyncOrchestrator.schedulePullIncremental('online').catch((error) => {
        Logger.warn('[PosSync] Pull al reconectar fallo:', error);
      });
    };

    window.addEventListener('online', runtime.onlineListener);
  }

  if (!runtime.visibilityListener && typeof document !== 'undefined') {
    const generation = runtime.generation;
    const licenseKey = runtime.licenseKey;
    runtime.visibilityListener = () => {
      if (document.visibilityState !== 'visible'
        || !runtime.started
        || !canSchedule(owner)
        || !isRuntimeGenerationCurrent(generation, licenseKey)) return;

      posSyncOrchestrator.handleForegroundResume('visibilitychange').catch((error) => {
        Logger.warn('[PosSync] Pull al volver a primer plano fallo:', error, { diagnosticOperation: 'sync.pull' });
      });
    };
    document.addEventListener('visibilitychange', runtime.visibilityListener);
  }
};

const detachVisibilityListener = () => {
  if (runtime.visibilityListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', runtime.visibilityListener);
  }
  runtime.visibilityListener = null;
};

const detachOnlineListener = () => {
  if (runtime.onlineListener && typeof window !== 'undefined') {
    window.removeEventListener('online', runtime.onlineListener);
  }

  runtime.onlineListener = null;
  detachVisibilityListener();
};

const shouldUseRealtimeDebounce = (reason = '') => String(reason || '').toLowerCase().includes('realtime');

export const posSyncOrchestrator = {
  getUpdateActivity() {
    return runtime.startInProgress || runtime.pullInProgress || runtime.outboxInProgress;
  },
  subscribeUpdateActivity(listener) {
    activityListeners.add(listener);
    return () => activityListeners.delete(listener);
  },
  registerEntitySyncHandler(entityType, handler) {
    if (!entityType || !handler) {
      throw new Error('ENTITY_SYNC_HANDLER_INVALID');
    }

    entityHandlers.set(entityType, handler);
    if (handler.pushOperation) scheduleOutbox();
    if (runtime.started && (runtime.deferredHandlerReads.has(entityType)
      || runtime.permissionRefreshEntityTypes.has(entityType))) {
      scheduleDeferredPullRecovery('deferred_handler_registered');
    }
    Logger.log(`[PosSync] Handler registrado para entidad: ${entityType}`);

    return () => {
      entityHandlers.delete(entityType);
    };
  },

  async start({ licenseDetails, reason = 'manual' } = {}) {
    const licenseKey = getLicenseKeyFromDetails(licenseDetails);
    const posTopic = buildPosRealtimeTopic(licenseDetails);

    if (runtime.startInProgress) {
      Logger.log(`[PosSync] Start ya en curso; se omite ${reason}.`);

      return {
        started: runtime.started,
        status: runtime.status,
        skipped: true,
        reason: 'start_in_progress'
      };
    }

    setActivityFlag('startInProgress', true);
    const startAttempt = ++runtime.startAttempt;
    let startGeneration = null;

    try {
      if (licenseKey) {
        await assertLocalTenantSyncAccess(licenseDetails, { reason: `pos_sync_start_${reason}` });
        if (runtime.startAttempt !== startAttempt || !runtime.startInProgress || !canSchedule()) {
          return { started: false, status: runtime.status, stale: true };
        }
      }

      if (!licenseKey || !isCloudPosSyncEnabled(licenseDetails)) {
        await this.stop({ preserveStatus: true });
        const disabledAttempt = startAttempt + 1;
        if (runtime.startAttempt !== disabledAttempt || runtime.started) {
          return { started: runtime.started, status: runtime.status, stale: true };
        }

        const disabledGeneration = runtime.generation;
        runtime.licenseKey = licenseKey;
        await setRuntimeStatus(SYNC_STATUS.DISABLED, {
          licenseKey,
          generation: disabledGeneration,
          reason: 'cloud_pos_sync_off'
        });

        if (runtime.generation !== disabledGeneration || runtime.started) {
          return { started: runtime.started, status: runtime.status, stale: true };
        }

        return {
          started: false,
          status: SYNC_STATUS.DISABLED
        };
      }

      if (
        runtime.started &&
        runtime.licenseKey === licenseKey &&
        runtime.realtimeChannel &&
        runtime.realtimeTopic === posTopic
      ) {
        attachOnlineListener();

        return {
          started: true,
          status: runtime.status,
          skipped: true,
          reason: 'already_started'
        };
      }

      startGeneration = ++runtime.generation;
      runtime.lastForegroundPullAt = 0;
      detachVisibilityListener();
      stopOutboxSources();
      if (runtime.licenseKey && runtime.licenseKey !== licenseKey) {
        runtime.deferredPullPending = false;
        runtime.deferredHandlerReads = new Set();
        runtime.deferredHandlerBlocked.clear();
        runtime.permissionRefreshEntityTypes.clear();
        runtime.deferredPullRetryAttempt = 0;
        runtime.deferredPullRetryAfterMs = 0;
      }
      if (runtime.started && (runtime.licenseKey !== licenseKey || runtime.realtimeTopic !== posTopic)) {
        await stopRealtimeChannel();
        if (runtime.generation !== startGeneration) return { started: false, status: runtime.status };
      }

      runtime.started = true;
      runtime.licenseKey = licenseKey;
      const [persistedDeferredReadPending, persistedDeferredHandlerReads] = await Promise.all([
        syncMetaService.getDeferredReadPending(licenseKey),
        syncMetaService.getDeferredHandlerReads(licenseKey)
      ]);
      if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
        return { started: false, status: runtime.status, stale: true };
      }
      runtime.deferredPullPending = runtime.deferredPullPending || persistedDeferredReadPending === true;
      runtime.deferredHandlerReads = new Set([
        ...runtime.deferredHandlerReads,
        ...(Array.isArray(persistedDeferredHandlerReads) ? persistedDeferredHandlerReads : [])
      ]);
      runtime.deferredHandlerBlocked.clear();
      if (!hasDeferredReadWork()) {
        runtime.deferredPullRetryAttempt = 0;
        runtime.deferredPullRetryAfterMs = 0;
      }

      startOutboxSources();
      attachOnlineListener();
      await syncOutboxService.resetStuckProcessing(
        SYNC_LIMITS.STUCK_PROCESSING_MS,
        { licenseKey }
      );
      if (!isRuntimeGenerationCurrent(startGeneration, licenseKey)) return { started: false, status: runtime.status };

      runtime.realtimeStatus = SYNC_STATUS.DEGRADED;
      if (!isBrowserOnline()) {
        // Keep the topic so the existing online source can install the listener.
        runtime.realtimeTopic = posTopic;
        runtime.realtimeStatus = SYNC_STATUS.OFFLINE;
        await setRuntimeStatus(SYNC_STATUS.OFFLINE, {
          licenseKey,
          generation: startGeneration,
          reason: 'offline_on_start'
        });

        if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
          return { started: false, status: runtime.status, stale: true };
        }

        return {
          started: true,
          status: SYNC_STATUS.OFFLINE
        };
      }

      await setRuntimeStatus(SYNC_STATUS.DEGRADED, { licenseKey, reason, generation: startGeneration });
      if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !canSchedule()) return { started: false, stale: true };
      await runEntityStartHooks({ licenseDetails, licenseKey, reason });
      if (!isRuntimeGenerationCurrent(startGeneration, licenseKey)) return { started: false, status: runtime.status };

      if (shouldDeferPosBootstrapStartHook(reason)) {
        Logger.log('[PosSync] Pull/outbox inicial omitido: el bootstrap inteligente lo agenda con jitter.');
      } else {
        await this.pullIncremental('start');
        await this.processOutbox('start');
        if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
          return { started: false, status: runtime.status };
        }
      }

      if (posTopic) {
        if (!runtime.realtimeChannel || runtime.realtimeTopic !== posTopic) {
          await stopRealtimeChannel();
          if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
            return { started: false, status: runtime.status };
          }

          startRealtimeChannel({ posTopic, licenseKey, generation: startGeneration });
        }
      } else {
        await setRuntimeStatus(SYNC_STATUS.DEGRADED, {
          licenseKey,
          generation: startGeneration,
          reason: 'missing_pos_topic'
        });
        if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
          return { started: false, status: runtime.status, stale: true };
        }
      }

      if (hasSchedulableDeferredReadWork()) scheduleDeferredPullRecovery('deferred_startup');

      return {
        started: true,
        status: runtime.status
      };
    } catch (error) {
      if (startGeneration !== null && isRuntimeGenerationCurrent(startGeneration, licenseKey)) {
        clearRealtimePullTimer();
        clearDeferredPullTimer();
        runtime.started = false;
        setActivityFlag('pullInProgress', false);
        runtime.pendingPull = false;
        stopOutboxSources();
        runtime.lastPullReason = null;
        detachOnlineListener();

        try {
          await stopRealtimeChannel();
        } catch (stopError) {
          Logger.warn('[PosSync] Fallo limpiando un start incompleto:', stopError);
        }

        if (isRuntimeGenerationCurrent(startGeneration, licenseKey)) {
          runtime.licenseKey = null;
          runtime.status = SYNC_STATUS.DISABLED;
        }
      }
      throw error;
    } finally {
      if (runtime.startAttempt === startAttempt) setActivityFlag('startInProgress', false);
    }
  },

  async stop({ preserveStatus = false } = {}) {
    runtime.startAttempt += 1;
    const stopGeneration = ++runtime.generation;
    clearRealtimePullTimer();
    clearDeferredPullTimer();
    runtime.started = false;
    runtime.lastForegroundPullAt = 0;
    setActivityFlag('startInProgress', false);
    setActivityFlag('pullInProgress', false);
    runtime.pendingPull = false;
    runtime.deferredPullRetryAttempt = 0;
    runtime.deferredPullRetryAfterMs = 0;
    runtime.deferredHandlerBlocked.clear();
    runtime.permissionRefreshEntityTypes.clear();
    stopOutboxSources();
    runtime.lastPullReason = null;
    detachOnlineListener();

    await stopRealtimeChannel();
    if (runtime.generation !== stopGeneration) return;

    if (!preserveStatus) {
      runtime.status = SYNC_STATUS.DISABLED;
      try {
        await setRuntimeStatus(SYNC_STATUS.DISABLED, {
          licenseKey: runtime.licenseKey,
          generation: stopGeneration,
          reason: 'stopped'
        });
      } catch (error) {
        // Mismatch/logout must still tear down the in-memory channel after the
        // guard locks. In that state tenant metadata is intentionally immutable.
        if (!isLocalTenantAccessError(error)) throw error;
      }
    }
  },

  async schedulePullIncremental(reason = 'manual', { debounceMs = null } = {}) {
    if (!runtime.started || !runtime.licenseKey) return null;

    const safeReason = String(reason || 'manual');
    if (runtime.deferredPullTimer) clearDeferredPullTimer();
    if (runtime.pullInProgress) {
      runtime.pendingPull = true;
      runtime.lastPullReason = safeReason;
      Logger.log('[POS Sync] Pull incremental pendiente; se ejecutará al terminar el actual.');
      return { skipped: true, reason: 'pull_in_progress_pending' };
    }
    const resolvedDebounceMs = debounceMs ?? (
      shouldUseRealtimeDebounce(safeReason) ? POS_SYNC_REALTIME_PULL_DEBOUNCE_MS : 0
    );

    if (!Number.isFinite(Number(resolvedDebounceMs)) || Number(resolvedDebounceMs) <= 0) {
      return this.pullIncremental(safeReason);
    }

    if (runtime.realtimePullTimer) {
      clearRealtimePullTimer();
      Logger.log('[POS Sync] Realtime avisó cambios; pull incremental ya programado, reagrupando evento.');
    }

    runtime.realtimePullScheduled = true;
    if (executionScope) {
      const owner = executionScope;
      runtime.realtimePullTimer = owner.schedule('pos:debounce', () => {
        runtime.realtimePullTimer = null;
        runtime.realtimePullScheduled = false;
        if (!canSchedule(owner)) return null;
        return this.pullIncremental(safeReason);
      }, Number(resolvedDebounceMs));
      return { scheduled: true, reason: safeReason, debounceMs: Number(resolvedDebounceMs) };
    }
    runtime.realtimePullTimer = window.setTimeout(() => {
      runtime.realtimePullTimer = null;
      runtime.realtimePullScheduled = false;
      this.pullIncremental(safeReason).catch((error) => {
        Logger.warn('[PosSync] Pull incremental programado fallo:', error);
      });
    }, Number(resolvedDebounceMs));

    return {
      scheduled: true,
      reason: safeReason,
      debounceMs: Number(resolvedDebounceMs)
    };
  },

  async handleForegroundResume(reason = 'focus') {
    if (!runtime.started || !runtime.licenseKey) return null;

    const now = Date.now();
    const elapsedSinceLastForegroundPull = now - runtime.lastForegroundPullAt;

    if (
      runtime.realtimeStatus === SYNC_STATUS.ONLINE &&
      !hasDeferredReadWork() &&
      runtime.lastForegroundPullAt > 0 &&
      elapsedSinceLastForegroundPull < POS_SYNC_FOCUS_PULL_COOLDOWN_MS
    ) {
      Logger.log('[POS Sync] Pull incremental por focus omitido: cooldown activo y realtime POS sigue sano.');
      return {
        skipped: true,
        reason: 'focus_cooldown',
        cooldownMs: POS_SYNC_FOCUS_PULL_COOLDOWN_MS
      };
    }

    runtime.lastForegroundPullAt = now;
    return this.schedulePullIncremental(reason);
  },

  async pullIncremental(reason = 'manual') {
    if (!runtime.started || !runtime.licenseKey) return null;
    const operationLicenseKey = runtime.licenseKey;
    const operationGeneration = runtime.generation;
    let operationActorRevision = actorRevision;

    await assertLocalTenantSyncAccess(
      { license_key: operationLicenseKey },
      { reason: `pos_sync_pull_${reason}` }
    );
    if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
      return null;
    }

    if (!isBrowserOnline()) {
      clearDeferredPullTimer();
      await setRuntimeStatus(SYNC_STATUS.OFFLINE, {
        licenseKey: operationLicenseKey,
        generation: operationGeneration,
        reason: 'offline_pull_skip'
      });

      return null;
    }

    if (runtime.pullInProgress) {
      clearDeferredPullTimer();
      runtime.pendingPull = true;
      runtime.lastPullReason = reason;
      Logger.log('[POS Sync] Pull incremental omitido: ya hay uno en curso.');
      Logger.log('[POS Sync] Pull incremental pendiente; se ejecutará al terminar el actual.');
      return {
        skipped: true,
        reason: 'pull_in_progress_pending'
      };
    }

    setActivityFlag('pullInProgress', true);
    clearDeferredPullTimer();
    runtime.lastPullReason = reason;
    runtime.lastPullStartedAt = Date.now();

    let actorHandle = null;
    const isPullContextCurrent = () => {
      if (!actorHandle || actorRevision !== operationActorRevision
        || !isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey)
        || !runtime.started) return false;
      try {
        actorHandle.assertCurrent();
        return true;
      } catch (error) {
        if (isActorRuntimeError(error)) return false;
        throw error;
      }
    };

    try {
      actorHandle = actorRuntimeController.capture();
      operationActorRevision = actorRevision;
      let sinceChangeSeq = await syncMetaService.getLastChangeSeq(operationLicenseKey);
      if (!isPullContextCurrent()) return null;
      let latestResponse = null;
      let totalEvents = 0;
      let hasMore = true;
      const processedHandlers = new Set();

      while (hasMore) {
        if (!isPullContextCurrent()) return null;
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_rpc_${reason}` }
        );
        if (!isPullContextCurrent()) return null;
        const batchSinceChangeSeq = Number(sinceChangeSeq) || 0;
        const response = await posSyncClient.pullSyncEvents({
          licenseKey: operationLicenseKey,
          sinceChangeSeq: batchSinceChangeSeq,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
        });

        if (!isPullContextCurrent()) return null;

        latestResponse = response;
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_apply_${reason}` }
        );
        if (!isPullContextCurrent()) return null;

        if (!response.success) {
          runtime.pendingPull = false;
          const nextStatus = response.code === 'CLOUD_POS_SYNC_DISABLED'
            ? SYNC_STATUS.DISABLED
            : SYNC_STATUS.DEGRADED;

          if (response.code === 'CLOUD_POS_SYNC_DISABLED') {
            await setDeferredReadPending(false, {
              licenseKey: operationLicenseKey,
              generation: operationGeneration,
              capturedActorRevision: operationActorRevision
            });
          } else if (response.retryable && hasSchedulableDeferredReadWork()
            && isRecoverablePullFailure(response)) {
            scheduleDeferredPullRecovery('deferred_retryable_response');
          } else {
            clearDeferredPullTimer();
          }

          await setRuntimeStatus(nextStatus, {
            licenseKey: operationLicenseKey,
            generation: operationGeneration,
            reason: response.code || 'pull_not_success'
          });
          return response;
        }

        if (response.syncDeferred) {
          await setDeferredReadPending(true, {
            licenseKey: operationLicenseKey,
            generation: operationGeneration,
            capturedActorRevision: operationActorRevision
          });
          if (!isPullContextCurrent()) return null;
        }

        const pulledEvents = Array.isArray(response.events) ? response.events : [];
        totalEvents += pulledEvents.length;
        const pageApplied = await dispatchPulledEvents(pulledEvents, operationLicenseKey, {
          isCurrent: isPullContextCurrent,
          generation: operationGeneration,
          capturedActorRevision: operationActorRevision
        });
        for (const handler of pageApplied.processedHandlers || []) processedHandlers.add(handler);
        if (pageApplied?.applied !== true || !isPullContextCurrent()) {
          if (pageApplied?.retryable && hasSchedulableDeferredReadWork()) {
            scheduleDeferredPullRecovery('deferred_handler_retry');
          }
          if (pageApplied?.error && isPullContextCurrent()) {
            await assertLocalTenantSyncAccess(
              { license_key: operationLicenseKey },
              { reason: `pos_sync_pull_handler_error_${reason}` }
            );
            if (!isPullContextCurrent()) return null;
            await syncMetaService.setLastPullError(pageApplied.error, operationLicenseKey);
            await setRuntimeStatus(SYNC_STATUS.DEGRADED, {
              licenseKey: operationLicenseKey,
              generation: operationGeneration,
              reason: 'handler_read_retryable_failure'
            });
          }
          return null;
        }
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_cursor_${reason}` }
        );
        if (!isPullContextCurrent()) return null;

        const latestChangeSeq = Number(response.latestChangeSeq ?? batchSinceChangeSeq) || batchSinceChangeSeq;
        if (latestChangeSeq > batchSinceChangeSeq) {
          const advancedCursor = await syncMetaService.advanceLastChangeSeq(latestChangeSeq, operationLicenseKey);
          sinceChangeSeq = advancedCursor !== null && advancedCursor !== undefined
            && Number.isFinite(Number(advancedCursor)) && Number(advancedCursor) >= batchSinceChangeSeq
            ? Number(advancedCursor)
            : latestChangeSeq;
          if (!isPullContextCurrent()) return null;
        }

        hasMore = Boolean(response.hasMore);
        if (hasMore && latestChangeSeq <= batchSinceChangeSeq) {
          Logger.warn(response.syncDeferred
            ? '[POS Sync] Pull incremental aplazado: el cursor seguro no avanzó.'
            : '[POS Sync] Pull incremental detenido: has_more sin avance de cursor.');
          hasMore = false;
        }

        if (!response.syncDeferred && !hasMore && runtime.deferredPullPending) {
          await setDeferredReadPending(false, {
            licenseKey: operationLicenseKey,
            generation: operationGeneration,
            capturedActorRevision: operationActorRevision
          });
          if (!isPullContextCurrent()) return null;
        }
      }

      const recoveryEntityTypes = [];
      const recoveryHandlers = new Set(processedHandlers);
      const recoveryCandidates = [
        ...runtime.deferredHandlerReads,
        ...runtime.permissionRefreshEntityTypes
      ];
      for (const entityType of recoveryCandidates) {
        if (runtime.deferredHandlerBlocked.has(entityType)) continue;
        const handler = entityHandlers.get(entityType);
        if (!handler?.onEvents || recoveryHandlers.has(handler)) continue;
        recoveryHandlers.add(handler);
        recoveryEntityTypes.push(entityType);
      }
      if (recoveryEntityTypes.length > 0) {
        const recoveryResult = await dispatchPulledEvents([], operationLicenseKey, {
          isCurrent: isPullContextCurrent,
          entityTypes: recoveryEntityTypes,
          force: true,
          generation: operationGeneration,
          capturedActorRevision: operationActorRevision
        });
        if (recoveryResult?.applied !== true || !isPullContextCurrent()) {
          if (recoveryResult?.retryable && hasSchedulableDeferredReadWork()) {
            scheduleDeferredPullRecovery('deferred_handler_retry');
          }
          return null;
        }
      }

      if (hasSchedulableDeferredReadWork()) {
        scheduleDeferredPullRecovery(runtime.deferredPullPending ? 'deferred_retry' : 'deferred_handler_retry');
      }

      await assertLocalTenantSyncAccess(
        { license_key: operationLicenseKey },
        { reason: `pos_sync_pull_commit_${reason}` }
      );
      if (!isPullContextCurrent()) return null;
      await syncMetaService.setLastPullAt(operationLicenseKey);
      await syncMetaService.setLastPullError(null, operationLicenseKey);

      // A completed HTTP pull does not establish a live Realtime subscription.
      await setRuntimeStatus(isBrowserOnline()
        ? (runtime.realtimeStatus === SYNC_STATUS.ONLINE ? SYNC_STATUS.ONLINE : SYNC_STATUS.DEGRADED)
        : SYNC_STATUS.OFFLINE, {
        licenseKey: operationLicenseKey,
        generation: operationGeneration,
        reason: `pull_${reason}`
      });

      return {
        ...(latestResponse || { success: true, events: [] }),
        totalEvents,
        latestChangeSeq: Number(sinceChangeSeq) || 0
      };
    } catch (error) {
      if (isLocalTenantAccessError(error)) {
        clearDeferredPullTimer();
        runtime.pendingPull = false;
        throw error;
      }
      if (executionScope && !isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey)) return null;
      Logger.warn('[PosSync] Pull incremental fallo:', error, { diagnosticOperation: 'sync.pull' });
      if (hasSchedulableDeferredReadWork()) {
        runtime.pendingPull = false;
        if (isRecoverablePullFailure(error) && isPullContextCurrent() && isBrowserOnline()) {
          scheduleDeferredPullRecovery(runtime.deferredPullPending ? 'deferred_retry' : 'deferred_handler_retry');
        } else {
          clearDeferredPullTimer();
        }
      }
      await assertLocalTenantSyncAccess(
        { license_key: operationLicenseKey },
        { reason: `pos_sync_pull_error_${reason}` }
      );
      await syncMetaService.setLastPullError(error, operationLicenseKey);

      await setRuntimeStatus(SYNC_STATUS.DEGRADED, {
        licenseKey: operationLicenseKey,
        generation: operationGeneration,
        reason: 'pull_error'
      });

      return null;
    } finally {
      if (isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey)) {
        setActivityFlag('pullInProgress', false);
        runtime.lastPullFinishedAt = Date.now();

        const pendingReason = runtime.pendingPull ? runtime.lastPullReason || 'pending' : null;
        runtime.pendingPull = false;

        if (pendingReason && runtime.started && runtime.licenseKey && isBrowserOnline() && canSchedule()) {
          Logger.log('[POS Sync] Ejecutando pull incremental pendiente al terminar el actual.');
          await this.pullIncremental(`pending_after_${pendingReason}`);
        }
      }
    }
  },

  async processOutbox(reason = 'manual') {
    if (!runtime.started || !runtime.licenseKey || !isBrowserOnline()) {
      return { processed: 0 };
    }
    if (runtime.outboxInProgress) {
      outboxWakeRequested = true;
      return { processed: 0, skipped: true, reason: 'outbox_in_progress' };
    }

    const licenseKey = runtime.licenseKey;
    const generation = runtime.generation;
    const revision = actorRevision;
    let actor;
    try {
      actor = actorRuntimeController.capture();
    } catch (error) {
      if (!isActorRuntimeError(error)) throw error;
      return { processed: 0, skipped: true, reason: 'actor_unavailable' };
    }

    const isOutboxRuntimeCurrent = () => runtime.started && canSchedule()
      && isRuntimeGenerationCurrent(generation, licenseKey);
    const isCurrent = () => {
      if (!isOutboxRuntimeCurrent() || !isBrowserOnline() || revision !== actorRevision) return false;
      try {
        actor.assertCurrent();
        return true;
      } catch (error) {
        if (!isActorRuntimeError(error)) throw error;
        return false;
      }
    };

    clearOutboxTimer();
    setActivityFlag('outboxInProgress', true);
    let processed = 0;
    let nextRetryAt = Infinity;
    try {
      await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: `pos_sync_outbox_${reason}` });
      if (!isCurrent()) return { processed, skipped: true, reason: 'runtime_changed' };

      unsubscribeOutboxChanges ??= syncOutboxService.observeChanges(() => {
        if (isRuntimeGenerationCurrent(generation, licenseKey)) scheduleOutbox();
      });

      const pending = await syncOutboxService.getPendingOperations({
        licenseKey,
        limit: SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT,
        canProcess: (row) => {
          const handler = entityHandlers.get(row.entityType);
          return handler?.pushOperation && handler.canPushOperation?.(row) !== false
            && (!row.originActorKey || row.actorSensitivity === 'tenant_shared' || row.originActorKey === actor.actorKey);
        },
        onFutureRetry: (retryAt) => { nextRetryAt = Math.min(nextRetryAt, retryAt); }
      });
      const updateRequiredFamilies = new Set();

      for (const operation of pending) {
        if (!isCurrent()) return { processed, skipped: true, reason: 'runtime_changed' };
        const handler = entityHandlers.get(operation.entityType);
        const family = getCloudSyncProtocolFamilyForEntity(operation.entityType);
        if (!handler?.pushOperation || updateRequiredFamilies.has(family)) continue;

        await runWithLocalTenantSyncLease(
          { license_key: licenseKey },
          { reason: `pos_sync_outbox_handler_${operation.entityType}` },
          async () => {
            const claimed = await syncOutboxService.claimPendingOperation(operation, { licenseKey, isCurrent });
            if (!claimed || !isOutboxRuntimeCurrent()) return;
            if (!isCurrent()) {
              await syncOutboxService.releaseUnsentOperation(claimed, { licenseKey });
              return;
            }

            let result;
            try {
              unknownHandler(`push:${operation.entityType}`);
              result = await handler.pushOperation(claimed, { actorHandle: actor });
            } catch (error) {
              if (isLocalTenantAccessError(error) || !isOutboxRuntimeCurrent()) throw error;
              if (isActorRuntimeError(error) && !isCurrent()) {
                await syncOutboxService.releaseUnsentOperation(claimed, { licenseKey });
                return;
              }
              Logger.warn('[PosSync] Enviar pendientes falló:', error, { diagnosticOperation: 'sync.outbox' });
              if (isCloudClientUpdateRequired(error) && (error.family || family)) {
                const blockedFamily = error.family || family;
                updateRequiredFamilies.add(blockedFamily);
                await syncOutboxService.pauseForUpdateRequiredFamily(blockedFamily, { licenseKey });
              } else {
                const retryAt = await syncOutboxService.markFailed(operation.id, error, {
                  retry: !classifyActorAuthorityError(error) && !isCloudClientUpdateRequired(error)
                    && error?.retryable !== false && error?.response?.retryable !== false,
                  onlyProcessing: true,
                  licenseKey
                });
                if (retryAt) nextRetryAt = Math.min(nextRetryAt, Date.parse(retryAt));
              }
              return;
            }

            // A quiesced runtime leaves an in-flight claim for recovery.
            if (!isOutboxRuntimeCurrent()) return;
            if (result?.conflict) {
              await syncOutboxService.markConflict(operation.id, result.conflict, { licenseKey });
            } else {
              await syncOutboxService.markSynced(operation.id, result || null, { licenseKey });
            }
            processed += 1;
          }
        );
      }

      if (!isCurrent()) return { processed, skipped: true, reason: 'runtime_changed' };
      if (pending.length === SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT) nextRetryAt = Date.now();
      return { processed };
    } finally {
      const wakeRequested = outboxWakeRequested;
      outboxWakeRequested = false;
      setActivityFlag('outboxInProgress', false);
      if (wakeRequested || !isRuntimeGenerationCurrent(generation, licenseKey)) scheduleOutbox();
      else if (Number.isFinite(nextRetryAt) && isCurrent()) scheduleOutbox(nextRetryAt);
    }
  },

  getStatus() {
    const { realtimePullTimer, deferredPullTimer, ...safeRuntime } = runtime;
    return {
      ...safeRuntime,
      realtimePullScheduled: Boolean(realtimePullTimer) || runtime.realtimePullScheduled,
      deferredPullScheduled: Boolean(deferredPullTimer),
      handlers: Array.from(entityHandlers.keys())
    };
  }
};

const originalStart = posSyncOrchestrator.start;
const originalStop = posSyncOrchestrator.stop;
posSyncOrchestrator.assertExecutionScopeAvailable = scope => {
  scope.assertAdmission();
  if (executionScope === scope) return;
  if (executionScope && executionScope.getSnapshot().state !== 'DRAINED') {
    throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
  }
  if (legacyWorkStarted || runtime.started || runtime.startInProgress || runtime.pullInProgress || runtime.outboxInProgress) {
    throw new Error('SYNC_EXECUTION_LEGACY_OWNER_ACTIVE');
  }
};
const bindExecutionScope = scope => {
  posSyncOrchestrator.assertExecutionScopeAvailable(scope);
  if (executionScope === scope) return;
  executionScope = scope;
  scopedStop = null;
  scope.addSource('pos_orchestrator', () => {
    scopedStop ||= originalStop.call(posSyncOrchestrator, { preserveStatus: true });
    return scopedStop;
  });
};
// Reserve ownership synchronously, before any bootstrap awaits or factories.
posSyncOrchestrator.reserveExecutionScope = bindExecutionScope;
posSyncOrchestrator.start = function start(options = {}) {
  if (options.executionScope) bindExecutionScope(options.executionScope);
  return observeJob('start', () => originalStart.call(this, options));
};
for (const name of ['pullIncremental', 'processOutbox', 'schedulePullIncremental', 'handleForegroundResume']) {
  const original = posSyncOrchestrator[name];
  posSyncOrchestrator[name] = function scopedJob(...args) {
    // Event APIs expect a promise even when admission fails synchronously.
    try { return observeJob(name, () => original.apply(this, args)); }
    catch (error) { return Promise.reject(error); }
  };
}
posSyncOrchestrator.stop = function stop(options = {}) {
  if (!executionScope) return originalStop.call(this, options);
  executionScope.quiesce();
  // stopScheduling is not drain. The registered source owns its cleanup promise.
  return Promise.resolve().then(() => scopedStop);
};

export default posSyncOrchestrator;
