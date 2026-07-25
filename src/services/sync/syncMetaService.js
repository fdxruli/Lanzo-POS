import './syncDexieBootstrap';
import { db } from '../db/dexie';
import { ensureLocalDatabaseReady } from '../db/databaseRuntime';
import {
  isDatabaseRecoveryPending,
  isStructuralDatabaseError,
  reportStructuralDatabaseErrorOnce
} from '../db/databaseRecoveryState';
import Logger from '../Logger';
import { POS_SYNC_STORES, SYNC_META_KEYS, SYNC_STATUS } from './syncConstants';

const nowIso = () => new Date().toISOString();
const scopedKey = (key, licenseKey = null) => licenseKey ? `${licenseKey}:${key}` : key;
let recoveryPauseLogged = false;

const recoveryPaused = () => {
  if (!isDatabaseRecoveryPending()) return false;
  if (!recoveryPauseLogged) {
    recoveryPauseLogged = true;
    Logger.warn('[PosSync/Meta] Metadata pausada durante la recuperación local.');
  }
  return true;
};

const ensureOpen = async () => {
  if (recoveryPaused()) return false;
  await ensureLocalDatabaseReady();
  return db.isOpen();
};

const handleError = (error, operation) => {
  if (isStructuralDatabaseError(error)) {
    reportStructuralDatabaseErrorOnce(error, `pos-sync-meta:${operation}`);
    return false;
  }
  Logger.warn(`[PosSync/Meta] No se pudo ${operation} metadata:`, error);
  return false;
};

export const syncMetaService = {
  async getMeta(key, fallbackValue = null, { licenseKey = null } = {}) {
    if (recoveryPaused()) return fallbackValue;
    try {
      if (!await ensureOpen()) return fallbackValue;
      recoveryPauseLogged = false;
      const record = await db.table(POS_SYNC_STORES.META).get(scopedKey(key, licenseKey));
      return record?.value ?? fallbackValue;
    } catch (error) {
      handleError(error, 'leer');
      return fallbackValue;
    }
  },

  async setMeta(key, value, { licenseKey = null } = {}) {
    if (recoveryPaused()) return false;
    try {
      if (!await ensureOpen()) return false;
      recoveryPauseLogged = false;
      await db.table(POS_SYNC_STORES.META).put({
        key: scopedKey(key, licenseKey),
        value,
        updatedAt: nowIso()
      });
      return true;
    } catch (error) {
      return handleError(error, 'guardar');
    }
  },

  async getLastChangeSeq(licenseKey = null) {
    const value = await this.getMeta(SYNC_META_KEYS.LAST_CHANGE_SEQ, 0, { licenseKey });
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
  },

  async setLastChangeSeq(changeSeq, licenseKey = null) {
    const numericValue = Number(changeSeq);
    return this.setMeta(SYNC_META_KEYS.LAST_CHANGE_SEQ, Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0, { licenseKey });
  },

  getSyncEnabled(licenseKey = null) {
    return this.getMeta(SYNC_META_KEYS.SYNC_ENABLED, false, { licenseKey });
  },

  setSyncEnabled(enabled, licenseKey = null) {
    return this.setMeta(SYNC_META_KEYS.SYNC_ENABLED, Boolean(enabled), { licenseKey });
  },

  setRealtimeStatus(status = SYNC_STATUS.DISABLED, licenseKey = null) {
    return this.setMeta(SYNC_META_KEYS.REALTIME_STATUS, status, { licenseKey });
  },

  setLastPullAt(licenseKey = null, value = nowIso()) {
    return this.setMeta(SYNC_META_KEYS.LAST_PULL_AT, value, { licenseKey });
  },

  setLastFullPullAt(licenseKey = null, value = nowIso()) {
    return this.setMeta(SYNC_META_KEYS.LAST_FULL_PULL_AT, value, { licenseKey });
  },

  setLastPullError(error, licenseKey = null) {
    return this.setMeta(SYNC_META_KEYS.LAST_PULL_ERROR, error ? { message: error?.message || String(error), at: nowIso() } : null, { licenseKey });
  }
};

export default syncMetaService;
