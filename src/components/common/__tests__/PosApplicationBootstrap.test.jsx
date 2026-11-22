// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateRuntimeMocks = vi.hoisted(() => ({
  DATABASE_PREPARATION_TIMEOUT_MS: 15_000,
  getLocalDatabaseActivitySnapshot: vi.fn(() => ({
    preparationActive: false,
    preflightActive: false,
    nativeOperations: [],
    hasActiveNativeRequest: false,
    hasTimedOutNativeRequest: false,
    migrationActive: false
  })),
  getLocalDatabaseActivityRevision: vi.fn(() => 0),
  subscribeLocalDatabaseActivity: vi.fn(() => () => {}),
  isLocalDatabasePreparationActive: vi.fn(() => false),
  ensureLocalDatabaseReady: vi.fn(),
  retryLocalDatabaseRecovery: vi.fn()
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock('../../../services/db/databaseRuntime', () => gateRuntimeMocks);
vi.mock('../../../services/Logger', () => ({ default: loggerMocks }));

import PosApplicationBootstrap, {
  getAdminBootErrorCode,
  INITIAL_DATABASE_PREPARATION_TIMEOUT_MS,
  resetPosApplicationBootstrapForTests,
  runStorageManagerBestEffort
} from '../PosApplicationBootstrap';
import {
  DATABASE_RECOVERY_STATUS,
  clearDatabaseRecoveryState,
  getDatabaseRecoveryState,
  setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';
import '../../../services/db/dexie';
import { resolveActiveTenantIdentity } from '../../../services/tenant/localTenantGuard';
import {
  closeTenantRuntime,
  db,
  getTenantRuntimeReadiness,
  getActiveTenantRuntime,
  openTenantRuntime,
  resolveTenantRuntimeDirectory
} from '../../../services/db/tenantRuntimeRouter';
import { CURRENT_NATIVE_DATABASE_VERSION } from '../../../services/db/databaseSchema';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { localTenantAccessController } from '../../../services/tenant/localTenantPolicy';
import { readTenantRuntimeTrace, stopTenantRuntimeTrace } from '../../../services/diagnostics/tenantRuntimeTrace';

const createNativeDatabase = (name, version) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, version);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('sales', { keyPath: 'id' });
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    request.result.close();
    resolve();
  };
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const setRecovery = (status, overrides = {}) => setDatabaseRecoveryState({
  status,
  databaseName: 'LanzoDB1',
  affectedStores: [],
  existingKeyPaths: {},
  expectedKeyPaths: {},
  isRetryable: true,
  requiresMigration: false,
  ...overrides
});

const createReadyRuntime = ({ storageResult = { isVolatile: false } } = {}) => {
  const startPosSyncAutoBootstrap = vi.fn();
  const initializeStorage = vi.fn().mockResolvedValue(storageResult);
  const activate = vi.fn(() => {
    startPosSyncAutoBootstrap();
    void initializeStorage();
  });
  const ReadyApplication = () => <div data-testid="admin-app">ADMIN_APP</div>;
  const loadReadyRuntime = vi.fn().mockResolvedValue({
    ReadyApplication,
    activate
  });

  return {
    activate,
    initializeStorage,
    loadReadyRuntime,
    startPosSyncAutoBootstrap
  };
};

describe('admin boot error code sanitization', () => {
  it('keeps allowlisted boot codes and replaces unknown or unreadable values', () => {
    expect(getAdminBootErrorCode({ code: 'TENANT_RUNTIME_NOT_READY' })).toBe('TENANT_RUNTIME_NOT_READY');
    expect(getAdminBootErrorCode({ code: 'token=secret-value' })).toBe('INCIDENT_UNKNOWN');

    const unreadableError = {};
    Object.defineProperty(unreadableError, 'code', { get() { throw new Error('license secret'); } });
    Object.defineProperty(unreadableError, 'message', { get() { throw new Error('customer secret'); } });
    expect(getAdminBootErrorCode(unreadableError)).toBe('ADMIN_RUNTIME_INITIALIZATION_FAILED');
  });
});

const renderBootstrap = ({
  prepareLocalDatabase,
  loadReadyRuntime = vi.fn(),
  cleanupDevelopmentServiceWorkers = vi.fn().mockResolvedValue(true),
  ...bootstrapProps
}) => {
  const databaseRuntime = { prepareLocalDatabase };

  const result = render(
    <StrictMode>
      <PosApplicationBootstrap
        databaseRuntime={databaseRuntime}
        cleanupDevelopmentServiceWorkers={cleanupDevelopmentServiceWorkers}
        loadReadyRuntime={loadReadyRuntime}
        {...bootstrapProps}
      />
    </StrictMode>
  );

  return {
    ...result,
    cleanupDevelopmentServiceWorkers,
    databaseRuntime
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
  gateRuntimeMocks.isLocalDatabasePreparationActive.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  closeTenantRuntime();
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
});

