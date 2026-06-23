import Logger from '../Logger';
import {
  buildPosRealtimeTopic,
  startPosRealtimeListener,
  stopPosRealtimeListener
} from '../posRealtime';
import { posSyncClient } from './posSyncClient';
import { syncMetaService } from './syncMetaService';
import { syncOutboxService } from './syncOutboxService';
import {
  getLicenseKeyFromDetails,
  isCloudPosSyncEnabled,
  SYNC_LIMITS,
  SYNC_STATUS
} from './syncConstants';

const entityHandlers = new Map();

const runtime = {
  started: false,
  licenseKey: null,
  status: SYNC_STATUS.DISABLED,
  pullInProgress: false,
  realtimeChannel: null,
  onlineListener: null
};

const setRuntimeStatus = async (status, { licenseKey = runtime.licenseKey, reason = null } = {}) => {
  runtime.status = status;
  await syncMetaService.setRealtimeStatus(status, licenseKey);

  if (status === SYNC_STATUS.DISABLED) {
    await syncMetaService.setSyncEnabled(false, licenseKey);
  } else {
    await syncMetaService.setSyncEnabled(true, licenseKey);
  }

  if (reason) {
    Logger.log(`[PosSync] Estado ${status}: ${reason}`);
  }
};

const dispatchPulledEvents = async (events = []) => {
  if (!Array.isArray(events) || events.length === 0) return;

  const grouped = events.reduce((acc, event) => {
    const key = event.entity_type || event.entityType || 'generic';
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(event);
    return acc;
  }, new Map());

  for (const [entityType, entityEvents] of grouped.entries()) {
    const handler = entityHandlers.get(entityType);
    if (!handler?.onEvents) continue;

    try {
      await handler.onEvents(entityEvents);
    } catch (error) {
      Logger.warn(`[PosSync] Handler ${entityType} fallo al consumir eventos:`, error);
    }
  }
};

const attachOnlineListener = () => {
  if (runtime.onlineListener || typeof window === 'undefined') return;

  runtime.onlineListener = () => {
    Logger.log('[PosSync] Red recuperada. Ejecutando pull incremental y outbox.');
    posSyncOrchestrator.pullIncremental('online').catch((error) => {
      Logger.warn('[PosSync] Pull al reconectar fallo:', error);
    });
    posSyncOrchestrator.processOutbox('online').catch((error) => {
      Logger.warn('[PosSync] Outbox al reconectar fallo:', error);
    });
  };

  window.addEventListener('online', runtime.onlineListener);
};

const detachOnlineListener = () => {
  if (runtime.onlineListener && typeof window !== 'undefined') {
    window.removeEventListener('online', runtime.onlineListener);
  }
  runtime.onlineListener = null;
};

