import { db } from '../db/dexie';
import { evaluator } from '../BackupRiskEvaluator';
import Logger from '../Logger';
import {
  BACKUP_ITERATIONS,
  bytesToBase64
} from './backupFormat';
import {
  clearPersistedBackupKey,
  DEFAULT_BACKUP_SETTINGS,
  getBackupSettings,
  getPersistedBackupKey,
  savePersistedBackupKey,
  saveBackupSettings
} from './backupConfigDb';
import { getBackupTableScope } from './backupScope';
import {
  getBackupTenantKey,
  readBackupMutationRevision
} from './backupMutationRevision';
import {
  captureActiveTenantWorkerContext,
  isActiveTenantWorkerContext
} from '../tenant/tenantWorkerContext';

export const BACKUP_STATUS_EVENT = 'lanzo_backup_manager_status';
export const BACKUP_ABORT_REASON = 'ABORTED';
export const BACKUP_WARNING_BLOB_PERF = 'BLOB_PERF_DEGRADED';
export const BACKUP_WARNING_PARTIAL_COVERAGE = 'PARTIAL_COVERAGE';
export const BACKUP_PIN_SESSION_KEY = 'lanzo_backup_pin_session';
export const BACKUP_KEY_SESSION_MARKER = 'lanzo_backup_key_session:v1';
const sessionMarkerFor = (tenantKey) => `${BACKUP_KEY_SESSION_MARKER}:${tenantKey}`;

const requireBackupTenantContext = () => {
  try {
    return captureActiveTenantWorkerContext();
  } catch {
    // Preserve the public backup contract while refusing to create a worker
    // without the main-thread runtime authority.
    throw new Error('BACKUP_TENANT_ACCESS_REQUIRED');
  }
};

function clearLegacySessionPin() {
  try {
    sessionStorage.removeItem(BACKUP_PIN_SESSION_KEY);
  } catch {
    // La limpieza de la version anterior no debe bloquear la inicializacion.
  }
}

function readKeySessionId(tenantKey) {
  try {
    return sessionStorage.getItem(sessionMarkerFor(tenantKey));
  } catch {
    return null;
  }
}

function createKeySessionId() {
  return crypto.randomUUID?.()
    || bytesToBase64(crypto.getRandomValues(new Uint8Array(24)));
}

function persistKeySessionId(sessionId, tenantKey) {
  try {
    sessionStorage.setItem(sessionMarkerFor(tenantKey), sessionId);
    return true;
  } catch {
    return false;
  }
}

function clearKeySessionId(tenantKey) {
  try {
    sessionStorage.removeItem(sessionMarkerFor(tenantKey));
  } catch {
    // El bloqueo del worker no depende de sessionStorage.
  }
}

async function readPersistedKey(tenantKey) {
  try {
    return await getPersistedBackupKey(tenantKey);
  } catch {
    return null;
  }
}

async function persistDerivedKey(keyData, tenantKey) {
  const sessionId = readKeySessionId(tenantKey) || createKeySessionId();
  if (!persistKeySessionId(sessionId, tenantKey)) return;
  try {
    await savePersistedBackupKey({ ...keyData, sessionId }, tenantKey);
  } catch {
    clearKeySessionId(tenantKey);
    // El desbloqueo actual sigue en memoria si el navegador no puede clonar CryptoKey.
  }
}

async function clearPersistedKey(tenantKey) {
  if (tenantKey) clearKeySessionId(tenantKey);
  try {
    if (tenantKey) await clearPersistedBackupKey(tenantKey);
  } catch {
    // El worker se bloquea aunque IndexedDB no este disponible.
  }
}

const WRITE_FAILURE_NAMES = new Set([
  'QuotaExceededError',
  'NotFoundError',
  'NotAllowedError',
  'NoModificationAllowedError'
]);

const countStoredEntries = (key, raw) => {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const collection = key === 'lanzo-active-orders-storage'
      ? state?.activeOrders
      : parsed;
    if (Array.isArray(collection)) return collection.length;
    if (collection && typeof collection === 'object') return Object.keys(collection).length;
    return raw.length > 0 ? 1 : 0;
  } catch {
    return 1;
  }
};

