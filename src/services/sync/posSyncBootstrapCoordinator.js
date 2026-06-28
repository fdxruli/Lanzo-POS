import { useAppStore } from '../../store/useAppStore';
import Logger from '../Logger';
import { cashSyncHandler } from '../cash/cashSyncHandler';
import { customerSyncHandler } from '../customers/customerSyncHandler';
import { customerCreditSyncHandler } from '../customerCredit/customerCreditSyncHandler';
import { productLocalRepository } from '../products/productLocalRepository';
import { productSyncHandler } from '../products/productSyncHandler';
import { salesCloudSyncHandler } from '../salesCloud/salesCloudSyncHandler';
import { posSyncOrchestrator } from './posSyncOrchestrator';
import {
  getLicenseKeyFromDetails,
  isCloudPosSyncEnabled,
  POS_BOOTSTRAP_JITTER_MS,
  POS_BOOTSTRAP_RESOURCES,
  POS_DEFERRED_SNAPSHOT_DELAY_MS
} from './syncConstants';

const RESOURCE_DELAY = Object.freeze({
  [POS_BOOTSTRAP_RESOURCES.PRODUCTS]: POS_DEFERRED_SNAPSHOT_DELAY_MS.PRODUCTS,
  [POS_BOOTSTRAP_RESOURCES.CUSTOMERS]: POS_DEFERRED_SNAPSHOT_DELAY_MS.CUSTOMERS,
  [POS_BOOTSTRAP_RESOURCES.CASH]: POS_DEFERRED_SNAPSHOT_DELAY_MS.CASH,
  [POS_BOOTSTRAP_RESOURCES.CREDIT]: POS_DEFERRED_SNAPSHOT_DELAY_MS.CREDIT,
  [POS_BOOTSTRAP_RESOURCES.SALES]: POS_DEFERRED_SNAPSHOT_DELAY_MS.SALES,
  [POS_BOOTSTRAP_RESOURCES.REPORTS]: POS_DEFERRED_SNAPSHOT_DELAY_MS.REPORTS
});

const ROUTE_RESOURCES = Object.freeze([
  { test: (path) => path === '/' || path === '', resources: [POS_BOOTSTRAP_RESOURCES.POS] },
  { test: (path) => path.startsWith('/productos'), resources: [POS_BOOTSTRAP_RESOURCES.PRODUCTS] },
  { test: (path) => path.startsWith('/clientes'), resources: [POS_BOOTSTRAP_RESOURCES.CUSTOMERS, POS_BOOTSTRAP_RESOURCES.CREDIT] },
  { test: (path) => path.startsWith('/caja'), resources: [POS_BOOTSTRAP_RESOURCES.CASH] },
  { test: (path) => path.startsWith('/ventas'), resources: [POS_BOOTSTRAP_RESOURCES.REPORTS, POS_BOOTSTRAP_RESOURCES.SALES] }
]);

const bootstrapState = {
  started: false,
  realtimeStarted: false,
  initialPullStarted: false,
  initialPullCompleted: false,
  outboxStarted: false,
  snapshotsDeferred: true,
  lastBootstrapAt: 0,
  licenseKey: null,
  signature: null,
  startPromise: null,
  timers: new Map(),
  moduleDemand: new Set(),
  completedSnapshots: new Map(),
  routeListenerAttached: false,
  historyPatched: false
};

let originalPushState = null;
let originalReplaceState = null;

const isDevLogEnabled = () => import.meta.env.MODE !== 'production';

const devLog = (message, meta = null) => {
  if (!isDevLogEnabled()) return;
  if (meta) Logger.log(`[PosBootstrap] ${message}`, meta);
  else Logger.log(`[PosBootstrap] ${message}`);
};

const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const getTimerApi = () => (typeof window !== 'undefined' ? window : globalThis);

const normalizeResource = (resource) => {
  const value = String(resource || '').trim().toLowerCase();
  return Object.values(POS_BOOTSTRAP_RESOURCES).includes(value) ? value : null;
};

const normalizeResources = (resource) => (
  Array.isArray(resource) ? resource : [resource]
).map(normalizeResource).filter(Boolean);

