import './syncDexieBootstrap';
import { db } from '../db/dexie';
import Logger from '../Logger';
import { CONFLICT_STATUS, POS_SYNC_STORES } from './syncConstants';

const nowIso = () => new Date().toISOString();

const ensureOpen = async () => {
  if (!db.isOpen()) {
    await db.open();
  }
};

export const syncConflictService = {
  async saveConflict({
    id = null,
    entityType,
    entityId,
    conflictType,
    localPayload = null,
    serverPayload = null,
    status = CONFLICT_STATUS.PENDING,
    metadata = null
  }) {
    await ensureOpen();

    const conflict = {
      id: id || `conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      entityType,
      entityId,
      conflictType,
      localPayload,
      serverPayload,
      status,
      metadata,
      createdAt: nowIso(),
      resolvedAt: null
    };

    await db.table(POS_SYNC_STORES.CONFLICTS).put(conflict);
    return conflict;
  },

  async getPendingConflicts({ entityType = null, limit = 100 } = {}) {
    await ensureOpen();

    return db.table(POS_SYNC_STORES.CONFLICTS)
      .where('status')
      .equals(CONFLICT_STATUS.PENDING)
      .filter((row) => !entityType || row.entityType === entityType)
      .limit(limit)
      .toArray();
  },

  async markResolved(id, resolvedPayload = null) {
    await ensureOpen();
    await db.table(POS_SYNC_STORES.CONFLICTS).update(id, {
      status: CONFLICT_STATUS.RESOLVED,
      resolvedPayload,
      resolvedAt: nowIso()
    });
  },

  async markIgnored(id, reason = null) {
    await ensureOpen();
    await db.table(POS_SYNC_STORES.CONFLICTS).update(id, {
      status: CONFLICT_STATUS.IGNORED,
      ignoredReason: reason,
      resolvedAt: nowIso()
    });
  },

  async importServerConflict(serverConflict) {
    try {
      return this.saveConflict({
        id: serverConflict?.id,
        entityType: serverConflict?.entity_type || serverConflict?.entityType,
        entityId: serverConflict?.entity_id || serverConflict?.entityId,
        conflictType: serverConflict?.conflict_type || serverConflict?.conflictType || 'server_conflict',
        localPayload: serverConflict?.local_payload || serverConflict?.localPayload || null,
        serverPayload: serverConflict?.server_payload || serverConflict?.serverPayload || null,
        status: serverConflict?.resolution_status || serverConflict?.status || CONFLICT_STATUS.PENDING,
        metadata: { source: 'server' }
      });
    } catch (error) {
      Logger.warn('[PosSync/Conflicts] No se pudo importar conflicto del servidor:', error);
      return null;
    }
  }
};

export default syncConflictService;
