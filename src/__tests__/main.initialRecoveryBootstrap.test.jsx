// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const rootMocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  roots: []
}));

const adminPwaMocks = vi.hoisted(() => ({
  installAdminPwaDocument: vi.fn(),
  startAdminInstallPromptCapture: vi.fn(),
  startAdminServiceWorker: vi.fn(),
  updateExistingAdminWorkerOnPublicRoute: vi.fn()
}));

const readyImportMocks = vi.hoisted(() => ({
  appLoaded: false,
  posSyncLoaded: false,
  startPosSyncAutoBootstrap: vi.fn()
}));

const runtimeMocks = vi.hoisted(() => ({
  isLocalDatabasePreparationActive: vi.fn(() => true),
  prepareLocalDatabase: vi.fn(),
  ensureLocalDatabaseReady: vi.fn(),
  retryLocalDatabaseRecovery: vi.fn()
}));

vi.mock('react-dom/client', async () => {
  const actual = await vi.importActual('react-dom/client');
  return {
    ...actual,
    default: {
      ...(actual.default || {}),
      createRoot: (...args) => {
        rootMocks.createRoot(...args);
        const root = actual.createRoot(...args);
        rootMocks.roots.push(root);
        return root;
      }
    }
  };
});

vi.mock('../router/publicStoreRoutes', () => ({ publicStoreRoutes: [] }));
vi.mock('../router/isPublicStorePath', () => ({ isPublicStorePath: () => false }));
vi.mock('../router/preparePublicStoreDocument', () => ({
  preparePublicStoreDocument: vi.fn()
}));
vi.mock('../pwa/adminPwaDocument', () => ({
  installAdminPwaDocument: adminPwaMocks.installAdminPwaDocument
}));
vi.mock('../pwa/adminInstallPrompt', () => ({
  startAdminInstallPromptCapture: adminPwaMocks.startAdminInstallPromptCapture
}));
vi.mock('../pwa/adminServiceWorker', () => ({
  startAdminServiceWorker: adminPwaMocks.startAdminServiceWorker
}));
vi.mock('../pwa/publicRouteWorkerUpdate', () => ({
  updateExistingAdminWorkerOnPublicRoute: adminPwaMocks.updateExistingAdminWorkerOnPublicRoute
}));
vi.mock('../services/devServiceWorkerCleanup', () => ({
  cleanupDevelopmentServiceWorkers: vi.fn().mockResolvedValue(true)
}));
vi.mock('../services/db/databaseRuntime', () => runtimeMocks);
vi.mock('../services/Logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));
vi.mock('../App.jsx', () => {
  readyImportMocks.appLoaded = true;
  return { default: () => <div>ADMIN_APP</div> };
});
vi.mock('../services/sync/posSyncBootstrapAutoCoordinator', () => {
  readyImportMocks.posSyncLoaded = true;
  return {
    startPosSyncAutoBootstrap: readyImportMocks.startPosSyncAutoBootstrap
  };
});

import {
  DATABASE_RECOVERY_STATUS,
  clearDatabaseRecoveryState,
  setDatabaseRecoveryState
} from '../services/db/databaseRecoveryState';
import { resetPosApplicationBootstrapForTests } from '../components/common/PosApplicationBootstrap';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  rootMocks.roots.length = 0;
  readyImportMocks.appLoaded = false;
  readyImportMocks.posSyncLoaded = false;
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();

  runtimeMocks.prepareLocalDatabase.mockImplementation(() => {
    setDatabaseRecoveryState({
      status: DATABASE_RECOVERY_STATUS.CHECKING,
      databaseName: 'LanzoDB1',
      affectedStores: [],
      existingKeyPaths: {},
      expectedKeyPaths: {},
      isRetryable: true,
      requiresMigration: false
    });

    queueMicrotask(() => {
      setDatabaseRecoveryState({
        status: DATABASE_RECOVERY_STATUS.RECOVERY_REQUIRED,
        errorCode: 'DB_BLOCKED',
        databaseName: 'LanzoDB1',
        affectedStores: [],
        existingKeyPaths: {},
        expectedKeyPaths: {},
        isRetryable: true,
        requiresMigration: false
      });
    });

    return new Promise(() => {});
  });
});

afterEach(() => {
  rootMocks.roots.forEach((root) => root.unmount());
  rootMocks.roots.length = 0;
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
  document.body.innerHTML = '';
});

describe('main administrative initial recovery bootstrap', () => {
  it('creates one root and displays DB_BLOCKED before loading App, Router or POS Sync', async () => {
    await import('../main.jsx');

    expect(await screen.findByRole('heading', {
      name: /cierra las demás pestañas de lanzo/i
    })).toBeInTheDocument();

    await waitFor(() => expect(rootMocks.createRoot).toHaveBeenCalledTimes(1));
    expect(document.getElementById('root').textContent.trim()).not.toBe('');
    expect(runtimeMocks.prepareLocalDatabase).toHaveBeenCalledTimes(1);
    expect(readyImportMocks.appLoaded).toBe(false);
    expect(readyImportMocks.posSyncLoaded).toBe(false);
    expect(readyImportMocks.startPosSyncAutoBootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText(/^No se pudo iniciar Lanzo POS$/i)).not.toBeInTheDocument();
  });
});
