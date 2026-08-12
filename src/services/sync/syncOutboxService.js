import './syncDexieBootstrap';
import Dexie from 'dexie';
import { db } from '../db/dexie';
import Logger from '../Logger';
import { generateIdempotencyKey } from './idempotency';
import { OUTBOX_STATUS, POS_SYNC_STORES, RETRY_CONFIG, SYNC_LIMITS } from './syncConstants';
import {
  assertLocalTenantSyncAccess,
  isLocalTenantAccessError,
  runWithLocalTenantSyncLease
} from '../tenant/localTenantGuard';
import {
  LOCAL_TENANT_ERROR_CODES,
  LocalTenantAccessError
} from '../tenant/localTenantPolicy';

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
    if (!licenseKey) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
        reason: 'outbox_license_missing'
      });
    }
    return runWithLocalTenantSyncLease(
      { license_key: licenseKey },
      { reason: 'outbox_enqueue' },
      async () => {
        await ensureOpen();

        const createdAt = nowIso();
        const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({ entityType, operation, entityId });
        const table = db.table(POS_SYNC_STORES.OUTBOX);
        const existing = await table.get(resolvedIdempotencyKey);

        if (existing) {
          if (existing.licenseKey !== licenseKey) {
            throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
              reason: existing.licenseKey ? 'outbox_tenant_mismatch' : 'outbox_tenant_missing'
            });
          }
          return existing;
        }

        const row = {
          id: resolvedIdempotencyKey,
          licenseKey,
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

        await table.put(row);
        return row;
      }
    );
  },

  async markProcessing(id, { licenseKey = null } = {}) {
    await ensureOpen();
    await assertOperationOwnership(id, licenseKey);
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.PROCESSING,
      updatedAt: nowIso()
    });
  },

  async markSynced(id, result = null, { licenseKey = null } = {}) {
    await ensureOpen();
    await assertOperationOwnership(id, licenseKey);
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.SYNCED,
      result,
      lastError: null,
      updatedAt: nowIso(),
      syncedAt: nowIso()
    });
  },

  async markFailed(id, error, { retry = true, licenseKey = null } = {}) {
    await ensureOpen();
    const table = db.table(POS_SYNC_STORES.OUTBOX);
    const row = await assertOperationOwnership(id, licenseKey);
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

  async markConflict(id, conflictPayload = null, { licenseKey = null } = {}) {
    await ensureOpen();
    await assertOperationOwnership(id, licenseKey);
    await db.table(POS_SYNC_STORES.OUTBOX).update(id, {
      status: OUTBOX_STATUS.CONFLICT,
      conflictPayload,
      updatedAt: nowIso()
    });
  },

  async scheduleRetry(id, error = null, { licenseKey = null } = {}) {
    return this.markFailed(id, error || new Error('Retry programado'), { retry: true, licenseKey });
  },

  async getPendingOperations({ limit = SYNC_LIMITS.DEFAULT_OUTBOX_LIMIT, licenseKey = null } = {}) {
    if (!licenseKey) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
        reason: 'outbox_license_missing'
      });
    }
    await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: 'outbox_read' });
    await ensureOpen();
    const now = Date.now();

    return db.table(POS_SYNC_STORES.OUTBOX)
      .where('[status+createdAt]')
      .between([OUTBOX_STATUS.PENDING, Dexie.minKey], [OUTBOX_STATUS.PENDING, Dexie.maxKey])
      .filter((row) => {
        // Fail closed: legacy unscoped rows remain untouched until an explicit
        // recovery/migration assigns their owner.
        if (licenseKey && row.licenseKey !== licenseKey) return false;
        if (!row.nextRetryAt) return true;
        return Date.parse(row.nextRetryAt) <= now;
      })
      .limit(limit)
      .toArray();
  },

  async resetStuckProcessing(
    thresholdMs = SYNC_LIMITS.STUCK_PROCESSING_MS,
    { licenseKey = null } = {}
  ) {
    if (!licenseKey) {
      throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
        reason: 'outbox_license_missing'
      });
    }
    await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: 'outbox_reset' });

    try {
      await ensureOpen();
      const threshold = Date.now() - thresholdMs;
      const rows = await db.table(POS_SYNC_STORES.OUTBOX)
        .where('status')
        .equals(OUTBOX_STATUS.PROCESSING)
        .filter((row) => (
          (!licenseKey || row.licenseKey === licenseKey) &&
          Date.parse(row.updatedAt || row.createdAt || 0) < threshold
        ))
        .toArray();

      await Promise.all(rows.map((row) => db.table(POS_SYNC_STORES.OUTBOX).update(row.id, {
        status: OUTBOX_STATUS.PENDING,
        updatedAt: nowIso(),
        lastError: 'Operación regresada a pending por timeout local.'
      })));

      return rows.length;
    } catch (error) {
      if (isLocalTenantAccessError(error)) throw error;
      Logger.warn('[PosSync/Outbox] No se pudo resetear processing atorado:', error);
      return 0;
    }
  }
};

const assertOperationOwnership = async (id, licenseKey) => {
  if (!licenseKey) {
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
      reason: 'outbox_license_missing'
    });
  }

  await assertLocalTenantSyncAccess({ license_key: licenseKey }, { reason: 'outbox_mutation' });
  const table = db.table(POS_SYNC_STORES.OUTBOX);
  const row = await table.get(id);
  if (!row || row.licenseKey !== licenseKey) {
    throw new LocalTenantAccessError(LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED, {
      reason: row?.licenseKey ? 'outbox_tenant_mismatch' : 'outbox_tenant_missing'
    });
  }
  return row;
};

export default syncOutboxService;