const randomJitterMs = () => {
  const min = Number(POS_BOOTSTRAP_JITTER_MS.MIN) || 0;
  const max = Math.max(Number(POS_BOOTSTRAP_JITTER_MS.MAX) || min, min);
  return Math.floor(min + Math.random() * (max - min + 1));
};

const clearTimer = (key) => {
  const timer = bootstrapState.timers.get(key);
  if (!timer) return;
  getTimerApi().clearTimeout(timer);
  bootstrapState.timers.delete(key);
};

const clearAllTimers = () => {
  for (const key of bootstrapState.timers.keys()) {
    clearTimer(key);
  }
};

const setTimer = (key, callback, delayMs) => {
  clearTimer(key);
  const timer = getTimerApi().setTimeout(() => {
    bootstrapState.timers.delete(key);
    callback();
  }, Math.max(Number(delayMs) || 0, 0));
  bootstrapState.timers.set(key, timer);
  return timer;
};

const getRuntimeContext = (override = {}) => {
  const state = useAppStore.getState();
  const licenseDetails = override.licenseDetails || state?.licenseDetails || null;
  const licenseKey = override.licenseKey || getLicenseKeyFromDetails(licenseDetails);

  return {
    state,
    licenseDetails,
    licenseKey,
    cloudEnabled: Boolean(licenseKey && isCloudPosSyncEnabled(licenseDetails))
  };
};

const buildBootstrapSignature = ({ state, licenseDetails, licenseKey }) => {
  const planCode = licenseDetails?.plan_code || licenseDetails?.details?.plan_code || 'no-plan';
  const realtimeTopic = licenseDetails?.realtime_topic || licenseDetails?.details?.realtime_topic || 'no-topic';
  const deviceRole = state?.currentDeviceRole || licenseDetails?.device_role || licenseDetails?.details?.device_role || 'no-role';
  const staffUserId = state?.currentStaffUser?.id || licenseDetails?.staff_user?.id || licenseDetails?.details?.staff_user?.id || 'admin';
  return [licenseKey || 'no-license', planCode, realtimeTopic, deviceRole, staffUserId].join('|');
};

const resetBootstrapState = ({ keepRouteListener = true } = {}) => {
  clearAllTimers();
  bootstrapState.started = false;
  bootstrapState.realtimeStarted = false;
  bootstrapState.initialPullStarted = false;
  bootstrapState.initialPullCompleted = false;
  bootstrapState.outboxStarted = false;
  bootstrapState.snapshotsDeferred = true;
  bootstrapState.lastBootstrapAt = 0;
  bootstrapState.licenseKey = null;
  bootstrapState.signature = null;
  bootstrapState.startPromise = null;
  bootstrapState.moduleDemand.clear();
  bootstrapState.completedSnapshots.clear();

  if (!keepRouteListener) {
    bootstrapState.routeListenerAttached = false;
  }
};

const getResourcesForCurrentRoute = () => {
  if (typeof window === 'undefined') return [];
  const path = window.location?.pathname || '/';
  const match = ROUTE_RESOURCES.find((entry) => entry.test(path));
  return match?.resources || [];
};

const emitRouteDemand = () => {
  const resources = getResourcesForCurrentRoute();
  if (resources.length > 0) {
    markModuleDemand(resources, { reason: 'route_demand' });
  }
};

const attachRouteDemandListener = () => {
  if (typeof window === 'undefined' || bootstrapState.routeListenerAttached) return;

  const emit = () => getTimerApi().setTimeout(emitRouteDemand, 0);

  if (!bootstrapState.historyPatched && window.history) {
    originalPushState = window.history.pushState;
    originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushStateWithDemand(...args) {
      const result = originalPushState.apply(this, args);
      emit();
      return result;
    };

    window.history.replaceState = function replaceStateWithDemand(...args) {
      const result = originalReplaceState.apply(this, args);
      emit();
      return result;
    };

    bootstrapState.historyPatched = true;
  }

  window.addEventListener('popstate', emit);
  window.addEventListener('hashchange', emit);
  bootstrapState.routeListenerAttached = true;
};