export const getExcludedBrowserStateSummary = (storage = null) => {
  const keys = [
    ['lanzo-active-orders-storage', 'activeOrders'],
    ['lanzo-cart-storage', 'unsavedCart'],
    ['lanzo-inventory-storage', 'unfinishedInventoryAdjustments'],
    ['lanzo:restaurant-order-close-pending:v1', 'pendingOrderClosures'],
    ['ignored_expirations_ttl', 'otherPendingBusinessState']
  ];
  try {
    const targetStorage = storage || globalThis.localStorage;
    if (!targetStorage) throw new Error('STORAGE_UNAVAILABLE');
    const counts = Object.fromEntries(keys.map(([key, label]) => (
      [label, countStoredEntries(key, targetStorage.getItem(key))]
    )));
    return { inspectionComplete: true, counts };
  } catch {
    return {
      inspectionComplete: false,
      counts: Object.fromEntries(keys.map(([, label]) => [label, 0]))
    };
  }
};

class BackupManager {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.settings = { ...DEFAULT_BACKUP_SETTINGS };
    this.tenantKey = null;
    this.tenantContext = null;
    this.state = {
      initialized: false,
      configured: false,
      unlocked: false,
      permission: 'unsupported',
      supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
      busy: false,
      progress: 0,
      phase: '',
      lastError: '',
      lastCoverage: null
    };
  }

  async initialize() {
    clearLegacySessionPin();
    let context;
    try {
      context = requireBackupTenantContext();
    } catch {
      if (this.tenantKey && !this.state.busy) {
        try { await this.callWorker('lock'); } catch { /* best effort */ }
      }
      this.tenantKey = null;
      this.tenantContext = null;
      this.settings = { ...DEFAULT_BACKUP_SETTINGS };
      this.state.configured = false;
      this.state.unlocked = false;
      this.state.initialized = true;
      await this.refreshPermission();
      this.emit();
      return this.getStatus();
    }
    await this.ensureTenantContext(context);
    return this.getStatus();
  }

  async ensureTenantContext(context = requireBackupTenantContext()) {
    if (!isActiveTenantWorkerContext(context)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    const tenantKey = getBackupTenantKey(context.databaseName);
    if (this.tenantKey === tenantKey && this.state.initialized) {
      this.tenantContext = context;
      return context;
    }
    if (this.state.busy) throw new Error('BACKUP_OPERATION_IN_PROGRESS');
    if (this.worker && this.state.unlocked) {
      try { await this.callWorker('lock'); } catch { /* reset below */ }
    }

    this.tenantKey = tenantKey;
    this.tenantContext = context;
    this.settings = await getBackupSettings(tenantKey);
    this.state.configured = this.settings.configured === true;
    this.state.unlocked = false;
    this.state.initialized = true;
    this.state.lastError = '';
    this.state.lastCoverage = null;
    await this.refreshPermission();

    const keySessionId = readKeySessionId(tenantKey);
    const persistedKey = await readPersistedKey(tenantKey);
    const canResume = this.state.configured
      && persistedKey
      && keySessionId
      && persistedKey.sessionId === keySessionId
      && persistedKey.verifier === this.settings.verifier
      && persistedKey.salt === this.settings.salt
      && persistedKey.iterations === this.settings.iterations;
    if (canResume) {
      try {
        await this.callWorker('resume', {
          key: persistedKey.key,
          verifier: persistedKey.verifier,
          salt: persistedKey.salt,
          iterations: persistedKey.iterations
        });
        this.state.unlocked = true;
      } catch {
        await clearPersistedKey(tenantKey);
      }
    } else if (persistedKey) {
      await clearPersistedKey(tenantKey);
    }
    this.emit();
    return context;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../../workers/backup.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.state.progress = message.progress;
        this.state.phase = message.phase;
        this.emit();
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === 'error') {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        error.code = message.error.code;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    };
    worker.onerror = (event) => {
      Logger.error('[BackupManager] Worker error', event.error || event.message);
      const workerError = event.error || new Error(event.message || 'El worker de respaldo no pudo cargarse. Verifica que el navegador permita Web Workers.');
      for (const pending of this.pending.values()) {
        pending.reject(workerError);
      }
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  callWorker(command, payload = {}, timeoutMs = 30000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('El worker de respaldo no respondió a tiempo. Recarga la página e intenta de nuevo.'));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      try {
        this.ensureWorker().postMessage({ id, command, payload });
      } catch (postError) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(postError);
      }
    });
  }

  getStatus() {
    return {
      ...this.state,
      settings: { ...this.settings, directoryHandle: undefined }
    };
  }

  subscribe(listener) {
    const handler = (event) => listener(event.detail);
    window.addEventListener(BACKUP_STATUS_EVENT, handler);
    listener(this.getStatus());
    return () => window.removeEventListener(BACKUP_STATUS_EVENT, handler);
  }

  emit() {
    window.dispatchEvent(new CustomEvent(BACKUP_STATUS_EVENT, { detail: this.getStatus() }));
  }

  async refreshPermission() {
    if (!this.state.supported) {
      this.state.permission = 'unsupported';
      return this.state.permission;
    }
    const handle = this.settings.directoryHandle;
    if (!handle) {
      this.state.permission = 'missing';
      return this.state.permission;
    }
    try {
      this.state.permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      this.state.permission = 'missing';
    }
    return this.state.permission;
  }

  async requestPermission() {
    const context = await this.ensureTenantContext();
    if (!isActiveTenantWorkerContext(context)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    const handle = this.settings.directoryHandle;
    if (!handle) return this.chooseDirectory();
    try {
      this.state.permission = await handle.requestPermission({ mode: 'readwrite' });
      this.emit();
      return this.state.permission;
    } catch (error) {
      if (error.name !== 'AbortError') await this.recordFailure(error, false);
      throw error;
    }
  }

  async chooseDirectory() {
    const context = await this.ensureTenantContext();
    if (!isActiveTenantWorkerContext(context)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    if (!this.state.supported) return null;
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.settings = await saveBackupSettings({
        directoryHandle,
        directoryName: directoryHandle.name,
        cronBlocked: false,
        lastError: ''
      }, this.tenantKey);
      this.state.configured = this.settings.configured;
      await this.refreshPermission();
      this.emit();
      return directoryHandle;
    } catch (error) {
      if (error.name === 'AbortError') return null;
      throw error;
    }
  }

  validatePin(pin) {
    if (!/^\d{8,}$/.test(pin)) {
      throw new Error('El PIN debe contener al menos 8 dígitos.');
    }
  }

  async configure(pin, directoryHandle = null) {
    const context = await this.ensureTenantContext();
    if (!isActiveTenantWorkerContext(context)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    this.validatePin(pin);
    this.state.busy = true;
    this.state.phase = 'Derivando clave';
    this.emit();
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltBase64 = bytesToBase64(salt);
      const result = await this.callWorker('unlock', {
        pin,
        salt: saltBase64,
        iterations: BACKUP_ITERATIONS,
        expectedVerifier: ''
      });
      this.state.phase = 'Guardando configuración';
      this.emit();
      this.settings = await saveBackupSettings({
        configured: true,
        directoryHandle,
        directoryName: directoryHandle?.name || '',
        salt: saltBase64,
        verifier: result.verifier,
        iterations: BACKUP_ITERATIONS,
        cronBlocked: false,
        cronPending: !directoryHandle && !this.state.supported,
        lastError: ''
      }, this.tenantKey);
      this.state.configured = true;
      this.state.unlocked = true;
      await persistDerivedKey({
        key: result.key,
        verifier: result.verifier,
        salt: saltBase64,
        iterations: BACKUP_ITERATIONS
      }, this.tenantKey);
      await this.refreshPermission();
      this.emit();
      return this.getStatus();
    } catch (error) {
      Logger.error('[BackupManager] Configure failed:', error);
      throw error;
    } finally {
      this.state.busy = false;
      this.state.phase = '';
      this.emit();
    }
  }

  async unlock(pin) {
    await this.ensureTenantContext();
    if (!this.settings.configured) throw new Error('BACKUP_NOT_CONFIGURED');
    this.validatePin(pin);
    const result = await this.callWorker('unlock', {
      pin,
      salt: this.settings.salt,
      iterations: this.settings.iterations,
      expectedVerifier: this.settings.verifier
    });
    this.state.unlocked = true;
    this.state.lastError = '';
    await persistDerivedKey({
      key: result.key,
      verifier: result.verifier,
      salt: this.settings.salt,
      iterations: this.settings.iterations
    }, this.tenantKey);
    this.emit();
    return true;
  }

  async lock() {
    await this.ensureTenantContext();
    clearLegacySessionPin();
    await clearPersistedKey(this.tenantKey);
    try {
      if (this.worker) await this.callWorker('lock');
    } finally {
      this.state.unlocked = false;
      this.emit();
    }
  }

  async getMutationCount(context) {
    const snapshot = await this.getMutationSnapshot(context);
    return snapshot.total;
  }

  async getMutationSnapshot(context) {
    if (!isActiveTenantWorkerContext(context)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    await db.open();
    const { includedTables } = getBackupTableScope(db);
    const counts = await db.transaction('r', includedTables, async () => (
      Object.fromEntries(await Promise.all(includedTables.map(async (table) => (
        [table.name, await table.count()]
      ))))
    ));
    return {
      counts,
      total: Object.values(counts).reduce((total, count) => total + count, 0),
      revision: readBackupMutationRevision(context.databaseName)
    };
  }

  triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async backup({ reason = 'manual', manual = true, includeBlob = false } = {}) {
    const tenantContext = requireBackupTenantContext();
    await this.ensureTenantContext(tenantContext);
    if (this.state.busy) throw new Error('BACKUP_OPERATION_IN_PROGRESS');
    if (!this.state.unlocked) throw new Error('BACKUP_SESSION_LOCKED');

    const mutationSnapshot = await this.getMutationSnapshot(tenantContext);
    const mutationCount = mutationSnapshot.total;
    const currentTableCounts = JSON.stringify(mutationSnapshot.counts);
    const revisionIsReliable = Boolean(mutationSnapshot.revision);
    const noChanges = revisionIsReliable
      && this.settings.lastRevision === mutationSnapshot.revision
      && this.settings.lastTableCounts === currentTableCounts;
    if (!manual && noChanges && this.settings.lastResult === 'success') {
      return { success: true, skipped: true, reason: 'NO_CHANGES' };
    }

    let directoryHandle = null;
    if (this.state.supported) {
      const permission = await this.refreshPermission();
      if (permission !== 'granted') {
        if (!manual) {
          this.settings = await saveBackupSettings({ cronPending: true }, this.tenantKey);
          this.emit();
          return { success: false, reason: 'PERMISSION_REQUIRED' };
        }
        throw new Error('BACKUP_PERMISSION_REQUIRED');
      }
      directoryHandle = this.settings.directoryHandle;
    } else if (!manual) {
      this.settings = await saveBackupSettings({ cronPending: true }, this.tenantKey);
      this.emit();
      return { success: false, reason: 'DOWNLOAD_REQUIRED' };
    }

    this.state.busy = true;
    this.state.progress = 0;
    this.state.phase = 'starting';
    this.emit();
    try {
      if (!isActiveTenantWorkerContext(tenantContext)) {
        throw new Error('BACKUP_TENANT_CONTEXT_STALE');
      }
      const result = await this.callWorker('backup', {
        directoryHandle,
        reason,
        includeBlob,
        context: tenantContext,
        excludedBrowserState: getExcludedBrowserStateSummary()
      });
      if (!isActiveTenantWorkerContext(tenantContext)) {
        throw new Error('BACKUP_TENANT_CONTEXT_STALE');
      }
      if (result.mode === 'DOWNLOAD') this.triggerDownload(result.blob, result.fileName);
      const completedAt = new Date().toISOString();
      this.settings = await saveBackupSettings({
        lastBackupAt: completedAt,
        lastBackupFile: result.fileName,
        lastResult: 'success',
        lastError: '',
        cronBlocked: false,
        cronPending: false,
        lastMutationCount: mutationCount,
        lastRevision: mutationSnapshot.revision,
        lastTableCounts: currentTableCounts,
        lastCoverage: result.header?.coverage || null
      }, this.tenantKey);
      window.dispatchEvent(new Event('backup_status_changed'));
      await evaluator.markBackupCompleted();
      this.state.lastError = '';
      this.state.lastCoverage = result.header?.coverage || null;
      return {
        success: true,
        mode: result.mode === 'DOWNLOAD' ? 'BLOB_FALLBACK' : 'FS_API',
        fileName: result.fileName,
        ...(includeBlob && { blob: result.blob }),
        coverage: result.header?.coverage || null,
        warnings: [
          ...(result.mode === 'DOWNLOAD' ? [BACKUP_WARNING_BLOB_PERF] : []),
          ...(result.header?.coverage?.complete === false ? [BACKUP_WARNING_PARTIAL_COVERAGE] : [])
        ]
      };
    } catch (error) {
      await this.recordFailure(error, false);
      throw error;
    } finally {
      this.state.busy = false;
      this.state.progress = 0;
      this.state.phase = '';
      this.emit();
    }
  }

  async recordFailure(error, blockCron) {
    const shouldBlock = blockCron === true || WRITE_FAILURE_NAMES.has(error.name);
    this.state.lastError = error.message || String(error);
    this.settings = await saveBackupSettings({
      lastResult: 'error',
      lastError: this.state.lastError,
      cronBlocked: shouldBlock ? true : this.settings.cronBlocked
    }, this.tenantKey);
    this.emit();
  }

  async inspectRestore(file, pin) {
    if (!file) throw new Error('Selecciona un archivo de respaldo.');
    this.validatePin(pin);
    const tenantContext = requireBackupTenantContext();
    await this.ensureTenantContext(tenantContext);
    if (!isActiveTenantWorkerContext(tenantContext)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    if (this.state.busy) throw new Error('BACKUP_OPERATION_IN_PROGRESS');
    this.state.busy = true;
    this.state.progress = 0;
    this.state.phase = 'Validando archivo';
    this.emit();
    try {
      const preview = await this.callWorker('inspect', { file, pin, context: tenantContext });
      if (!isActiveTenantWorkerContext(tenantContext)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
      return preview;
    } finally {
      this.state.busy = false;
      this.state.phase = '';
      this.emit();
    }
  }

  async restore(file, pin, preview = null) {
    const tenantContext = requireBackupTenantContext();
    await this.ensureTenantContext(tenantContext);
    if (!file) throw new Error('Selecciona un archivo de respaldo.');
    this.validatePin(pin);
    const inspected = preview || await this.inspectRestore(file, pin);
    if (!isActiveTenantWorkerContext(tenantContext)) {
      throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    }
    if (inspected.destinationHasBusinessData) {
      if (!this.state.configured || !this.state.unlocked) {
        throw new Error('BACKUP_DESTINATION_PROTECTION_REQUIRED');
      }
      const preRestoreBackup = await this.backup({ reason: 'pre_restore', manual: true });
      if (!preRestoreBackup.success || preRestoreBackup.skipped) {
        throw new Error('BACKUP_PRE_RESTORE_FAILED');
      }
    }
    if (!isActiveTenantWorkerContext(tenantContext)) {
      throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    }
    this.state.busy = true;
    this.state.progress = 0;
    this.emit();
    try {
      if (!isActiveTenantWorkerContext(tenantContext)) {
        throw new Error('BACKUP_TENANT_CONTEXT_STALE');
      }
      db.close();
      const result = await this.callWorker('restore', {
        file,
        pin,
        context: tenantContext,
        expectedDestinationHasBusinessData: inspected.destinationHasBusinessData === true
      });
      if (!isActiveTenantWorkerContext(tenantContext)) {
        throw new Error('BACKUP_TENANT_CONTEXT_STALE');
      }
      this.settings = await saveBackupSettings({
        lastResult: 'restore',
        lastRevision: null,
        lastTableCounts: null,
        lastCoverage: result.coverage || null
      }, this.tenantKey);
      this.state.lastCoverage = result.coverage || null;
      this.emit();
      return result;
    } catch (error) {
      await this.recordFailure(error, false);
      throw error;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }

  async changePin(currentPin, newPin) {
    const tenantContext = await this.ensureTenantContext();
    if (!isActiveTenantWorkerContext(tenantContext)) throw new Error('BACKUP_TENANT_CONTEXT_STALE');
    this.validatePin(newPin);
    await this.unlock(currentPin);
    await clearPersistedKey(this.tenantKey);
    if (!this.state.supported || !this.settings.directoryHandle) {
      throw new Error('El recifrado requiere una carpeta compatible configurada.');
    }
    const permission = await this.refreshPermission();
    if (permission !== 'granted') throw new Error('BACKUP_PERMISSION_REQUIRED');

    const newSalt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    this.state.busy = true;
    this.emit();
    try {
      const result = await this.callWorker('rekey', {
        directoryHandle: this.settings.directoryHandle,
        newPin,
        newSalt,
        iterations: BACKUP_ITERATIONS,
        databaseName: tenantContext.databaseName,
        tenantAliases: tenantContext.tenantAliases
      });
      this.settings = await saveBackupSettings({
        salt: newSalt,
        verifier: result.verifier,
        iterations: BACKUP_ITERATIONS,
        lastBackupFile: result.lastFileName || this.settings.lastBackupFile,
        cronBlocked: false,
        lastError: ''
      }, this.tenantKey);
      this.state.unlocked = true;
      await persistDerivedKey({
        key: result.key,
        verifier: result.verifier,
        salt: newSalt,
        iterations: BACKUP_ITERATIONS
      }, this.tenantKey);
      return {
        verifier: result.verifier,
        files: result.files,
        lastFileName: result.lastFileName
      };
    } catch (error) {
      await this.recordFailure(error, true);
      throw error;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
}

export const backupManager = new BackupManager();

export async function downloadBackupSmart() {
  try {
    return await backupManager.backup({ reason: 'manual', manual: true });
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, reason: BACKUP_ABORT_REASON };
    }
    throw error;
  }
}
