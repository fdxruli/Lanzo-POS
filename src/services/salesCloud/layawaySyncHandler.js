import Logger from '../Logger';
import { useAppStore } from '../../store/useAppStore';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { layawayRepository } from '../db/layaways';
import { isLocalTenantAccessError } from '../tenant/localTenantGuard';
import { hasCurrentActorPermission } from '../sync/actorPermission';
import { posSyncOrchestrator } from '../sync/posSyncOrchestrator';
import { syncMetaService } from '../sync/syncMetaService';
import {
  getLicenseKeyFromDetails,
  isCloudLayawaysEnabled,
  shouldDeferPosBootstrapStartHook,
  SYNC_META_KEYS,
  SYNC_ENTITY_TYPES,
  SYNC_LIMITS
} from '../sync/syncConstants';
import { salesCloudRepository } from './salesCloudRepository';

const LAYAWAY_LAST_CHANGE_SEQ_KEY = SYNC_META_KEYS.LAYAWAY_LAST_CHANGE_SEQ;
const LAYAWAY_PULL_LIMIT = SYNC_LIMITS.MAX_PULL_LIMIT - 1;
const MAX_PAGES_PER_RUN = 10;
const LAYAWAY_EVENT_TYPES = new Set([
  SYNC_ENTITY_TYPES.LAYAWAY,
  SYNC_ENTITY_TYPES.LAYAWAY_PAYMENT,
  SYNC_ENTITY_TYPES.LAYAWAY_INVENTORY_RESERVATION,
  SYNC_ENTITY_TYPES.CASH_MOVEMENT,
  SYNC_ENTITY_TYPES.PRODUCT,
  SYNC_ENTITY_TYPES.PRODUCT_BATCH
]);
let registered = false;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getRuntimeLicenseKey = () => getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails);
const normalizeSeq = (value) => {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
};

const makeProtocolError = (code) => Object.assign(new Error(code), { code, retryable: false });
const makeRetryableError = (message) => Object.assign(new Error(message), { retryable: true });

const validatePage = (page, requestedSince) => {
  const arrayKeys = [
    'events', 'layaways', 'payments', 'inventory_reservations',
    'cash_movements', 'inventory_movements', 'deleted_ids'
  ];
  if (page?.success !== true || arrayKeys.some((key) => !Array.isArray(page?.[key]))) {
    throw makeProtocolError('CLOUD_LAYAWAY_PAGE_SHAPE_INVALID');
  }
  const since = normalizeSeq(page.since_change_seq);
  const latest = normalizeSeq(page.latest_change_seq);
  const safe = normalizeSeq(page.safe_change_seq);
  if (since !== requestedSince || latest === null || safe === null || latest < since) {
    throw makeProtocolError('CLOUD_LAYAWAY_PAGE_CURSOR_INVALID');
  }
  if (typeof page.has_more !== 'boolean' || typeof page.sync_deferred !== 'boolean') {
    throw makeProtocolError('CLOUD_LAYAWAY_PAGE_FLAGS_INVALID');
  }
  if (page.cursor_ahead_of_safe_frontier === true) {
    if (latest !== since || page.events.length || page.layaways.length
      || page.payments.length || page.inventory_reservations.length
      || page.cash_movements.length || page.inventory_movements.length || page.deleted_ids.length) {
      throw makeProtocolError('CLOUD_LAYAWAY_AHEAD_CURSOR_PAGE_INVALID');
    }
    return { since, latest, safe, cursorAhead: true };
  }
  if (latest > safe) throw makeProtocolError('CLOUD_LAYAWAY_PAGE_EXCEEDS_SAFE_FRONTIER');
  if (page.has_more && latest === since) {
    throw makeProtocolError('CLOUD_LAYAWAY_PAGE_MADE_NO_PROGRESS');
  }
  for (const event of page.events) {
    const seq = normalizeSeq(event?.change_seq);
    const type = event?.entity_type || event?.entityType;
    if (!seq || seq <= since || seq > latest || !LAYAWAY_EVENT_TYPES.has(type)) {
      throw makeProtocolError('CLOUD_LAYAWAY_EVENT_INVALID');
    }
  }
  return { since, latest, safe, cursorAhead: false };
};

const notifyLayawaysChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lanzo:layaway-sync-updated'));
};

const isEnabled = (licenseDetails) => isCloudLayawaysEnabled(licenseDetails || {});

