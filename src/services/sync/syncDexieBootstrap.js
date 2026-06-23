import { db } from '../db/dexie';
import Logger from '../Logger';
import { POS_SYNC_STORES } from './syncConstants';

let posSyncSchemaRegistered = false;

const hasTable = (tableName) => db.tables.some((table) => table.name === tableName);

const hasAllSyncStores = () => (
  hasTable(POS_SYNC_STORES.OUTBOX)
  && hasTable(POS_SYNC_STORES.META)
  && hasTable(POS_SYNC_STORES.CONFLICTS)
);

export const ensurePosSyncDexieSchema = () => {
  if (posSyncSchemaRegistered || hasAllSyncStores()) {
    posSyncSchemaRegistered = true;
    return true;
  }

  if (db.isOpen()) {
    Logger.warn(
      '[PosSync/Dexie] La base ya esta abierta; no se puede registrar schema POS Sync en caliente. ' +
      'Recarga la app si faltan stores de sync.'
    );
    return false;
  }

  db.version(23).stores({
    [POS_SYNC_STORES.OUTBOX]: 'id, status, entityType, createdAt, [status+createdAt], idempotencyKey',
    [POS_SYNC_STORES.META]: 'key',
    [POS_SYNC_STORES.CONFLICTS]: 'id, entityType, entityId, status, createdAt'
  });

  posSyncSchemaRegistered = true;
  Logger.log('[PosSync/Dexie] Schema POS Sync registrado: sync_outbox, sync_meta, sync_conflicts.');
  return true;
};

ensurePosSyncDexieSchema();