export const posSyncOrchestrator = {
  registerEntitySyncHandler(entityType, handler) {
    if (!entityType || !handler) {
      throw new Error('ENTITY_SYNC_HANDLER_INVALID');
    }

    entityHandlers.set(entityType, handler);
    Logger.log(`[PosSync] Handler registrado para entidad: ${entityType}`);

    return () => {
      entityHandlers.delete(entityType);
    };
  },

  async start({ licenseDetails, reason = 'manual' } = {}) {
    const licenseKey = getLicenseKeyFromDetails(licenseDetails);

    if (!licenseKey || !isCloudPosSyncEnabled(licenseDetails)) {
      await this.stop({ preserveStatus: false });
      runtime.licenseKey = licenseKey;
      await setRuntimeStatus(SYNC_STATUS.DISABLED, { licenseKey, reason: 'cloud_pos_sync_off' });
      return { started: false, status: SYNC_STATUS.DISABLED };
    }

    runtime.started = true;
    runtime.licenseKey = licenseKey;

    attachOnlineListener();
    await syncOutboxService.resetStuckProcessing(SYNC_LIMITS.STUCK_PROCESSING_MS);

    if (!navigator.onLine) {
      await setRuntimeStatus(SYNC_STATUS.OFFLINE, { licenseKey, reason: 'offline_on_start' });
      return { started: true, status: SYNC_STATUS.OFFLINE };
    }

    await setRuntimeStatus(SYNC_STATUS.ONLINE, { licenseKey, reason });

    await this.pullIncremental('start');
    await this.processOutbox('start');

    const posTopic = buildPosRealtimeTopic(licenseDetails);
    if (posTopic) {
      runtime.realtimeChannel = startPosRealtimeListener({
        posTopic,
        callbacks: {
          onPosChangeAvailable: () => {
            this.pullIncremental('realtime').catch((error) => {
              Logger.warn('[PosSync] Pull por realtime fallo:', error);
            });
          },
          onStatusChange: ({ status, reason: statusReason }) => {
            setRuntimeStatus(status, { licenseKey, reason: statusReason }).catch(() => {});
          },
          onConnectionRestored: () => {
            this.pullIncremental('realtime_restored').catch((error) => {
              Logger.warn('[PosSync] Pull tras recuperar realtime fallo:', error);
            });
          }
        }
      });
    } else {
      await setRuntimeStatus(SYNC_STATUS.DEGRADED, { licenseKey, reason: 'missing_pos_topic' });
    }

    return { started: true, status: runtime.status };
  },

  async stop({ preserveStatus = false } = {}) {
    await stopPosRealtimeListener(runtime.realtimeChannel);
    runtime.realtimeChannel = null;
    runtime.started = false;
    detachOnlineListener();

    if (!preserveStatus) {
      await setRuntimeStatus(SYNC_STATUS.DISABLED, { licenseKey: runtime.licenseKey, reason: 'stopped' });
    }
  },

  async pullIncremental(reason = 'manual') {
    if (!runtime.started || !runtime.licenseKey) return null;

    if (!navigator.onLine) {
      await setRuntimeStatus(SYNC_STATUS.OFFLINE, { licenseKey: runtime.licenseKey, reason: 'offline_pull_skip' });
      return null;
    }

    if (runtime.pullInProgress) {
      Logger.log(`[PosSync] Pull ya en curso; se omite ${reason}.`);
      return null;
    }

    runtime.pullInProgress = true;

    try {
      const sinceChangeSeq = await syncMetaService.getLastChangeSeq(runtime.licenseKey);
      const response = await posSyncClient.pullSyncEvents({
        licenseKey: runtime.licenseKey,
        sinceChangeSeq,
        limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
      });

      if (!response.success) {
        const nextStatus = response.code === 'CLOUD_POS_SYNC_DISABLED'
          ? SYNC_STATUS.DISABLED
          : SYNC_STATUS.DEGRADED;
        await setRuntimeStatus(nextStatus, { licenseKey: runtime.licenseKey, reason: response.code || 'pull_not_success' });
        return response;
      }

      await dispatchPulledEvents(response.events);
      await syncMetaService.setLastChangeSeq(response.latestChangeSeq, runtime.licenseKey);
      await syncMetaService.setLastPullAt(runtime.licenseKey);
      await syncMetaService.setLastPullError(null, runtime.licenseKey);
      await setRuntimeStatus(SYNC_STATUS.ONLINE, { licenseKey: runtime.licenseKey, reason: `pull_${reason}` });

      return response;
    } catch (error) {
      Logger.warn('[PosSync] Pull incremental fallo:', error);
      await syncMetaService.setLastPullError(error, runtime.licenseKey);
      await setRuntimeStatus(SYNC_STATUS.DEGRADED, { licenseKey: runtime.licenseKey, reason: 'pull_error' });
      return null;
    } finally {
      runtime.pullInProgress = false;
    }
  },

  async processOutbox(reason = 'manual') {
    if (!runtime.started || !runtime.licenseKey || !navigator.onLine) return { processed: 0 };

    const pending = await syncOutboxService.getPendingOperations({
      licenseKey: runtime.licenseKey,
      limit: SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT
    });

    let processed = 0;

    for (const operation of pending) {
      const handler = entityHandlers.get(operation.entityType);

      if (!handler?.pushOperation) {
        // Fase 0: la cola queda lista, pero sin handlers funcionales aún.
        continue;
      }

      try {
        await syncOutboxService.markProcessing(operation.id);
        const result = await handler.pushOperation(operation);

        if (result?.conflict) {
          await syncOutboxService.markConflict(operation.id, result.conflict);
        } else {
          await syncOutboxService.markSynced(operation.id, result || null);
        }

        processed += 1;
      } catch (error) {
        Logger.warn(`[PosSync] Outbox ${operation.entityType}/${operation.operation} fallo (${reason}):`, error);
        await syncOutboxService.markFailed(operation.id, error, { retry: true });
      }
    }

    return { processed };
  },

  getStatus() {
    return { ...runtime, handlers: Array.from(entityHandlers.keys()) };
  }
};

export default posSyncOrchestrator;