const shouldSkipCompletedSnapshot = (resource, licenseKey, force) => {
  if (force) return false;
  return bootstrapState.completedSnapshots.get(resource) === licenseKey;
};

const markSnapshotCompleted = (resource, licenseKey) => {
  if (!resource || !licenseKey) return;
  bootstrapState.completedSnapshots.set(resource, licenseKey);
};

const hasLocalProductCache = async () => {
  try {
    const catalog = await productLocalRepository.getLocalCatalogForMigration();
    const total = Number(catalog?.categories?.length || 0)
      + Number(catalog?.products?.length || 0)
      + Number(catalog?.batches?.length || 0);
    return total > 0;
  } catch (error) {
    Logger.warn('[PosBootstrap] No se pudo evaluar cache local de productos:', error);
    return false;
  }
};

const runDeferredSnapshot = async (resource, { reason = 'deferred_snapshot', force = false } = {}) => {
  const normalizedResource = normalizeResource(resource);
  if (!normalizedResource) return { skipped: true, reason: 'invalid_resource' };

  const { licenseDetails, licenseKey, cloudEnabled } = getRuntimeContext();
  if (!cloudEnabled || !licenseKey || !isBrowserOnline()) {
    devLog('deferred snapshot skipped', { resource: normalizedResource, reason: 'not_ready_or_offline' });
    return { skipped: true, reason: 'not_ready_or_offline' };
  }

  if (shouldSkipCompletedSnapshot(normalizedResource, licenseKey, force)) {
    devLog('deferred snapshot skipped', { resource: normalizedResource, reason: 'already_completed' });
    return { skipped: true, reason: 'already_completed' };
  }

  devLog('deferred snapshot start', { resource: normalizedResource, reason });

  let result;
  switch (normalizedResource) {
    case POS_BOOTSTRAP_RESOURCES.PRODUCTS:
      result = await productSyncHandler.onStart({ licenseDetails, licenseKey, reason, force });
      break;
    case POS_BOOTSTRAP_RESOURCES.CUSTOMERS:
      result = await customerSyncHandler.onStart({ licenseDetails, licenseKey, reason, force });
      break;
    case POS_BOOTSTRAP_RESOURCES.CASH:
      result = await cashSyncHandler.onStart({ licenseDetails, licenseKey, reason, force });
      break;
    case POS_BOOTSTRAP_RESOURCES.CREDIT:
      result = await customerCreditSyncHandler.onStart({ licenseDetails, licenseKey, reason, force });
      break;
    case POS_BOOTSTRAP_RESOURCES.SALES:
      result = await salesCloudSyncHandler.onStart({ licenseDetails, licenseKey, reason, force });
      break;
    case POS_BOOTSTRAP_RESOURCES.REPORTS:
      result = { skipped: true, reason: 'reports_load_on_repository_demand' };
      break;
    default:
      result = { skipped: true, reason: 'no_snapshot_for_resource' };
      break;
  }

  if (result?.success !== false && !result?.blocked) {
    markSnapshotCompleted(normalizedResource, licenseKey);
  }

  devLog('deferred snapshot done', { resource: normalizedResource, status: result?.success === false ? 'failed' : 'ok' });
  return result;
};

const scheduleInitialPull = ({ reason = 'bootstrap_initial_pull', force = false } = {}) => {
  if (bootstrapState.initialPullStarted && !force) {
    devLog('pull skipped', { reason: 'already_started' });
    return { skipped: true, reason: 'already_started' };
  }

  bootstrapState.initialPullStarted = true;
  const delayMs = randomJitterMs();
  devLog('pull scheduled', { delayMs, reason });

  setTimer('initial_pull', () => {
    posSyncOrchestrator.schedulePullIncremental(reason, { debounceMs: 0 })
      .then(() => {
        bootstrapState.initialPullCompleted = true;
      })
      .catch((error) => {
        Logger.warn('[PosBootstrap] Pull incremental inicial diferido fallo:', error);
      });
  }, delayMs);

  return { scheduled: true, delayMs };
};

