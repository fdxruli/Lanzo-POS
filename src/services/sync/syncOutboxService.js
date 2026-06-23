import './syncDexieBootstrap';
import Dexie from 'dexie';
import { db } from '../db/dexie';
import Logger from '../Logger';
import { generateIdempotencyKey } from './idempotency';
import { OUTBOX_STATUS, POS_SYNC_STORES, RETRY_CONFIG, SYNC_LIMITS } from './syncConstants';

const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) {
    await db.open();
  }
};

const computeRetryAt = (attempts = 0) => {
  const delay = Math.min(
    RETRY_CONFIG.MAX_DELAY_MS,
    RETRY_CONFIG.BASE_DELAY_MS * Math.pow(2, Math.max(0, attempts - 1))
  );

  return new Date(Date.now() + delay).toISOString();
};

export const syncOutboxService = {
  async enqueueOperation({
    licenseKey,
    entityType,
    operation,
    entityId,
    payload = null,
    idempotencyKey = null,
    metadata = null
  }) {
    await ensureOpen();

    const createdAt = nowIso();
    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({ entityType, operation, entityId });
    const row = {
      id: resolvedIdempotencyKey,
      licenseKey: licenseKey || null,
      entityType,
      operation,
      entityId: entityId || null,
      payload,
      status: OUTBOX_STATUS.PENDING,
      idempotencyKey: resolvedIdempotencyKey,
      attempts: 0,
      lastError: null,
      metadata,
      createdAt,
      updatedAt: createdAt,
      nextRetryAt: null
    };

    await db.table(POS_SYNC_STORES.OUTBOX).put(row);
    return row;
  },

  async markProcessing(id) {
    await ensureOpen();
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.PROCESSING,
      updatedAt: nowIso()
    });
  },

  async markSynced(id, result = null) {
    await ensureOpen();
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.SYNCED,
      result,
      lastError: null,
      updatedAt: nowIso(),
      syncedAt: nowIso()
    });
  },

  async markFailed(id, error, { retry = true } = {}) {
    await ensureOpen();
    const table = db.table(POS_SYNC_STORES.OUTBOX);
    const row = await table.get(id);
    const attempts = Number(row?.attempts || 0) + 1;
    const shouldRetry = retry && attempts < RETRY_CONFIG.MAX_ATTEMPTS;

    await table.update(id, {
      status: shouldRetry ? OUTBOX_STATUS.PENDING : OUTBOX_STATUS.FAILED,
      attempts,
      lastError: error?.message || String(error || 'Error desconocido'),
      nextRetryAt: shouldRetry ? computeRetryAt(attempts) : null,
      updatedAt: nowIso()
    });
  },

  async markConflict(id, conflictPayload = null) {
    await ensureOpen();
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.CONFLICT,
      conflictPayload,
      updatedAt: nowIso()
    });
  },

  async scheduleRetry(id, error = null) {
    return this.markFailed(id, error || new Error('Retry programado'), { retry: true });
  },

  async getPendingOperations({ limit = SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT, licenseKey = null } = {}) {
    await ensureOpen();
    const now = Date.now();

    return db.table(POS_SYNC_STORES.OUTBOX)
      .where('[status+createdAt]')
      .between([OUTBOX_STATUS.PENDING, Dexie.minKey], [OUTBOX_STATUS.PENDING, Dexie.maxKey])
      .filter((row) => {
        if (licenseKey && row.licenseKey && row.licenseKey !== licenseKey) return false;
        if (!row.nextRetryAt) return true;
        return Date.parse(row.nextRetryAt) <= now;
      })
      .limit(limit)
      .toArray();
  },

  async resetStuckProcessing(thresholdMs = SYNC_LIMITS.STUCK_PROCESSING_MS) {
    try {
      await ensureOpen();
      const threshold = Date.now() - thresholdMs;
      const rows = await db.table(POS_SYNC_STORES.OUTBOX)
        .where('status')
        .equals(OUTBOX_STATUS.PROCESSING)
        .filter((row) => Date.parse(row.updatedAt || row.createdAt || 0) < threshold)
        .toArray();

      await Promise.all(rows.map((row) => db.table(POS_SYNC_STORES.OUTBOX).update(row.id, {
        status: OUTBOX_STATUS.PENDING,
        updatedAt: nowIso(),
        lastError: 'Operación regresada a pending por timeout local.'
      })));

      return rows.length;
    } catch (error) {
      Logger.warn('[PosSync/Outbox] No se pudo resetear processing atorado:', error);
      return 0;
    }
  }
};

export default syncOutboxService;
