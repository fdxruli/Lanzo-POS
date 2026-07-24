import '../db/databaseRuntime';
import { db, STORES } from '../db/dexie';
import Logger from '../Logger';
import { POS_SYNC_STORES } from './syncConstants';
import { POS_SYNC_DEXIE_VERSION } from '../db/databaseSchema';

const hasTable = (tableName) => db.tables.some((table) => table.name === tableName);

const hasAllSyncStores = () => (
  hasTable(POS_SYNC_STORES.OUTBOX)
  && hasTable(POS_SYNC_STORES.META)
  && hasTable(POS_SYNC_STORES.CONFLICTS)
);

const hasSalesCloudIndexes = () => {
  try {
    const schema = db.table(STORES.SALES)?.schema;
    return Boolean(
      schema?.idxByName?.cloudSalesSyncStatus
      && schema?.idxByName?.cloudSaleId
      && schema?.idxByName?.sourceMode
    );
  } catch {
    return false;
  }
};

/**
 * Compatibilidad para consumidores históricos.
 *
 * El esquema ya no se registra aquí. databaseRuntime registra de forma
 * canónica v24 y v30 antes de cualquier db.open(), independientemente del
 * orden de imports. Esta función solo verifica el resultado declarado.
 */
export const ensurePosSyncDexieSchema = () => {
  const ready = hasAllSyncStores() && hasSalesCloudIndexes();
  if (!ready) {
    Logger.warn(
      `[PosSync/Dexie] El registro canónico v${POS_SYNC_DEXIE_VERSION} no está disponible todavía.`
    );
  }
  return ready;
};

export default ensurePosSyncDexieSchema;
