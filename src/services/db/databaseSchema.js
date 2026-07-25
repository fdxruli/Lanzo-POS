import { POS_SYNC_STORES } from '../sync/syncConstants';

export const DEXIE_NATIVE_VERSION_MULTIPLIER = 10;
export const LEGACY_NATIVE_DATABASE_VERSION = 110;
export const POS_SYNC_DEXIE_VERSION = 24;
export const PRIMARY_KEY_RECOVERY_DEXIE_VERSION = 30;
export const CURRENT_NATIVE_DATABASE_VERSION =
  PRIMARY_KEY_RECOVERY_DEXIE_VERSION * DEXIE_NATIVE_VERSION_MULTIPLIER;

export const RECOVERY_STORES = Object.freeze({
  SALES_BACKUP: '__lanzo_sales_backup_v30',
  DELETED_SALES_BACKUP: '__lanzo_deleted_sales_backup_v30',
  META: '__lanzo_db_recovery'
});

export const SALES_CLOUD_SCHEMA = [
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

export const DELETED_SALES_SCHEMA = [
  'id',
  'deletedAt',
  'cash_session_id',
  '[cash_session_id+deletedAt]'
].join(', ');

export const SYNC_OUTBOX_SCHEMA =
  'id, status, entityType, createdAt, [status+createdAt], idempotencyKey';
export const SYNC_META_SCHEMA = 'key';
export const SYNC_CONFLICTS_SCHEMA = 'id, entityType, entityId, status, createdAt';
export const RECOVERY_BACKUP_SCHEMA = 'legacyKey, sourceKey, migratedId';
export const RECOVERY_META_SCHEMA = 'key';

const registeredDatabases = new WeakSet();

/**
 * Registra todas las versiones posteriores al esquema histórico de dexie.js.
 * Esta función debe ejecutarse inmediatamente después de construir el singleton,
 * antes de cualquier db.open(). ESM garantiza que se ejecute una sola vez.
 */
export const registerCanonicalDexieExtensions = (db, stores) => {
  if (registeredDatabases.has(db)) return db;

  db.version(POS_SYNC_DEXIE_VERSION).stores({
    [stores.SALES]: SALES_CLOUD_SCHEMA,
    [POS_SYNC_STORES.OUTBOX]: SYNC_OUTBOX_SCHEMA,
    [POS_SYNC_STORES.META]: SYNC_META_SCHEMA,
    [POS_SYNC_STORES.CONFLICTS]: SYNC_CONFLICTS_SCHEMA
  });

  db.version(PRIMARY_KEY_RECOVERY_DEXIE_VERSION).stores({
    [stores.SALES]: SALES_CLOUD_SCHEMA,
    [stores.DELETED_SALES]: DELETED_SALES_SCHEMA,
    [POS_SYNC_STORES.OUTBOX]: SYNC_OUTBOX_SCHEMA,
    [POS_SYNC_STORES.META]: SYNC_META_SCHEMA,
    [POS_SYNC_STORES.CONFLICTS]: SYNC_CONFLICTS_SCHEMA,
    [RECOVERY_STORES.SALES_BACKUP]: RECOVERY_BACKUP_SCHEMA,
    [RECOVERY_STORES.DELETED_SALES_BACKUP]: RECOVERY_BACKUP_SCHEMA,
    [RECOVERY_STORES.META]: RECOVERY_META_SCHEMA
  });

  registeredDatabases.add(db);
  return db;
};

export const EXPECTED_PRIMARY_KEYS = Object.freeze({
  sales: 'id',
  deleted_sales: 'id'
});

const index = (name, keyPath = name, options = {}) => ({
  name,
  keyPath,
  unique: options.unique === true,
  multiEntry: options.multiEntry === true
});

export const NATIVE_CURRENT_STORE_DEFINITIONS = Object.freeze({
  sales: {
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      index('timestamp'),
      index('cash_session_id'),
      index('customerId'),
      index('fulfillmentStatus'),
      index('status'),
      index('orderType'),
      index('cloudSaleId'),
      index('cloudSalesSyncStatus'),
      index('cloudSalesLastSyncAt'),
      index('sourceMode'),
      index('[customerId+timestamp]', ['customerId', 'timestamp']),
      index('[cash_session_id+timestamp]', ['cash_session_id', 'timestamp']),
      index('[sourceMode+timestamp]', ['sourceMode', 'timestamp']),
      index('[cloudSalesSyncStatus+timestamp]', ['cloudSalesSyncStatus', 'timestamp'])
    ]
  },
  deleted_sales: {
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      index('deletedAt'),
      index('cash_session_id'),
      index('[cash_session_id+deletedAt]', ['cash_session_id', 'deletedAt'])
    ]
  }
});

export const describeDexieNativeVersion = (dexieVersion) => ({
  dexieVersion,
  nativeVersion: dexieVersion * DEXIE_NATIVE_VERSION_MULTIPLIER
});
