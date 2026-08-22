import { POS_SYNC_STORES } from '../sync/syncConstants';
import { LOCAL_TENANT_BINDING_STORE } from '../tenant/localTenantPolicy';

export const DEXIE_NATIVE_VERSION_MULTIPLIER = 10;
export const LEGACY_NATIVE_DATABASE_VERSION = 110;
export const POS_SYNC_DEXIE_VERSION = 24;
export const PRIMARY_KEY_RECOVERY_DEXIE_VERSION = 30;
export const LOCAL_TENANT_BINDING_DEXIE_VERSION = 31;
export const CASH_FINANCIAL_DEXIE_VERSION = 32;
// `financial_intents` was introduced after v32 had already shipped. Keep its
// declaration in a new, monotonic version so existing tenant databases do not
// trigger Dexie's schema-patch fallback at native version 320.
export const FINANCIAL_INTENT_DEXIE_VERSION = 33;
export const CURRENT_NATIVE_DATABASE_VERSION =
  FINANCIAL_INTENT_DEXIE_VERSION * DEXIE_NATIVE_VERSION_MULTIPLIER;

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
export const LOCAL_TENANT_BINDING_SCHEMA = 'key';
export const CASH_SESSIONS_SCHEMA = [
  'id',
  'estado',
  'fecha_apertura',
  'actorKey',
  'cashStationId',
  '[cashStationId+estado]',
  '[actorKey+estado]'
].join(', ');
export const CASH_MOVEMENTS_SCHEMA = [
  'id',
  'caja_id',
  'cash_session_id',
  'fecha',
  'actorKey',
  'cashStationId',
  'idempotencyKey',
  '[cash_session_id+fecha]',
  '[cashStationId+fecha]'
].join(', ');
export const FINANCIAL_INTENT_SCHEMA = [
  'id',
  '&idempotencyKey',
  'status',
  'operationType',
  'createdAt',
  'updatedAt',
  'originActorKey',
  'cashSessionId',
  '[status+updatedAt]',
  '[originActorKey+status]'
].join(', ');

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

  // Forward-only metadata addition. Binding is intentionally not backfilled in
  // the upgrade: legacy ownership is resolved later by LocalTenantGuard using
  // authenticated context plus durable evidence already inside the database.
  db.version(LOCAL_TENANT_BINDING_DEXIE_VERSION).stores({
    [LOCAL_TENANT_BINDING_STORE]: LOCAL_TENANT_BINDING_SCHEMA
  });

  // Forward-only cash identity metadata.  The upgrade is deliberately
  // additive: records without deterministic device/session evidence remain
  // legacy_unresolved and are never assigned an invented station.
  const cashFinancialStores = {};
  if (stores.CAJAS) cashFinancialStores[stores.CAJAS] = CASH_SESSIONS_SCHEMA;
  if (stores.MOVIMIENTOS_CAJA) cashFinancialStores[stores.MOVIMIENTOS_CAJA] = CASH_MOVEMENTS_SCHEMA;
  if (stores.SALES) cashFinancialStores[stores.SALES] = SALES_CLOUD_SCHEMA;
  if (stores.DELETED_SALES) cashFinancialStores[stores.DELETED_SALES] = DELETED_SALES_SCHEMA;

  const cashFinancialVersion = db.version(CASH_FINANCIAL_DEXIE_VERSION).stores(cashFinancialStores);
  if (stores.CAJAS && stores.MOVIMIENTOS_CAJA) {
    cashFinancialVersion.upgrade(async (tx) => {
      const sessionsTable = tx.table(stores.CAJAS);
      const movementsTable = tx.table(stores.MOVIMIENTOS_CAJA);
      const sessions = await sessionsTable.toArray();
      const sessionsById = new Map(sessions.map((session) => [session.id, session]));

      const localStationFromDevice = (record) => {
        const deviceId = record?.deviceId || record?.device_id || record?.openedByDeviceId || record?.opened_by_device_id;
        return deviceId ? `local:device:${deviceId}` : null;
      };

      for (const session of sessions) {
        const next = { ...session };
        if (!next.originActorKey && !next.openedByActorKey && next.actorKey) {
          next.originActorKey = next.actorKey;
          next.openedByActorKey = next.actorKey;
        }
        if (!next.cashStationId) {
          const stationId = localStationFromDevice(next);
          if (stationId) {
            next.cashStationId = stationId;
            next.cashIdentityState = next.cashIdentityState || 'deterministic-device-bound';
          } else {
            next.cashIdentityState = next.cashIdentityState || 'legacy_unresolved';
          }
        }
        if (JSON.stringify(next) !== JSON.stringify(session)) await sessionsTable.put(next);
        sessionsById.set(next.id, next);
      }

      const movements = await movementsTable.toArray();
      for (const movement of movements) {
        const next = { ...movement };
        const session = sessionsById.get(next.cash_session_id || next.caja_id);
        if (!next.originActorKey && (next.actorKey || session?.actorKey)) {
          next.originActorKey = next.actorKey || session.actorKey;
        }
        if (!next.cashStationId && session?.cashStationId) next.cashStationId = session.cashStationId;
        if (!next.cashStationId && !session?.cashStationId) next.cashIdentityState = 'legacy_unresolved';
        if (JSON.stringify(next) !== JSON.stringify(movement)) await movementsTable.put(next);
      }
    });
  }

  // The durable financial-intent ledger was added after the released v32
  // schema. It must never be declared in historical v24: Dexie would then
  // patch an existing native-320 database to 321 without advancing the
  // canonical version, and the next structural preflight would reject it.
  if (stores.FINANCIAL_INTENTS) {
    db.version(FINANCIAL_INTENT_DEXIE_VERSION).stores({
      [stores.FINANCIAL_INTENTS]: FINANCIAL_INTENT_SCHEMA
    });
  }

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
  cajas: {
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      index('estado'),
      index('fecha_apertura'),
      index('actorKey'),
      index('cashStationId'),
      index('cashIdentityState'),
      index('[cashStationId+estado]', ['cashStationId', 'estado']),
      index('[actorKey+estado]', ['actorKey', 'estado'])
    ]
  },
  movimientos_caja: {
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      index('caja_id'),
      index('cash_session_id'),
      index('fecha'),
      index('actorKey'),
      index('cashStationId'),
      index('idempotencyKey'),
      index('[cash_session_id+fecha]', ['cash_session_id', 'fecha']),
      index('[cashStationId+fecha]', ['cashStationId', 'fecha'])
    ]
  },
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