const scheduleOutbox = ({ reason = 'bootstrap_outbox', force = false } = {}) => {
  if (bootstrapState.outboxStarted && !force) {
    devLog('outbox skipped', { reason: 'already_started' });
    return { skipped: true, reason: 'already_started' };
  }

  bootstrapState.outboxStarted = true;
  const delayMs = randomJitterMs() + 250;
  devLog('outbox scheduled', { delayMs, reason });

  setTimer('outbox', () => {
    posSyncOrchestrator.processOutbox(reason).catch((error) => {
      Logger.warn('[PosBootstrap] Outbox inicial diferido fallo:', error);
    });
  }, delayMs);

  return { scheduled: true, delayMs };
};

const ensureProductsIfCacheMissing = async () => {
  if (await hasLocalProductCache()) {
    devLog('products snapshot skipped', { reason: 'local_cache_available' });
    return { skipped: true, reason: 'local_cache_available' };
  }

  return scheduleDeferredSnapshot({
    resource: POS_BOOTSTRAP_RESOURCES.PRODUCTS,
    reason: 'missing_local_product_cache',
    delayMs: POS_DEFERRED_SNAPSHOT_DELAY_MS.PRODUCTS
  });
};

const scheduleDemandSnapshot = (resource, options = {}) => {
  const normalizedResource = normalizeResource(resource);
  if (!normalizedResource) return { skipped: true, reason: 'invalid_resource' };

  if (normalizedResource === POS_BOOTSTRAP_RESOURCES.POS) {
    ensureProductsIfCacheMissing().catch((error) => {
      Logger.warn('[PosBootstrap] Warmup de productos para POS fallo:', error);
    });
    return { scheduled: false, reason: 'pos_uses_local_cache_first' };
  }

  if (normalizedResource === POS_BOOTSTRAP_RESOURCES.REPORTS) {
    scheduleDeferredSnapshot({
      resource: POS_BOOTSTRAP_RESOURCES.SALES,
      reason: options.reason || 'reports_module_demand',
      delayMs: POS_DEFERRED_SNAPSHOT_DELAY_MS.SALES,
      force: options.force === true
    });
    return { scheduled: true, resource: POS_BOOTSTRAP_RESOURCES.SALES };
  }

  return scheduleDeferredSnapshot({
    resource: normalizedResource,
    reason: options.reason || `module_demand_${normalizedResource}`,
    delayMs: RESOURCE_DELAY[normalizedResource] || POS_DEFERRED_SNAPSHOT_DELAY_MS.REPORTS,
    force: options.force === true
  });
};

export const startPosCloudBootstrap = async ({
  licenseDetails = null,
  licenseKey = null,
  reason = 'app_start',
  force = false
} = {}) => {
  attachRouteDemandListener();

  const context = getRuntimeContext({ licenseDetails, licenseKey });
  if (!context.cloudEnabled) {
    resetBootstrapState();
    await posSyncOrchestrator.stop({ preserveStatus: false });
    return { started: false, status: 'disabled', reason: 'cloud_pos_sync_off' };
  }

  const signature = buildBootstrapSignature(context);

  if (!force && bootstrapState.startPromise && bootstrapState.signature === signature) {
    devLog('skip duplicate', { reason: 'start_in_progress' });
    return bootstrapState.startPromise;
  }

  if (!force && bootstrapState.started && bootstrapState.signature === signature) {
    devLog('skip duplicate', { reason });
    emitRouteDemand();
    return { started: true, skipped: true, reason: 'already_started' };
  }

  if (bootstrapState.started && bootstrapState.signature && bootstrapState.signature !== signature) {
    devLog('license context changed; reset bootstrap state');
    resetBootstrapState();
    await posSyncOrchestrator.stop({ preserveStatus: true });
  }

  bootstrapState.started = true;
  bootstrapState.licenseKey = context.licenseKey;
  bootstrapState.signature = signature;
  bootstrapState.lastBootstrapAt = Date.now();
  bootstrapState.snapshotsDeferred = true;

  devLog('start', { reason });

  bootstrapState.startPromise = posSyncOrchestrator.start({
    licenseDetails: context.licenseDetails,
    reason
  }).then((result) => {
    bootstrapState.realtimeStarted = result?.started !== false;
    scheduleInitialPull({ reason: 'bootstrap_initial_pull', force });
    scheduleOutbox({ reason: 'bootstrap_outbox', force });
    emitRouteDemand();
    return result;
  }).finally(() => {
    bootstrapState.startPromise = null;
  });

  return bootstrapState.startPromise;
};

