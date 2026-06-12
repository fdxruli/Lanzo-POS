import Dexie from 'dexie';

const CONFIG_DB_NAME = 'LanzoBackupConfig';
const SETTINGS_KEY = 'primary';

const configDb = new Dexie(CONFIG_DB_NAME);
configDb.version(1).stores({
  settings: 'id'
});

export const DEFAULT_BACKUP_SETTINGS = Object.freeze({
  id: SETTINGS_KEY,
  configured: false,
  directoryHandle: null,
  directoryName: '',
  salt: '',
  verifier: '',
  iterations: 600000,
  lastBackupAt: null,
  lastBackupFile: '',
  lastResult: 'never',
  lastError: '',
  cronBlocked: false,
  cronPending: false,
  lastMutationCount: 0,
  updatedAt: null
});

export async function getBackupSettings() {
  const stored = await configDb.settings.get(SETTINGS_KEY);
  return { ...DEFAULT_BACKUP_SETTINGS, ...(stored || {}) };
}

export async function saveBackupSettings(patch) {
  const current = await getBackupSettings();
  const next = {
    ...current,
    ...patch,
    id: SETTINGS_KEY,
    updatedAt: new Date().toISOString()
  };
  await configDb.settings.put(next);
  return next;
}

export async function clearBackupSettings() {
  await configDb.settings.delete(SETTINGS_KEY);
}

export { CONFIG_DB_NAME };