const pullLayawayChanges = async ({ licenseKey, actorHandle } = {}) => {
  actorHandle.assertCurrent('pos');
  if (getRuntimeLicenseKey() !== licenseKey) return { skipped: true, reason: 'context_invalidated' };
  let cursor = normalizeSeq(await syncMetaService.getMeta(LAYAWAY_LAST_CHANGE_SEQ_KEY, 0, { licenseKey }));
  actorHandle.assertCurrent('pos');
  if (cursor === null) throw makeProtocolError('CLOUD_LAYAWAY_CHECKPOINT_INVALID');

  let pageCount = 0;
  let applied = 0;
  while (pageCount < MAX_PAGES_PER_RUN) {
    actorHandle.assertCurrent('pos');
    const page = await salesCloudRepository.pullLayawayChanges({
      licenseKey,
      sinceChangeSeq: cursor,
      limit: LAYAWAY_PULL_LIMIT,
      actorHandle
    });
    actorHandle.assertCurrent('pos');
    const metadata = validatePage(page, cursor);
    pageCount += 1;

    if (metadata.cursorAhead) {
      Logger.warn('[Layaways/Sync] Cursor por encima de la frontera segura; se conserva para recuperación.', {
        cursor, safeChangeSeq: metadata.safe
      });
      return { success: true, applied, pages: pageCount, syncDeferred: true, reason: 'cursor_ahead_of_safe_frontier' };
    }

    const projection = await layawayRepository.applyCloudChangesPage(page, { actorHandle });
    actorHandle.assertCurrent('pos');
    if (projection?.success !== true) throw makeProtocolError('CLOUD_LAYAWAY_PROJECTION_INCOMPLETE');
    applied += Number(projection.changedCount) || 0;
    if (projection.changedCount > 0) notifyLayawaysChanged();

    if (metadata.latest > cursor) {
      actorHandle.assertCurrent('pos');
      const advanced = await syncMetaService.advanceMeta(LAYAWAY_LAST_CHANGE_SEQ_KEY, metadata.latest, { licenseKey });
      actorHandle.assertCurrent('pos');
      if (!Number.isSafeInteger(Number(advanced)) || Number(advanced) < metadata.latest) {
        throw makeRetryableError('CLOUD_LAYAWAY_CHECKPOINT_PERSIST_FAILED');
      }
      cursor = Number(advanced);
    }

    if (page.sync_deferred) {
      return { success: true, applied, pages: pageCount, syncDeferred: true, reason: 'server_sync_deferred' };
    }
    if (!page.has_more) {
      return { success: true, applied, pages: pageCount, syncDeferred: false };
    }
    if (cursor === metadata.since) {
      throw makeProtocolError('CLOUD_LAYAWAY_PAGE_MADE_NO_PROGRESS');
    }
  }

  return {
    success: true,
    applied,
    pages: pageCount,
    syncDeferred: pageCount === MAX_PAGES_PER_RUN,
    reason: 'page_budget_reached'
  };
};

export const layawaySyncHandler = {
  actorPermission: 'pos',

  async onStart({ licenseDetails, licenseKey, reason = 'manual', force = false } = {}) {
    const details = licenseDetails || useAppStore.getState()?.licenseDetails || {};
    const resolvedLicenseKey = licenseKey || getLicenseKeyFromDetails(details);
    if (!resolvedLicenseKey || !isEnabled(details)) return { skipped: true };
    if (!isOnline()) return { skipped: true, reason: 'offline' };
    if (!hasCurrentActorPermission('pos')) return { skipped: true, reason: 'actor_permission_missing' };
    if (shouldDeferPosBootstrapStartHook(reason, { force })) {
      return { skipped: true, deferred: true, reason: 'bootstrap_deferred_snapshot' };
    }
    try {
      const actorHandle = actorRuntimeController.capture('pos');
      const result = await pullLayawayChanges({ licenseKey: resolvedLicenseKey, actorHandle });
      actorHandle.assertCurrent('pos');
      if (result?.syncDeferred === true) {
        const scheduled = await posSyncOrchestrator.deferEntityRead(SYNC_ENTITY_TYPES.LAYAWAY, {
          licenseKey: resolvedLicenseKey,
          reason: 'layaway_start_deferred'
        });
        actorHandle.assertCurrent('pos');
        if (!scheduled) throw makeRetryableError('CLOUD_LAYAWAY_DEFERRED_MARKER_PERSIST_FAILED');
      }
      return result;
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[Layaways/Sync] No se pudo recuperar el delta inicial:', error);
      return { success: false, error };
    }
  },

  async onEvents(events = [], { licenseKey: capturedLicenseKey = null, force = false } = {}) {
    const licenseKey = capturedLicenseKey || getRuntimeLicenseKey();
    const details = useAppStore.getState()?.licenseDetails || {};
    if (!licenseKey || licenseKey !== getRuntimeLicenseKey()) {
      return { applied: 0, skipped: true, reason: 'context_invalidated' };
    }
    if (!isEnabled(details)) return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    if (!isOnline()) return { applied: 0, skipped: true, reason: 'offline' };
    if (!hasCurrentActorPermission('pos')) return { applied: 0, skipped: true, reason: 'actor_permission_missing' };
    const hasLayawayEvent = events.some((event) => [
      SYNC_ENTITY_TYPES.LAYAWAY,
      SYNC_ENTITY_TYPES.LAYAWAY_PAYMENT,
      SYNC_ENTITY_TYPES.LAYAWAY_INVENTORY_RESERVATION
    ].includes(event?.entity_type || event?.entityType));
    if (events.length > 0 && !hasLayawayEvent && !force) {
      return { applied: 0, skipped: true, reason: 'module_not_applicable' };
    }
    const actorHandle = actorRuntimeController.capture('pos');
    return pullLayawayChanges({ licenseKey, actorHandle });
  }
};

export const registerLayawaySyncHandler = () => {
  if (registered) return false;
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.LAYAWAY, layawaySyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.LAYAWAY_PAYMENT, layawaySyncHandler);
  posSyncOrchestrator.registerEntitySyncHandler(SYNC_ENTITY_TYPES.LAYAWAY_INVENTORY_RESERVATION, layawaySyncHandler);
  registered = true;
  Logger.log('[Layaways/Sync] Handler incremental de apartados registrado.');
  return true;
};

registerLayawaySyncHandler();

export default layawaySyncHandler;
