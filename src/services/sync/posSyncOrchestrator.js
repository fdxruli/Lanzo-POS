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
  POS_SYNC_FOCUS_PULL_COOLDOWN_MS,
  POS_SYNC_REALTIME_PULL_DEBOUNCE_MS,
  shouldDeferPosBootstrapStartHook,
  SYNC_LIMITS,
  SYNC_STATUS
} from './syncConstants';

const entityHandlers = new Map();

const runtime = {
  started: false,
  startInProgress: false,
  licenseKey: null,
  status: SYNC_STATUS.DISABLED,
  pullInProgress: false,
  pendingPull: false,
  outboxInProgress: false,
  realtimePullScheduled: false,
  realtimePullTimer: null,
  lastPullReason: null,
  lastPullStartedAt: 0,
  lastPullFinishedAt: 0,
  lastForegroundPullAt: 0,
  realtimeChannel: null,
  realtimeTopic: null,
  onlineListener: null
};

const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

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

const clearRealtimePullTimer = () => {
  if (!runtime.realtimePullTimer) return;

  if (typeof window !== 'undefined') {
    window.clearTimeout(runtime.realtimePullTimer);
  } else {
    clearTimeout(runtime.realtimePullTimer);
  }

  runtime.realtimePullTimer = null;
  runtime.realtimePullScheduled = false;
};

const stopRealtimeChannel = async () => {
  await stopPosRealtimeListener(runtime.realtimeChannel);
  runtime.realtimeChannel = null;
  runtime.realtimeTopic = null;
};

const runEntityStartHooks = async ({ licenseDetails, licenseKey, reason }) => {
  for (const [entityType, handler] of entityHandlers.entries()) {
    if (!handler?.onStart) continue;

    try {
      await handler.onStart({ licenseDetails, licenseKey, reason });
    } catch (error) {
      Logger.warn(`[PosSync] Handler ${entityType} fallo en onStart:`, error);
    }
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
      await handler.onEvents(entityEvents, { licenseKey: runtime.licenseKey });
    } catch (error) {
      Logger.warn(`[PosSync] Handler ${entityType} fallo al consumir eventos:`, error);
    }
  }
};