export const scheduleDeferredSnapshot = ({
  resource,
  reason = 'deferred_snapshot',
  delayMs = 0,
  force = false
} = {}) => {
  const normalizedResource = normalizeResource(resource);
  if (!normalizedResource) return { skipped: true, reason: 'invalid_resource' };

  const { licenseKey, cloudEnabled } = getRuntimeContext();
  if (!cloudEnabled || !licenseKey) return { skipped: true, reason: 'cloud_disabled' };

  if (shouldSkipCompletedSnapshot(normalizedResource, licenseKey, force)) {
    devLog('deferred snapshot skipped', { resource: normalizedResource, reason: 'already_completed' });
    return { skipped: true, reason: 'already_completed' };
  }

  const timerKey = `snapshot:${normalizedResource}`;
  if (bootstrapState.timers.has(timerKey) && !force) {
    devLog('deferred snapshot skipped', { resource: normalizedResource, reason: 'already_scheduled' });
    return { skipped: true, reason: 'already_scheduled' };
  }

  const resolvedDelayMs = Math.max(Number(delayMs) || 0, 0) + randomJitterMs();
  devLog('deferred snapshot scheduled', { resource: normalizedResource, delayMs: resolvedDelayMs, reason });

  setTimer(timerKey, () => {
    runDeferredSnapshot(normalizedResource, { reason, force }).catch((error) => {
      Logger.warn(`[PosBootstrap] Snapshot diferido ${normalizedResource} fallo:`, error);
    });
  }, resolvedDelayMs);

  return { scheduled: true, resource: normalizedResource, delayMs: resolvedDelayMs };
};

export const markModuleDemand = (resource, options = {}) => {
  const resources = normalizeResources(resource);
  if (resources.length === 0) return { skipped: true, reason: 'invalid_resource' };

  const { licenseDetails, licenseKey, cloudEnabled } = getRuntimeContext();
  if (!cloudEnabled || !licenseKey) return { skipped: true, reason: 'cloud_disabled' };

  for (const item of resources) {
    bootstrapState.moduleDemand.add(item);
    devLog('module demand', { resource: item, reason: options.reason || 'module_demand' });
  }

  startPosCloudBootstrap({
    licenseDetails,
    licenseKey,
    reason: options.reason || 'module_demand'
  }).then(() => {
    for (const item of resources) {
      scheduleDemandSnapshot(item, options);
    }
  }).catch((error) => {
    Logger.warn('[PosBootstrap] No se pudo procesar demanda de modulo:', error);
  });

  return { marked: true, resources };
};

export const markPosCloudModuleDemand = markModuleDemand;

export const stopPosCloudBootstrap = async ({ preserveSync = false } = {}) => {
  resetBootstrapState();
  if (!preserveSync) {
    await posSyncOrchestrator.stop({ preserveStatus: false });
  }
};

export const getPosCloudBootstrapState = () => ({
  started: bootstrapState.started,
  realtimeStarted: bootstrapState.realtimeStarted,
  initialPullStarted: bootstrapState.initialPullStarted,
  initialPullCompleted: bootstrapState.initialPullCompleted,
  outboxStarted: bootstrapState.outboxStarted,
  snapshotsDeferred: bootstrapState.snapshotsDeferred,
  lastBootstrapAt: bootstrapState.lastBootstrapAt,
  licenseKey: bootstrapState.licenseKey,
  moduleDemand: Array.from(bootstrapState.moduleDemand),
  completedSnapshots: Array.from(bootstrapState.completedSnapshots.keys()),
  pendingTimers: Array.from(bootstrapState.timers.keys())
});

export default {
  startPosCloudBootstrap,
  scheduleDeferredSnapshot,
  markModuleDemand,
  markPosCloudModuleDemand,
  stopPosCloudBootstrap,
  getPosCloudBootstrapState
};
