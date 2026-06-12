import { db } from '../db/dexie';
import { evaluator } from '../BackupRiskEvaluator';
import Logger from '../Logger';
import {
  BACKUP_ITERATIONS,
  bytesToBase64
} from './backupFormat';
import {
  DEFAULT_BACKUP_SETTINGS,
  getBackupSettings,
  saveBackupSettings
} from './backupConfigDb';

export const BACKUP_STATUS_EVENT = 'lanzo_backup_manager_status';
export const BACKUP_ABORT_REASON = 'ABORTED';
export const BACKUP_WARNING_BLOB_PERF = 'BLOB_PERF_DEGRADED';

const WRITE_FAILURE_NAMES = new Set([
  'QuotaExceededError',
  'NotFoundError',
  'NotAllowedError',
  'NoModificationAllowedError'
]);

class BackupManager {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.settings = { ...DEFAULT_BACKUP_SETTINGS };
    this.state = {
      initialized: false,
      configured: false,
      unlocked: false,
      permission: 'unsupported',
      supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
      busy: false,
      progress: 0,
      phase: '',
      lastError: ''
    };
  }

  async initialize() {
    if (this.state.initialized) return this.getStatus();
    this.settings = await getBackupSettings();
    this.state.configured = this.settings.configured;
    this.state.initialized = true;
    await this.refreshPermission();
    this.emit();
    return this.getStatus();
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
    if (!this.state.initialized) await this.initialize();
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
    if (!this.state.supported) return null;
    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.settings = await saveBackupSettings({
        directoryHandle,
        directoryName: directoryHandle.name,
        cronBlocked: false,
        lastError: ''
      });
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
      });
      this.state.configured = true;
      this.state.unlocked = true;
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
    await this.initialize();
    if (!this.settings.configured) throw new Error('BACKUP_NOT_CONFIGURED');
    this.validatePin(pin);
    await this.callWorker('unlock', {
      pin,
      salt: this.settings.salt,
      iterations: this.settings.iterations,
      expectedVerifier: this.settings.verifier
    });
    this.state.unlocked = true;
    this.state.lastError = '';
    this.emit();
    return true;
  }

  async lock() {
    if (this.worker) await this.callWorker('lock');
    this.state.unlocked = false;
    this.emit();
  }

  async getMutationCount() {
    await db.open();
    const counts = await Promise.all(db.tables.map((table) => table.count()));
    return counts.reduce((total, count) => total + count, 0);
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

  async backup({ reason = 'manual', manual = true } = {}) {
    await this.initialize();
    if (this.state.busy) throw new Error('BACKUP_OPERATION_IN_PROGRESS');
    if (!this.state.unlocked) throw new Error('BACKUP_SESSION_LOCKED');

    const mutationCount = await this.getMutationCount();
    if (!manual && mutationCount <= this.settings.lastMutationCount) {
      return { success: true, skipped: true, reason: 'NO_CHANGES' };
    }

    let directoryHandle = null;
    if (this.state.supported) {
      const permission = await this.refreshPermission();
      if (permission !== 'granted') {
        if (!manual) {
          this.settings = await saveBackupSettings({ cronPending: true });
          this.emit();
          return { success: false, reason: 'PERMISSION_REQUIRED' };
        }
        throw new Error('BACKUP_PERMISSION_REQUIRED');
      }
      directoryHandle = this.settings.directoryHandle;
    } else if (!manual) {
      this.settings = await saveBackupSettings({ cronPending: true });
      this.emit();
      return { success: false, reason: 'DOWNLOAD_REQUIRED' };
    }

    this.state.busy = true;
    this.state.progress = 0;
    this.state.phase = 'starting';
    this.emit();
    try {
      const result = await this.callWorker('backup', { directoryHandle, reason });
      if (result.mode === 'DOWNLOAD') this.triggerDownload(result.blob, result.fileName);
      const completedAt = new Date().toISOString();
      this.settings = await saveBackupSettings({
        lastBackupAt: completedAt,
        lastBackupFile: result.fileName,
        lastResult: 'success',
        lastError: '',
        cronBlocked: false,
        cronPending: false,
        lastMutationCount: mutationCount
      });
      localStorage.setItem('last_backup_date', completedAt);
      window.dispatchEvent(new Event('backup_status_changed'));
      await evaluator.markBackupCompleted();
      this.state.lastError = '';
      return {
        success: true,
        mode: result.mode === 'DOWNLOAD' ? 'BLOB_FALLBACK' : 'FS_API',
        fileName: result.fileName,
        warnings: result.mode === 'DOWNLOAD' ? [BACKUP_WARNING_BLOB_PERF] : []
      };
    } catch (error) {
      await this.recordFailure(error, true);
      throw error;
    } finally {
      this.state.busy = false;
      this.state.progress = 0;
      this.state.phase = '';
      this.emit();
    }
  }

  async recordFailure(error, blockCron) {
    const shouldBlock = blockCron || WRITE_FAILURE_NAMES.has(error.name);
    this.state.lastError = error.message || String(error);
    this.settings = await saveBackupSettings({
      lastResult: 'error',
      lastError: this.state.lastError,
      cronBlocked: shouldBlock ? true : this.settings.cronBlocked
    });
    this.emit();
  }

  async restore(file, pin) {
    if (!file) throw new Error('Selecciona un archivo de respaldo.');
    this.validatePin(pin);
    await this.backup({ reason: 'pre_restore', manual: true });
    this.state.busy = true;
    this.state.progress = 0;
    this.emit();
    try {
      db.close();
      const result = await this.callWorker('restore', { file, pin });
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
    this.validatePin(newPin);
    await this.unlock(currentPin);
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
        iterations: BACKUP_ITERATIONS
      });
      this.settings = await saveBackupSettings({
        salt: newSalt,
        verifier: result.verifier,
        iterations: BACKUP_ITERATIONS,
        lastBackupFile: result.lastFileName || this.settings.lastBackupFile,
        cronBlocked: false,
        lastError: ''
      });
      this.state.unlocked = true;
      return result;
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
