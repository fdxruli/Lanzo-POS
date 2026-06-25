import { db, STORES } from '../db/dexie';
import Logger from '../Logger';
import { POS_SYNC_STORES } from './syncConstants';

const POS_SYNC_DEXIE_VERSION = 24;
let posSyncSchemaRegistered = false;

const SALES_CLOUD_SCHEMA = [
  'id',
  'timestamp',
  'cash_session_id',
  'customerId',
  'fulfillmentStatus',
  'status',
  'orderType',
  'cloudSaleId',
  'cloudSalesSyncStatus',
  'cloudSalesLastSyncAt',
  'sourceMode',
  '[customerId+timestamp]',
  '[cash_session_id+timestamp]',
  '[sourceMode+timestamp]',
  '[cloudSalesSyncStatus+timestamp]'
].join(', ');

const hasTable = (tableName) => db.tables.some((table) => table.name === tableName);

const hasAllSyncStores = () => (
  hasTable(POS_SYNC_STORES.OUTBOX)
  && hasTable(POS_SYNC_STORES.META)
  && hasTable(POS_SYNC_STORES.CONFLICTS)
);

const hasSalesCloudIndexes = () => {
  try {
    const schema = db.table(STORES.SALES)?.schema;
    return Boolean(schema?.idxByName?.cloudSalesSyncStatus && schema?.idxByName?.cloudSaleId);
  } catch {
    return false;
  }
};

export const ensurePosSyncDexieSchema = () => {
  if (posSyncSchemaRegistered || (hasAllSyncStores() && hasSalesCloudIndexes())) {
    posSyncSchemaRegistered = true;
    return true;
  }

  if (db.isOpen()) {
    Logger.warn('[PosSync/Dexie] Base abierta; recarga la app para activar indices cloud de ventas si faltan.');
    return false;
  }

  db.version(POS_SYNC_DEXIE_VERSION).stores({
    [STORES.SALES]: SALES_CLOUD_SCHEMA,
    [POS_SYNC_STORES.OUTBOX]: 'id, status, entityType, createdAt, [status+createdAt], idempotencyKey',
    [POS_SYNC_STORES.META]: 'key',
    [POS_SYNC_STORES.CONFLICTS]: 'id, entityType, entityId, status, createdAt'
  });

  posSyncSchemaRegistered = true;
  Logger.log('[PosSync/Dexie] Schema POS Sync v24 registrado con indices shadow de ventas.');
  return true;
};

ensurePosSyncDexieSchema();
