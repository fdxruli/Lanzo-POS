import Logger from './Logger';

const QUOTA_CRITICAL_THRESHOLD = 0.9;
const QUOTA_WARNING_THRESHOLD = 0.75;
const ESTIMATE_CACHE_TTL_MS = 30_000;

export const StorageState = Object.freeze({
  UNKNOWN: 'unknown',
  REQUESTING: 'requesting',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
  VOLATILE: 'volatile',
  PROMPT: 'prompt'
});

const emptyQuota = () => ({
  usage: 0,
  quota: 0,
  percentUsed: 0,
  isCritical: false,
  isWarning: false,
  error: false
});

class StorageManagerService {
  constructor() {
    this.persistenceState = StorageState.UNKNOWN;
    this.quotaUsage = emptyQuota();
    this.lastCheckTime = 0;
    this.estimateCache = null;
    this.listeners = new Set();
    this._initialized = false;
    this._initializePromise = null;
    this._requestPromise = null;
    this._requestAttempted = false;
    this.lastPersistenceError = null;
  }

  get storageApi() {
    return typeof navigator !== 'undefined' ? navigator.storage : null;
  }

  isSupported() {
    return Boolean(
      this.storageApi
      && typeof this.storageApi.persisted === 'function'
      && typeof this.storageApi.persist === 'function'
    );
  }

