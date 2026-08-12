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
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError,
  runWithLocalTenantSyncLease
} from '../tenant/localTenantGuard';

const entityHandlers = new Map();

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
  lastPullReason: null,
  lastPullStartedAt: 0,
  lastPullFinishedAt: 0,
  lastForegroundPullAt: 0,
  realtimeChannel: null,
  realtimeTopic: null,
  onlineListener: null
};

const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const isRuntimeGenerationCurrent = (generation, licenseKey = runtime.licenseKey) => (
  runtime.generation === generation && runtime.licenseKey === licenseKey
);

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
    if (reason) Logger.log(`[PosSync] Estado ${status}: ${reason}`);
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
    Logger.log(`[PosSync] Estado ${status}: ${reason}`);
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

  if (typeof window !== 'undefined') {
    window.clearTimeout(runtime.realtimePullTimer);
  } else {
    clearTimeout(runtime.realtimePullTimer);
  }

  runtime.realtimePullTimer = null;
  runtime.realtimePullScheduled = false;
};

const stopRealtimeChannel = async () => {
  const channelToStop = runtime.realtimeChannel;
  runtime.realtimeChannel = null;
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
      await runWithLocalTenantSyncLease(
        { license_key: licenseKey },
        { reason: `pos_sync_start_handler_${entityType}` },
        () => handler.onStart({ licenseDetails, licenseKey, reason })
      );
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn(`[PosSync] Handler ${entityType} fallo en onStart:`, error);
    }
  }
};

