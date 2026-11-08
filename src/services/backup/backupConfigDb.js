import Dexie from 'dexie';

const CONFIG_DB_NAME = 'LanzoBackupConfig';
const SETTINGS_KEY = 'primary';
const SESSION_KEY = 'backup-session-key';
const LEGACY_SETTINGS_KEY = SETTINGS_KEY;
const LEGACY_SESSION_KEY = SESSION_KEY;

const configDb = new Dexie(CONFIG_DB_NAME);
configDb.version(1).stores({
  settings: 'id'
});
configDb.version(2).stores({
  settings: 'id',
  secrets: 'id'
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
  lastRevision: null,
  lastTableCounts: null,
  lastCoverage: null,
  updatedAt: null
});

const encodeTenantKey = (tenantKey = 'primary') => (
  tenantKey === 'primary' ? 'primary' : `tenant:${encodeURIComponent(String(tenantKey))}`
);
const settingsIdFor = (tenantKey) => `${encodeTenantKey(tenantKey)}:settings`;
const sessionIdFor = (tenantKey) => `${encodeTenantKey(tenantKey)}:session-key`;
const defaultSettingsFor = (tenantKey) => ({
  ...DEFAULT_BACKUP_SETTINGS,
  id: tenantKey === 'primary' ? LEGACY_SETTINGS_KEY : settingsIdFor(tenantKey)
});

export async function getBackupSettings(tenantKey = 'primary') {
  const id = tenantKey === 'primary' ? LEGACY_SETTINGS_KEY : settingsIdFor(tenantKey);
  const stored = await configDb.settings.get(id);
  return { ...defaultSettingsFor(tenantKey), ...(stored || {}) };
}

export async function saveBackupSettings(patch, tenantKey = 'primary') {
  const current = await getBackupSettings(tenantKey);
  const next = {
    ...current,
    ...patch,
    id: tenantKey === 'primary' ? LEGACY_SETTINGS_KEY : settingsIdFor(tenantKey),
    updatedAt: new Date().toISOString()
  };
  await configDb.settings.put(next);
  return next;
}

export async function clearBackupSettings(tenantKey = 'primary') {
  const id = tenantKey === 'primary' ? LEGACY_SETTINGS_KEY : settingsIdFor(tenantKey);
  await configDb.settings.delete(id);
}

export async function getPersistedBackupKey(tenantKey = 'primary') {
  const id = tenantKey === 'primary' ? LEGACY_SESSION_KEY : sessionIdFor(tenantKey);
  return configDb.secrets.get(id);
}

export async function savePersistedBackupKey({ key, verifier, salt, iterations, sessionId }, tenantKey = 'primary') {
  const id = tenantKey === 'primary' ? LEGACY_SESSION_KEY : sessionIdFor(tenantKey);
  await configDb.secrets.put({
    id,
    key,
    verifier,
    salt,
    iterations,
    sessionId,
    updatedAt: new Date().toISOString()
  });
}

export async function clearPersistedBackupKey(tenantKey = 'primary') {
  const id = tenantKey === 'primary' ? LEGACY_SESSION_KEY : sessionIdFor(tenantKey);
  await configDb.secrets.delete(id);
}

export { CONFIG_DB_NAME };