  canEstimate() {
    return Boolean(this.storageApi && typeof this.storageApi.estimate === 'function');
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify() {
    const snapshot = this.getState();
    this.listeners.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (error) {
        Logger.warn('[StorageManager] Listener falló:', error?.message || error);
      }
    });
  }

  _setPersistenceState(nextState) {
    this.persistenceState = nextState;
    this._notify();
    return nextState;
  }

  async isPersisted() {
    if (!this.isSupported()) {
      this._setPersistenceState(StorageState.UNSUPPORTED);
      return false;
    }

    try {
      const persisted = await this.storageApi.persisted();
      if (persisted) this._setPersistenceState(StorageState.GRANTED);
      return persisted === true;
    } catch (error) {
      this.lastPersistenceError = error?.message || String(error);
      this._setPersistenceState(StorageState.VOLATILE);
      Logger.warn('[StorageManager] No se pudo consultar persisted(); se continúa en modo best-effort.');
      return false;
    }
  }

  async checkPersistenceStatus() {
    if (!this.isSupported()) {
      this._setPersistenceState(StorageState.UNSUPPORTED);
      return StorageState.UNSUPPORTED;
    }

    if (await this.isPersisted()) return StorageState.GRANTED;

    try {
      const permissionsApi = typeof navigator !== 'undefined' ? navigator.permissions : null;
      const permission = typeof permissionsApi?.query === 'function'
        ? await permissionsApi.query({ name: 'persistent-storage' })
        : null;

      if (permission?.state === 'denied') {
        return this._setPersistenceState(StorageState.DENIED);
      }
      if (permission?.state === 'granted') {
        // persisted() es la autoridad efectiva. Si aún devuelve false, se trata
        // como best-effort y no como corrupción o cierre de IndexedDB.
        return this._setPersistenceState(StorageState.VOLATILE);
      }
      return this._setPersistenceState(StorageState.PROMPT);
    } catch {
      return this._setPersistenceState(StorageState.PROMPT);
    }
  }

  async requestPersistence() {
    if (this.persistenceState === StorageState.GRANTED) return true;
    if (!this.isSupported()) {
      this._setPersistenceState(StorageState.UNSUPPORTED);
      return false;
    }
    if (this.persistenceState === StorageState.DENIED || this._requestAttempted) {
      return false;
    }
    if (this._requestPromise) return this._requestPromise;

    this._requestAttempted = true;
    this._setPersistenceState(StorageState.REQUESTING);

    this._requestPromise = (async () => {
      try {
        const persisted = await this.storageApi.persist();
        if (persisted) {
          this._setPersistenceState(StorageState.GRANTED);
          Logger.info('[StorageManager] Persistencia concedida.');
          return true;
        }

        this._setPersistenceState(StorageState.DENIED);
        Logger.warn(
          '[StorageManager] Persistencia no concedida. IndexedDB puede seguir funcionando en modo best-effort; esto no bloquea login ni bootstrap.'
        );
        return false;
      } catch (error) {
        this.lastPersistenceError = error?.message || String(error);
        this._setPersistenceState(StorageState.VOLATILE);
        Logger.warn(
          '[StorageManager] La solicitud de persistencia falló. Se continúa en modo best-effort sin bloquear IndexedDB.'
        );
        return false;
      } finally {
        this._requestPromise = null;
      }
    })();

    return this._requestPromise;
  }

  async estimateQuota(forceRefresh = false) {
    if (
      !forceRefresh
      && this.estimateCache
      && Date.now() - this.lastCheckTime < ESTIMATE_CACHE_TTL_MS
    ) {
      return this.estimateCache;
    }

    if (!this.canEstimate()) {
      const unavailable = { ...emptyQuota(), error: true };
      this.quotaUsage = unavailable;
      return unavailable;
    }

    try {
      const estimate = await this.storageApi.estimate();
      const usage = Number(estimate?.usage || 0);
      const quota = Number(estimate?.quota || 0);
      const fractionUsed = quota > 0 ? usage / quota : 0;
      const percentUsed = Math.round(fractionUsed * 10_000) / 100;

      this.quotaUsage = {
        usage,
        quota,
        percentUsed,
        isCritical: fractionUsed >= QUOTA_CRITICAL_THRESHOLD,
        isWarning: fractionUsed >= QUOTA_WARNING_THRESHOLD && fractionUsed < QUOTA_CRITICAL_THRESHOLD,
        error: false
      };
      this.lastCheckTime = Date.now();
      this.estimateCache = this.quotaUsage;
      this._notify();
      return this.quotaUsage;
    } catch (error) {
      Logger.warn('[StorageManager] No se pudo estimar la cuota:', error?.message || error);
      const unavailable = { ...emptyQuota(), error: true };
      this.quotaUsage = unavailable;
      return unavailable;
    }
  }

  _generateRecommendation(status, quota) {
    const messages = [];
    if (status !== StorageState.GRANTED) {
      messages.push('Almacenamiento best-effort: conserva espacio libre y realiza respaldos periódicos.');
    }
    if (quota.isCritical) {
      messages.push(`Almacenamiento ${quota.percentUsed}% lleno: libera espacio de inmediato.`);
    } else if (quota.isWarning) {
      messages.push(`Almacenamiento ${quota.percentUsed}% lleno: considera liberar espacio.`);
    }
    return messages;
  }

  async validateBootConditions() {
    const quota = await this.estimateQuota();
    const isVolatile = this.persistenceState !== StorageState.GRANTED;
    return {
      canStart: true,
      isSafe: !isVolatile && !quota.isCritical,
      isVolatile,
      isCritical: quota.isCritical,
      isWarning: quota.isWarning,
      persistenceState: this.persistenceState,
      quota,
      recommendation: this._generateRecommendation(this.persistenceState, quota)
    };
  }

  async canProcessSale() {
    const quota = await this.estimateQuota(true);
    if (quota.error) return { allowed: true };
    if (quota.isCritical) {
      return {
        allowed: false,
        reason: `Almacenamiento crítico: ${quota.percentUsed}% utilizado. Libera espacio o realiza un respaldo antes de continuar.`,
        severity: 'critical'
      };
    }
    if (quota.isWarning) {
      return {
        allowed: true,
        reason: `Advertencia: ${quota.percentUsed}% de almacenamiento utilizado. Considera realizar un respaldo.`,
        severity: 'warning'
      };
    }
    return { allowed: true };
  }

  initialize() {
    if (this._initializePromise) return this._initializePromise;
    if (this._initialized) return Promise.resolve(this.validateBootConditions());

    this._initializePromise = (async () => {
      Logger.info('[StorageManager] Inicialización best-effort.');
      try {
        const status = await this.checkPersistenceStatus();
        if (status === StorageState.PROMPT || status === StorageState.UNKNOWN) {
          await this.requestPersistence();
        }
        await this.estimateQuota();
        const conditions = await this.validateBootConditions();
        this._initialized = true;
        return conditions;
      } catch (error) {
        this.lastPersistenceError = error?.message || String(error);
        this._setPersistenceState(StorageState.VOLATILE);
        this._initialized = true;
        return {
          canStart: true,
          isSafe: false,
          isVolatile: true,
          isCritical: false,
          isWarning: true,
          persistenceState: this.persistenceState,
          quota: this.quotaUsage,
          recommendation: this._generateRecommendation(this.persistenceState, this.quotaUsage),
          error: this.lastPersistenceError
        };
      } finally {
        this._initializePromise = null;
      }
    })();

    return this._initializePromise;
  }

  getState() {
    return {
      persistenceState: this.persistenceState,
      quotaUsage: this.quotaUsage,
      isSupported: this.isSupported(),
      initialized: this._initialized,
      requestAttempted: this._requestAttempted,
      lastPersistenceError: this.lastPersistenceError
    };
  }
}

export const storageManager = new StorageManagerService();
export default storageManager;