const dispatchPulledEvents = async (events = [], licenseKey = runtime.licenseKey) => {
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
      await runWithLocalTenantSyncLease(
        { license_key: licenseKey },
        { reason: `pos_sync_event_handler_${entityType}` },
        () => handler.onEvents(entityEvents, { licenseKey })
      );
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
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

    if (runtime.startInProgress) {
      Logger.log(`[PosSync] Start ya en curso; se omite ${reason}.`);

      return {
        started: runtime.started,
        status: runtime.status,
        skipped: true,
        reason: 'start_in_progress'
      };
    }

    runtime.startInProgress = true;
    const startAttempt = ++runtime.startAttempt;
    let startGeneration = null;

    try {
      if (licenseKey) {
        await assertLocalTenantSyncAccess(licenseDetails, { reason: `pos_sync_start_${reason}` });
        if (runtime.startAttempt !== startAttempt || !runtime.startInProgress) {
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
      if (runtime.started && (runtime.licenseKey !== licenseKey || runtime.realtimeTopic !== posTopic)) {
        await stopRealtimeChannel();
        if (runtime.generation !== startGeneration) return { started: false, status: runtime.status };
      }

      runtime.started = true;
      runtime.licenseKey = licenseKey;

      attachOnlineListener();
      await syncOutboxService.resetStuckProcessing(
        SYNC_LIMITS.STUCK_PROCESSING_MS,
        { licenseKey }
      );
      if (!isRuntimeGenerationCurrent(startGeneration, licenseKey)) return { started: false, status: runtime.status };

      if (!isBrowserOnline()) {
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

      await setRuntimeStatus(SYNC_STATUS.ONLINE, { licenseKey, reason, generation: startGeneration });
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

          runtime.realtimeChannel = startPosRealtimeListener({
            posTopic,
            callbacks: {
              onPosChangeAvailable: ({ eventType, entity, changeSeq } = {}) => {
                if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) return;
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
                if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) return;
                setRuntimeStatus(status, {
                  licenseKey,
                  generation: startGeneration,
                  reason: statusReason
                }).catch((error) => {
                  Logger.warn('[PosSync] Cambio de estado realtime bloqueado:', error);
                });
              },
              onConnectionRestored: () => {
                if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) return;
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
          generation: startGeneration,
          reason: 'missing_pos_topic'
        });
        if (!isRuntimeGenerationCurrent(startGeneration, licenseKey) || !runtime.started) {
          return { started: false, status: runtime.status, stale: true };
        }
      }

      return {
        started: true,
        status: runtime.status
      };
    } catch (error) {
      if (startGeneration !== null && isRuntimeGenerationCurrent(startGeneration, licenseKey)) {
        clearRealtimePullTimer();
        runtime.started = false;
        runtime.pullInProgress = false;
        runtime.pendingPull = false;
        runtime.outboxInProgress = false;
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
      if (runtime.startAttempt === startAttempt) runtime.startInProgress = false;
    }
  },

  async stop({ preserveStatus = false } = {}) {
    runtime.startAttempt += 1;
    const stopGeneration = ++runtime.generation;
    clearRealtimePullTimer();
    runtime.started = false;
    runtime.startInProgress = false;
    runtime.pullInProgress = false;
    runtime.pendingPull = false;
    runtime.outboxInProgress = false;
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
    const operationLicenseKey = runtime.licenseKey;
    const operationGeneration = runtime.generation;

    await assertLocalTenantSyncAccess(
      { license_key: operationLicenseKey },
      { reason: `pos_sync_pull_${reason}` }
    );
    if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
      return null;
    }

    if (!isBrowserOnline()) {
      await setRuntimeStatus(SYNC_STATUS.OFFLINE, {
        licenseKey: operationLicenseKey,
        generation: operationGeneration,
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
      let sinceChangeSeq = await syncMetaService.getLastChangeSeq(operationLicenseKey);
      if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
        return null;
      }
      let latestResponse = null;
      let totalEvents = 0;
      let hasMore = true;

      while (hasMore) {
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_rpc_${reason}` }
        );
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }
        const batchSinceChangeSeq = Number(sinceChangeSeq) || 0;
        const response = await posSyncClient.pullSyncEvents({
          licenseKey: operationLicenseKey,
          sinceChangeSeq: batchSinceChangeSeq,
          limit: SYNC_LIMITS.DEFAULT_PULL_LIMIT
        });

        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }

        latestResponse = response;

        if (!response.success) {
          const nextStatus = response.code === 'CLOUD_POS_SYNC_DISABLED'
            ? SYNC_STATUS.DISABLED
            : SYNC_STATUS.DEGRADED;

          await setRuntimeStatus(nextStatus, {
            licenseKey: operationLicenseKey,
            generation: operationGeneration,
            reason: response.code || 'pull_not_success'
          });
          return response;
        }

        const pulledEvents = Array.isArray(response.events) ? response.events : [];
        totalEvents += pulledEvents.length;
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_apply_${reason}` }
        );
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }
        await dispatchPulledEvents(pulledEvents, operationLicenseKey);
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_pull_cursor_${reason}` }
        );
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return null;
        }

        const latestChangeSeq = Number(response.latestChangeSeq ?? batchSinceChangeSeq) || batchSinceChangeSeq;
        if (latestChangeSeq > batchSinceChangeSeq) {
          sinceChangeSeq = latestChangeSeq;
          await syncMetaService.setLastChangeSeq(latestChangeSeq, operationLicenseKey);
        }

        hasMore = Boolean(response.hasMore);
        if (hasMore && latestChangeSeq <= batchSinceChangeSeq) {
          Logger.warn('[POS Sync] Pull incremental detenido: has_more sin avance de cursor.');
          hasMore = false;
        }
      }

      await assertLocalTenantSyncAccess(
        { license_key: operationLicenseKey },
        { reason: `pos_sync_pull_commit_${reason}` }
      );
      if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
        return null;
      }
      await syncMetaService.setLastPullAt(operationLicenseKey);
      await syncMetaService.setLastPullError(null, operationLicenseKey);

      await setRuntimeStatus(SYNC_STATUS.ONLINE, {
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
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[PosSync] Pull incremental fallo:', error);
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
        runtime.pullInProgress = false;
        runtime.lastPullFinishedAt = Date.now();

        const pendingReason = runtime.pendingPull ? runtime.lastPullReason || 'pending' : null;
        runtime.pendingPull = false;

        if (pendingReason && runtime.started && runtime.licenseKey && isBrowserOnline()) {
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
    const operationLicenseKey = runtime.licenseKey;
    const operationGeneration = runtime.generation;

    await assertLocalTenantSyncAccess(
      { license_key: operationLicenseKey },
      { reason: `pos_sync_outbox_${reason}` }
    );
    if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
      return { processed: 0, skipped: true, reason: 'runtime_changed' };
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
        licenseKey: operationLicenseKey,
        limit: SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT
      });
      if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
        return { processed: 0, skipped: true, reason: 'runtime_changed' };
      }

      let processed = 0;

      for (const operation of pending) {
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return { processed, skipped: true, reason: 'runtime_changed' };
        }
        await assertLocalTenantSyncAccess(
          { license_key: operationLicenseKey },
          { reason: `pos_sync_outbox_operation_${reason}` }
        );
        if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
          return { processed, skipped: true, reason: 'runtime_changed' };
        }
        const handler = entityHandlers.get(operation.entityType);

        if (!handler?.pushOperation) {
          // Fase 0: la cola queda lista, pero sin handlers funcionales aun.
          continue;
        }

        try {
          await syncOutboxService.markProcessing(operation.id, {
            licenseKey: operationLicenseKey
          });
          const result = await runWithLocalTenantSyncLease(
            { license_key: operationLicenseKey },
            { reason: `pos_sync_outbox_handler_${operation.entityType}` },
            () => handler.pushOperation(operation)
          );

          if (!isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey) || !runtime.started) {
            return { processed, skipped: true, reason: 'runtime_changed' };
          }

          if (result?.conflict) {
            await syncOutboxService.markConflict(operation.id, result.conflict, {
              licenseKey: operationLicenseKey
            });
          } else {
            await syncOutboxService.markSynced(operation.id, result || null, {
              licenseKey: operationLicenseKey
            });
          }

          processed += 1;
        } catch (error) {
          if (isLocalTenantAccessError(error)) throw error;
          Logger.warn(`[PosSync] Outbox ${operation.entityType}/${operation.operation} fallo (${reason}):`, error);
          await syncOutboxService.markFailed(operation.id, error, {
            retry: true,
            licenseKey: operationLicenseKey
          });
        }
      }

      return { processed };
    } finally {
      if (isRuntimeGenerationCurrent(operationGeneration, operationLicenseKey)) {
        runtime.outboxInProgress = false;
      }
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