describe('PosApplicationBootstrap initial recovery shell', () => {
  it('lets an admin copy a real router failure from the recovery shell until capture expires', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: 'TRACE-FIXTURE-PRIVATE' });
    const { database } = await openTenantRuntime(identity);
    const runtime = getActiveTenantRuntime();
    const { loadReadyRuntime } = createReadyRuntime();
    const reloadPage = vi.fn();
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    try {
      renderBootstrap({ prepareLocalDatabase: vi.fn().mockResolvedValue({ ready: true }), loadReadyRuntime, reloadPage });
      await screen.findByTestId('admin-app');
      expect(screen.queryByText('Diagnóstico de conexión')).not.toBeInTheDocument();

      vi.useFakeTimers();
      act(() => {
        localTenantAccessController.grant(identity);
        actorRuntimeController.beginAuthentication({ actorType: 'staff' });
        actorRuntimeController.grant({ actorType: 'staff', actorId: 'private-staff', sessionId: 'private-session' });
      });
      expect(screen.queryByText('Diagnóstico de conexión')).not.toBeInTheDocument();
      act(() => {
        actorRuntimeController.lock('test_switch');
        actorRuntimeController.beginAuthentication({ actorType: 'admin' });
        actorRuntimeController.grant({
          actorType: 'admin', actorId: 'private-admin', sessionId: 'private-session',
          authorizationExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString()
        });
      });

      const actorGeneration = actorRuntimeController.getState().generation;
      fireEvent.click(screen.getByText('Diagnóstico de conexión'));
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar captura' }));
      fireEvent.click(screen.getByRole('button', { name: 'Detener captura' }));
      expect(readTenantRuntimeTrace()).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar captura' }));
      expect(getActiveTenantRuntime()).toEqual(runtime);
      expect(getTenantRuntimeReadiness()).toEqual({ ready: true, runtime });
      expect(actorRuntimeController.getState().generation).toBe(actorGeneration);

      act(() => {
        database.close();
        expect(() => db.table('menu')).toThrow('TENANT_RUNTIME_NOT_READY');
        actorRuntimeController.lock('test_unavailable');
        setRecovery(DATABASE_RECOVERY_STATUS.FAILED, { errorCode: 'DB_OPERATION_FAILED' });
      });
      expect(database.isOpen()).toBe(false);
      expect(getActiveTenantRuntime()).toEqual(runtime);
      expect(getTenantRuntimeReadiness().ready).toBe(false);
      expect(() => actorRuntimeController.capture()).toThrow();
      expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Iniciar captura' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Consultar traza' }));
      const report = screen.getByRole('textbox', { name: 'Traza de conexión' }).value;
      expect(JSON.parse(report)).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'dexie', detail: 'close' }),
        expect.objectContaining({ event: 'proxy_error', detail: 'closed', code: 'TENANT_RUNTIME_NOT_READY' })
      ]));
      expect(report).not.toMatch(/TRACE-FIXTURE|private-admin|private-session|LanzoDB_t_/);

      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copiar traza' })));
      expect(writeText).toHaveBeenCalledExactlyOnceWith(report);
      expect(reloadPage).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(10 * 60_000));
      expect(readTenantRuntimeTrace()).toEqual([]);
      expect(screen.queryByRole('textbox', { name: 'Traza de conexión' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copiar traza' })).not.toBeInTheDocument();
    } finally {
      stopTenantRuntimeTrace();
      actorRuntimeController.lock('test_cleanup');
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else delete navigator.clipboard;
    }
  });

  it('shows DB_BLOCKED while the original preparation promise remains pending', async () => {
    const operation = deferred();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      queueMicrotask(() => setRecovery(DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED, {
        errorCode: 'DB_BLOCKED'
      }));
      return operation.promise;
    });
    const loadReadyRuntime = vi.fn();

    const { container } = renderBootstrap({ prepareLocalDatabase, loadReadyRuntime });

    expect(await screen.findByRole('heading', {
      name: /cierra las demás pestañas de lanzo/i
    })).toBeInTheDocument();
    expect(container.textContent.trim()).not.toBe('');
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(loadReadyRuntime).not.toHaveBeenCalled();
    expect(prepareLocalDatabase).toHaveBeenCalledTimes(1);
  });

  it('shows checking immediately and does not load the administrative runtime', async () => {
    const operation = deferred();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      return operation.promise;
    });
    const loadReadyRuntime = vi.fn();

    renderBootstrap({ prepareLocalDatabase, loadReadyRuntime });

    expect(await screen.findByRole('heading', {
      name: /comprobando la base local/i
    })).toBeInTheDocument();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(loadReadyRuntime).not.toHaveBeenCalled();
    expect(prepareLocalDatabase).toHaveBeenCalledTimes(1);
  });

  it('replaces a preparation promise that never settles with a safe bounded result', async () => {
    vi.useFakeTimers();
    const operation = deferred();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      return operation.promise;
    });
    const loadReadyRuntime = vi.fn();

    renderBootstrap({ prepareLocalDatabase, loadReadyRuntime });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: /comprobando la base local/i })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INITIAL_DATABASE_PREPARATION_TIMEOUT_MS);
    });

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_TIMEOUT',
      isRetryable: false
    });
    expect(screen.getByRole('heading', { name: /apertura de la base local no terminó/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar recuperación|reiniciar lanzo/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(loadReadyRuntime).not.toHaveBeenCalled();

    operation.resolve({ ready: true });
    await act(async () => { await operation.promise; });
  });

  it('also bounds the idle state while development cleanup is still pending', async () => {
    vi.useFakeTimers();
    const cleanupOperation = deferred();
    const prepareLocalDatabase = vi.fn();

    renderBootstrap({
      prepareLocalDatabase,
      cleanupDevelopmentServiceWorkers: vi.fn(() => cleanupOperation.promise)
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.IDLE);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INITIAL_DATABASE_PREPARATION_TIMEOUT_MS);
    });

    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_TIMEOUT',
      isRetryable: false
    });
    expect(screen.getByRole('heading', { name: /apertura de la base local no terminó/i })).toBeInTheDocument();
    expect(prepareLocalDatabase).not.toHaveBeenCalled();

    cleanupOperation.resolve(false);
    await act(async () => { await cleanupOperation.promise; });
  });

  it('turns a rejected preparation into a terminal recovery state', async () => {
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      return Promise.reject(new Error('unclassified local preparation failure'));
    });

    renderBootstrap({ prepareLocalDatabase, loadReadyRuntime: vi.fn() });

    expect(await screen.findByRole('heading', { name: /no se pudo comprobar la base local/i }))
      .toBeInTheDocument();
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_OPERATION_FAILED',
      isRetryable: false
    });
    expect(screen.queryByRole('button', { name: /reiniciar lanzo/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no se pudo confirmar que este error permita reiniciar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /contactar a soporte/i })).toBeInTheDocument();
  });

  it('binds the restart action to the business runtime and actor context that produced DB_OPERATION_FAILED', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `DB-OP-RESTART-${crypto.randomUUID()}` });
    const openedRuntime = await openTenantRuntime(identity);
    const currentRuntime = getActiveTenantRuntime();
    clearDatabaseRecoveryState();
    actorRuntimeController.lock('db_operation_failed_restart_fixture');
    const actor = actorRuntimeController.getState();
    const operation = deferred();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      return operation.promise;
    });
    const reloadPage = vi.fn();

    renderBootstrap({ prepareLocalDatabase, loadReadyRuntime: vi.fn(), reloadPage });
    await screen.findByRole('heading', { name: /comprobando la base local/i });

    act(() => setRecovery(DATABASE_RECOVERY_STATUS.FAILED, {
      errorCode: 'DB_OPERATION_FAILED',
      isRetryable: false,
      requiresMigration: false,
      databaseName: currentRuntime.databaseName,
      failure: {
        id: 41,
        phase: 'dexie_open',
        category: 'unknown',
        errorType: 'Error',
        durationMs: 120,
        nativeRequestState: 'none',
        preflightActive: false,
        restartContext: {
          runtimeGeneration: currentRuntime.generation,
          actorGeneration: actor.generation,
          actorStatus: actor.status
        }
      }
    }));

    expect(screen.getByRole('button', { name: 'Reiniciar Lanzo' })).toBeEnabled();
    expect(openedRuntime.database.name).toBe(currentRuntime.databaseName);

    act(() => actorRuntimeController.lock('actor_changed_after_database_failure'));

    expect(screen.getByText(/la sesión o el negocio cambió desde que ocurrió el error/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
    operation.resolve({ ready: true });
  });

  it('shows slow migration progress before mounting App and starting POS Sync', async () => {
    const operation = deferred();
    const readyRuntime = createReadyRuntime();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.CHECKING);
      return operation.promise;
    });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: readyRuntime.loadReadyRuntime
    });

    await screen.findByRole('heading', { name: /comprobando la base local/i });

    act(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.MIGRATING, {
        affectedStores: ['sales', 'deleted_sales'],
        requiresMigration: true,
        migration: {
          phase: 'backup_complete',
          sourceCounts: { sales: 2, deleted_sales: 1 },
          targetCounts: {}
        }
      });
    });

    expect(screen.getByRole('heading', {
      name: /preparando una actualización de la base local/i
    })).toBeInTheDocument();
    expect(screen.getByText(/backup_complete/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('"sales":2');
    expect(document.body.textContent).not.toContain('deleted_sales');
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(readyRuntime.startPosSyncAutoBootstrap).not.toHaveBeenCalled();

    await act(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      operation.resolve({ ready: true });
      await operation.promise;
    });

    expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
    expect(readyRuntime.loadReadyRuntime).toHaveBeenCalledTimes(1);
    expect(readyRuntime.activate).toHaveBeenCalledTimes(1);
    expect(readyRuntime.startPosSyncAutoBootstrap).toHaveBeenCalledTimes(1);
  });

  it('continues the same blocked preparation and activates once after READY', async () => {
    const operation = deferred();
    const readyRuntime = createReadyRuntime();
    const prepareLocalDatabase = vi.fn(() => {
      setRecovery(DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED, {
        errorCode: 'DB_BLOCKED'
      });
      return operation.promise;
    });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: readyRuntime.loadReadyRuntime
    });

    await screen.findByRole('heading', {
      name: /cierra las demás pestañas de lanzo/i
    });

    await act(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      operation.resolve({ ready: true });
      await operation.promise;
    });

    expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
    expect(prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(readyRuntime.loadReadyRuntime).toHaveBeenCalledTimes(1);
    expect(readyRuntime.startPosSyncAutoBootstrap).toHaveBeenCalledTimes(1);
  });

  it('shows support actions after the real tenant preflight publishes a terminal diagnostic', async () => {
    const identity = await resolveActiveTenantIdentity({ license_key: `BOOTSTRAP-UNSUPPORTED-${crypto.randomUUID()}` });
    const opaqueId = await resolveTenantRuntimeDirectory(identity);
    const databaseName = `LanzoDB_t_${opaqueId}`;
    await createNativeDatabase(databaseName, CURRENT_NATIVE_DATABASE_VERSION + 10);
    const prepareLocalDatabase = vi.fn(() => openTenantRuntime(identity));
    const readyRuntime = createReadyRuntime();

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: readyRuntime.loadReadyRuntime
    });

    expect(await screen.findByRole('heading', {
      name: /esta versión de lanzo no puede abrir tu base local/i
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Detalles del problema'));
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeInTheDocument();
    expect(screen.queryByText(/^No se pudo iniciar Lanzo POS$/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(readyRuntime.loadReadyRuntime).not.toHaveBeenCalled();
    expect(getDatabaseRecoveryState()).toMatchObject({
      status: DATABASE_RECOVERY_STATUS.FAILED,
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      databaseName,
      detectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION + 10,
      expectedNativeVersion: CURRENT_NATIVE_DATABASE_VERSION,
      isRetryable: false,
      requiresMigration: false
    });
  });

  it('classifies TENANT_RUNTIME_NOT_READY as a runtime boot failure and preserves the safe retry path', async () => {
    const error = Object.assign(new Error('TENANT_RUNTIME_NOT_READY'), {
      code: 'TENANT_RUNTIME_NOT_READY'
    });
    const prepareLocalDatabase = vi.fn(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      return { ready: true };
    });
    const loadReadyRuntime = vi.fn().mockRejectedValue(error);
    const recoverStartup = vi.fn();
    const reloadPage = vi.fn();
    const openSupportMailto = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime,
      recoverStartup,
      reloadPage,
      openSupportMailto,
      createContextGuard: () => () => true
    });

    expect(await screen.findByRole('heading', { name: /no pudimos iniciar lanzo pos/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar inicio/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Detalles del problema y opciones de soporte'));
    expect(screen.getByText('TENANT_RUNTIME_NOT_READY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeInTheDocument();
    expect(recoverStartup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar inicio/i }));
    expect(reloadPage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /abrir correo de soporte/i }));
    expect(openSupportMailto).toHaveBeenCalledWith(expect.stringContaining('TENANT_RUNTIME_NOT_READY'));

    fireEvent.click(screen.getByRole('button', { name: /copiar diagnóstico/i }));
    expect(await screen.findByRole('button', { name: /diagnóstico copiado/i })).toBeInTheDocument();
  });

  it('keeps the update action exclusively for a ChunkLoadError', async () => {
    const error = Object.assign(new Error('Loading chunk 123 failed'), { name: 'ChunkLoadError' });
    const prepareLocalDatabase = vi.fn(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      return { ready: true };
    });
    const recoverStartup = vi.fn().mockResolvedValue({ status: 'already-attempted' });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: vi.fn().mockRejectedValue(error),
      recoverStartup,
      createContextGuard: () => () => true
    });

    expect(await screen.findByRole('button', { name: /actualizar archivos de lanzo pos/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar inicio/i })).not.toBeInTheDocument();
    expect(recoverStartup).toHaveBeenCalledWith(expect.objectContaining({
      error,
      isContextCurrent: expect.any(Function)
    }));
  });

  it('does not retry startup assets after actor or tenant context changes', async () => {
    const error = Object.assign(new Error('Loading chunk 123 failed'), { name: 'ChunkLoadError' });
    const prepareLocalDatabase = vi.fn(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      return { ready: true };
    });
    const recoverStartup = vi.fn();

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: vi.fn().mockRejectedValue(error),
      recoverStartup,
      createContextGuard: () => () => false
    });

    expect(await screen.findByText(/sesión o el tenant cambió durante el inicio/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actualizar archivos de lanzo pos/i })).toBeDisabled();
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('deduplicates preparation and runtime activation under StrictMode', async () => {
    const readyRuntime = createReadyRuntime();
    const prepareLocalDatabase = vi.fn(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      return { ready: true };
    });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: readyRuntime.loadReadyRuntime
    });

    expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
    expect(prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(readyRuntime.loadReadyRuntime).toHaveBeenCalledTimes(1);
    expect(readyRuntime.activate).toHaveBeenCalledTimes(1);
    expect(readyRuntime.startPosSyncAutoBootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps READY when best-effort storage is denied', async () => {
    const readyRuntime = createReadyRuntime({
      storageResult: {
        canStart: true,
        isVolatile: true,
        persistenceState: 'denied'
      }
    });
    const prepareLocalDatabase = vi.fn(async () => {
      setRecovery(DATABASE_RECOVERY_STATUS.READY);
      return { ready: true };
    });

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime: readyRuntime.loadReadyRuntime
    });

    expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
    await waitFor(() => expect(readyRuntime.initializeStorage).toHaveBeenCalledTimes(1));
    expect(getDatabaseRecoveryState().status).toBe(DATABASE_RECOVERY_STATUS.READY);
    expect(screen.queryByText(/recuperación automática no pudo completarse/i)).not.toBeInTheDocument();
  });

  it('logs expected denied persistence at info without a boot warning', async () => {
    runStorageManagerBestEffort({
      initialize: vi.fn().mockResolvedValue({
        canStart: true,
        isVolatile: true,
        persistenceState: 'denied',
        recommendation: []
      })
    });

    await waitFor(() => expect(loggerMocks.info).toHaveBeenCalledWith(
      '[Boot] Almacenamiento local en modo best-effort.',
      { persistenceState: 'denied', recommendation: [] }
    ));
    expect(loggerMocks.warn).not.toHaveBeenCalled();
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('keeps a boot warning for a non-denied volatile storage state', async () => {
    runStorageManagerBestEffort({
      initialize: vi.fn().mockResolvedValue({
        canStart: true,
        isVolatile: true,
        persistenceState: 'volatile',
        recommendation: []
      })
    });

    await waitFor(() => expect(loggerMocks.warn).toHaveBeenCalledWith(
      '[Boot] Almacenamiento local en modo best-effort.',
      { persistenceState: 'volatile', recommendation: [] }
    ));
    expect(loggerMocks.info).not.toHaveBeenCalled();
  });

  it('stops boot explicitly when development cleanup requests a reload', async () => {
    const cleanupDevelopmentServiceWorkers = vi.fn().mockResolvedValue(false);
    const prepareLocalDatabase = vi.fn();
    const loadReadyRuntime = vi.fn();

    renderBootstrap({
      prepareLocalDatabase,
      loadReadyRuntime,
      cleanupDevelopmentServiceWorkers
    });

    expect(await screen.findByRole('heading', {
      name: /no se pudo comprobar la base local/i
    })).toBeInTheDocument();
    expect(cleanupDevelopmentServiceWorkers).toHaveBeenCalledTimes(1);
    expect(prepareLocalDatabase).not.toHaveBeenCalled();
    expect(loadReadyRuntime).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /contactar a soporte/i })).toBeInTheDocument();
  });
});
