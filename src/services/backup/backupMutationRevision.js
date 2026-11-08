import { BACKUP_TABLE_NAMES } from './backupScope';
import { isTenantWorkerDatabaseName } from '../tenant/localTenantPolicy';

export const BACKUP_REVISION_STORAGE_PREFIX = 'lanzo_backup_revision:v2:';

export const getBackupTenantKey = (databaseName) => {
  if (!isTenantWorkerDatabaseName(databaseName)) throw new Error('BACKUP_TENANT_DATABASE_INVALID');
  return databaseName.slice('LanzoDB_t_'.length);
};

export const getBackupRevisionStorageKey = (databaseName) => (
  `${BACKUP_REVISION_STORAGE_PREFIX}${getBackupTenantKey(databaseName)}`
);

export const readBackupMutationRevision = (databaseName, storage = null) => {
  try {
    const targetStorage = storage || globalThis.localStorage;
    return targetStorage?.getItem(getBackupRevisionStorageKey(databaseName)) || null;
  } catch {
    return null;
  }
};

export const markBackupDataChanged = (databaseName, {
  storage = null,
  cryptoProvider = globalThis.crypto
} = {}) => {
  let revision;
  try {
    const targetStorage = storage || globalThis.localStorage;
    if (!targetStorage) return false;
    if (typeof cryptoProvider?.randomUUID === 'function') {
      revision = cryptoProvider.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      cryptoProvider?.getRandomValues?.(bytes);
      if (bytes.every((value) => value === 0)) return false;
      revision = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    }
    targetStorage.setItem(getBackupRevisionStorageKey(databaseName), revision);
    return Boolean(revision);
  } catch {
    return false;
  }
};

const TRACKED_TABLES = new Set(BACKUP_TABLE_NAMES.filter((name) => name !== 'sequences'));

export const installBackupMutationTracking = (database) => {
  if (!isTenantWorkerDatabaseName(database?.name)) return () => {};

  const removers = [];
  for (const table of database.tables) {
    if (!TRACKED_TABLES.has(table.name)) continue;
    for (const operation of ['creating', 'updating', 'deleting']) {
      const hook = table.hook(operation);
      const handler = () => { markBackupDataChanged(database.name); };
      hook.subscribe(handler);
      removers.push(() => hook.unsubscribe(handler));
    }
  }

  return () => removers.forEach((remove) => remove());
};
