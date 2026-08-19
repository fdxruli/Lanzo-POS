// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateRuntimeMocks = vi.hoisted(() => ({
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
  resetPosApplicationBootstrapForTests
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
  openTenantRuntime,
  resolveTenantRuntimeDirectory
} from '../../../services/db/tenantRuntimeRouter';
import { CURRENT_NATIVE_DATABASE_VERSION } from '../../../services/db/databaseSchema';

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

const renderBootstrap = ({
  prepareLocalDatabase,
  loadReadyRuntime = vi.fn(),
  cleanupDevelopmentServiceWorkers = vi.fn().mockResolvedValue(true)
}) => {
  const databaseRuntime = { prepareLocalDatabase };

  const result = render(
    <StrictMode>
      <PosApplicationBootstrap
        databaseRuntime={databaseRuntime}
        cleanupDevelopmentServiceWorkers={cleanupDevelopmentServiceWorkers}
        loadReadyRuntime={loadReadyRuntime}
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
  closeTenantRuntime();
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
});

describe('PosApplicationBootstrap initial recovery shell', () => {
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
      name: /actualizando la base local de forma segura/i
    })).toBeInTheDocument();
    expect(screen.getByText(/backup_complete/i)).toBeInTheDocument();
    expect(screen.getByText(/"sales":2/i)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /enviar reporte a soporte/i })).toBeInTheDocument();
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
      name: /comprobando la base local/i
    })).toBeInTheDocument();
    expect(cleanupDevelopmentServiceWorkers).toHaveBeenCalledTimes(1);
    expect(prepareLocalDatabase).not.toHaveBeenCalled();
    expect(loadReadyRuntime).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
  });
});