const attachOnlineListener = () => {
  if (runtime.onlineListener || typeof window === 'undefined') return;

  runtime.onlineListener = async () => {
    Logger.log('[POS Sync] Procesando outbox online.');

    try {
      await posSyncOrchestrator.processOutbox('online');
    } catch (error) {
      Logger.warn('[PosSync] Outbox al reconectar fallo:', error);
    }

    posSyncOrchestrator.schedulePullIncremental('online').catch((error) => {
      Logger.warn('[PosSync] Pull al reconectar fallo:', error);
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

const shouldUseRealtimeDebounce = (reason = '') => String(reason || '').toLowerCase().includes('realtime');

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
    const posTopic = buildPosRealtimeTopic(licenseDetails);

    if (!licenseKey || !isCloudPosSyncEnabled(licenseDetails)) {
      await this.stop({ preserveStatus: false });
      runtime.licenseKey = licenseKey;
      await setRuntimeStatus(SYNC_STATUS.DISABLED, {
        licenseKey,
        reason: 'cloud_pos_sync_off'
      });

      return {
        started: false,
        status: SYNC_STATUS.DISABLED
      };
    }

    if (runtime.startInProgress) {
      Logger.log(`[PosSync] Start ya en curso; se omite ${reason}.`);

      return {
        started: runtime.started,
        status: runtime.status,
        skipped: true,
        reason: 'start_in_progress'
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

    runtime.startInProgress = true;

    try {
      if (runtime.started && (runtime.licenseKey !== licenseKey || runtime.realtimeTopic !== posTopic)) {
        await stopRealtimeChannel();
      }

      runtime.started = true;
      runtime.licenseKey = licenseKey;

      attachOnlineListener();
      await syncOutboxService.resetStuckProcessing(SYNC_LIMITS.STUCK_PROCESSING_MS);

      if (!isBrowserOnline()) {
        await setRuntimeStatus(SYNC_STATUS.OFFLINE, {
          licenseKey,
          reason: 'offline_on_start'
        });

        return {
          started: true,
          status: SYNC_STATUS.OFFLINE
        };
      }

      await setRuntimeStatus(SYNC_STATUS.ONLINE, { licenseKey, reason });
      await runEntityStartHooks({ licenseDetails, licenseKey, reason });

      if (shouldDeferPosBootstrapStartHook(reason)) {
        Logger.log('[PosSync] Pull/outbox inicial omitido: el bootstrap inteligente lo agenda con jitter.');
      } else {
        await this.pullIncremental('start');
        await this.processOutbox('start');
      }

      if (posTopic) {
        if (!runtime.realtimeChannel || runtime.realtimeTopic !== posTopic) {
          await stopRealtimeChannel();

          runtime.realtimeChannel = startPosRealtimeListener({
            posTopic,
            callbacks: {
              onPosChangeAvailable: ({ eventType, entity, changeSeq } = {}) => {
                Logger.log('[POS Sync] Realtime avisó cambios; programando pull incremental.', {
                  eventType,
                  entity,
                  changeSeq
                });

                this.schedulePullIncremental('realtime').catch((error) => {
                  Logger.warn('[PosSync] Pull por realtime fallo:', error);
                });
              },
              onStatusChange: ({ status, reason: statusReason }) => {
                setRuntimeStatus(status, {
                  licenseKey,
                  reason: statusReason
                }).catch(() => {});
              },
              onConnectionRestored: () => {
                this.schedulePullIncremental('realtime_restored').catch((error) => {
                  Logger.warn('[PosSync] Pull tras recuperar realtime fallo:', error);
                });
              }
            }
          });

          runtime.realtimeTopic = posTopic;
        }
      } else {
        await setRuntimeStatus(SYNC_STATUS.DEGRADED, {
          licenseKey,
          reason: 'missing_pos_topic'
        });
      }

      return {
        started: true,
        status: runtime.status
      };
    } finally {
      runtime.startInProgress = false;
    }
  },

  async stop({ preserveStatus = false } = {}) {
    clearRealtimePullTimer();
    await stopRealtimeChannel();

    runtime.started = false;
    runtime.startInProgress = false;
    runtime.pullInProgress = false;
    runtime.pendingPull = false;
    runtime.outboxInProgress = false;
    runtime.lastPullReason = null;
    detachOnlineListener();

    if (!preserveStatus) {
      await setRuntimeStatus(SYNC_STATUS.DISABLED, {
        licenseKey: runtime.licenseKey,
        reason: 'stopped'
      });
    }
  },

  async schedulePullIncremental(reason = 'manual', { debounceMs = null } = {}) {
    if (!runtime.started || !runtime.licenseKey) return null;

    const safeReason = String(reason || 'manual');
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
      runtime.realtimeChannel &&
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

    if (!isBrowserOnline()) {
      await setRuntimeStatus(SYNC_STATUS.OFFLINE, {
        licenseKey: runtime.licenseKey,
        reason: 'offline_pull_skip'
      });

      return null;
    }

    if (runtime.pullInProgress) {
      runtime.pendingPull = true;
      runtime.lastPullReason = reason;
      Logger.log('[POS Sync] Pull incremental omitido: ya hay uno en curso.');
      Logger.log('[POS Sync] Pull incremental pendiente; se ejecutará al terminar el actual.');
      return {
        skipped: true,
        reason: 'pull_in_progress_pending'
      };
    }

    runtime.pullInProgress = true;
    runtime.lastPullReason = reason;
    runtime.lastPullStartedAt = Date.now();

    try {
      let sinceChangeSeq = await syncMetaService.getLastChangeSeq(runtime.licenseKey);
      let latestResponse = null;
      let totalEvents = 0;
      let hasMore = true;

      while (hasMore) {
        const batchSinceChangeSeq = Number(sinceChangeSeq) || 0;
        const response = await posSyncClient.pullSyncEvents({
          licenseKey: runtime.licenseKey,
          sinceChangeSeq: batchSinceChangeSeq,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
        });

        latestResponse = response;

        if (!response.success) {
          const nextStatus = response.code === 'CLOUD_POS_SYNC_DISABLED'
            ? SYNC_STATUS.DISABLED
            : SYNC_STATUS.DEGRADED;

          await setRuntimeStatus(nextStatus, {
            licenseKey: runtime.licenseKey,
            reason: response.code || 'pull_not_success'
          });
          return response;
        }

        const pulledEvents = Array.isArray(response.events) ? response.events : [];
        totalEvents += pulledEvents.length;
        await dispatchPulledEvents(pulledEvents);

        const latestChangeSeq = Number(response.latestChangeSeq ?? batchSinceChangeSeq) || batchSinceChangeSeq;
        if (latestChangeSeq > batchSinceChangeSeq) {
          sinceChangeSeq = latestChangeSeq;
          await syncMetaService.setLastChangeSeq(latestChangeSeq, runtime.licenseKey);
        }

        hasMore = Boolean(response.hasMore);
        if (hasMore && latestChangeSeq <= batchSinceChangeSeq) {
          Logger.warn('[POS Sync] Pull incremental detenido: has_more sin avance de cursor.');
          hasMore = false;
        }
      }

      await syncMetaService.setLastPullAt(runtime.licenseKey);
      await syncMetaService.setLastPullError(null, runtime.licenseKey);

      await setRuntimeStatus(SYNC_STATUS.ONLINE, {
        licenseKey: runtime.licenseKey,
        reason: `pull_${reason}`
      });

      return {
        ...(latestResponse || { success: true, events: [] }),
        totalEvents,
        latestChangeSeq: Number(sinceChangeSeq) || 0
      };
    } catch (error) {
      Logger.warn('[PosSync] Pull incremental fallo:', error);
      await syncMetaService.setLastPullError(error, runtime.licenseKey);

      await setRuntimeStatus(SYNC_STATUS.DEGRADED, {
        licenseKey: runtime.licenseKey,
        reason: 'pull_error'
      });

      return null;
    } finally {
      runtime.pullInProgress = false;
      runtime.lastPullFinishedAt = Date.now();

      const pendingReason = runtime.pendingPull ? runtime.lastPullReason || 'pending' : null;
      runtime.pendingPull = false;

      if (pendingReason && runtime.started && runtime.licenseKey && isBrowserOnline()) {
        Logger.log('[POS Sync] Ejecutando pull incremental pendiente al terminar el actual.');
        await this.pullIncremental(`pending_after_${pendingReason}`);
      }
    }
  },

  async processOutbox(reason = 'manual') {
    if (!runtime.started || !runtime.licenseKey || !isBrowserOnline()) {
      return { processed: 0 };
    }

    if (runtime.outboxInProgress) {
      Logger.log(`[PosSync] Outbox ya en curso; se omite ${reason}.`);

      return {
        processed: 0,
        skipped: true,
        reason: 'outbox_in_progress'
      };
    }

    runtime.outboxInProgress = true;

    try {
      const pending = await syncOutboxService.getPendingOperations({
        licenseKey: runtime.licenseKey,
        limit: SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT
      });

      let processed = 0;

      for (const operation of pending) {
        const handler = entityHandlers.get(operation.entityType);

        if (!handler?.pushOperation) {
          // Fase 0: la cola queda lista, pero sin handlers funcionales aun.
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
    } finally {
      runtime.outboxInProgress = false;
    }
  },

  getStatus() {
    const { realtimePullTimer, ...safeRuntime } = runtime;
    return {
      ...safeRuntime,
      realtimePullScheduled: Boolean(realtimePullTimer) || runtime.realtimePullScheduled,
      handlers: Array.from(entityHandlers.keys())
    };
  }
};

export default posSyncOrchestrator;
