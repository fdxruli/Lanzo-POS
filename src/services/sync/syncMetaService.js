import './syncDexieBootstrap';
import { db } from '../db/dexie';
import Logger from '../Logger';
import { POS_SYNC_STORES, SYNC_META_KEYS, SYNC_STATUS } from './syncConstants';

const nowIso = () => new Date().toISOString();

const scopedKey = (key, licenseKey = null) => (
  licenseKey ? `${licenseKey}:${key}` : key
);

const ensureOpen = async () => {
  if (!db.isOpen()) {
    await db.open();
  }
};

export const syncMetaService = {
  async getMeta(key, fallbackValue = null, { licenseKey = null } = {}) {
    try {
      await ensureOpen();
      const record = await db.table(POS_SYNC_STORES.META).get(scopedKey(key, licenseKey));
      return record?.value ?? fallbackValue;
    } catch (error) {
      Logger.warn('[PosSync/Meta] No se pudo leer metadata:', key, error);
      return fallbackValue;
    }
  },

  async setMeta(key, value, { licenseKey = null } = {}) {
    try {
      await ensureOpen();
      await db.table(POS_SYNC_STORES.META).put({
        key: scopedKey(key, licenseKey),
        value,
        updatedAt: nowIso()
      });
      return true;
    } catch (error) {
      Logger.warn('[PosSync/Meta] No se pudo guardar metadata:', key, error);
      return false;
    }
  },

  async getLastChangeSeq(licenseKey = null) {
    const value = await this.getMeta(SYNC_META_KEYS.LAST_CHANGE_SEQ, 0, { licenseKey });
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
  },

  async setLastChangeSeq(changeSeq, licenseKey = null) {
    const numericValue = Number(changeSeq);
    return this.setMeta(
      SYNC_META_KEYS.LAST_CHANGE_SEQ,
      Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0,
      { licenseKey }
    );
  },

  async getSyncEnabled(licenseKey = null) {
    return this.getMeta(SYNC_META_KEYS.SYNC_ENABLED, false, { licenseKey });
  },

  async setSyncEnabled(enabled, licenseKey = null) {
    return this.setMeta(SYNC_META_KEYS.SYNC_ENABLED, Boolean(enabled), { licenseKey });
  },

  async setRealtimeStatus(status = SYNC_STATUS.DISABLED, licenseKey = null) {
    return this.setMeta(SYNC_META_KEYS.REALTIME_STATUS, status, { licenseKey });
  },

  async setLastPullAt(licenseKey = null, value = nowIso()) {
    return this.setMeta(SYNC_META_KEYS.LAST_PULL_AT, value, { licenseKey });
  },

  async setLastFullPullAt(licenseKey = null, value = nowIso()) {
    return this.setMeta(SYNC_META_KEYS.LAST_FULL_PULL_AT, value, { licenseKey });
  },

  async setLastPullError(error, licenseKey = null) {
    const payload = error
      ? { message: error?.message || String(error), at: nowIso() }
      : null;
    return this.setMeta(SYNC_META_KEYS.LAST_PULL_ERROR, payload, { licenseKey });
  }
};

export default syncMetaService;
