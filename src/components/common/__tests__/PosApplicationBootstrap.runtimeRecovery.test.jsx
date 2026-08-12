// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  setDatabaseRecoveryState
} from '../../../services/db/databaseRecoveryState';

const setReadyRecoveryState = () => setDatabaseRecoveryState({
  status: DATABASE_RECOVERY_STATUS.READY,
  databaseName: 'LanzoDB1',
  affectedStores: [],
  existingKeyPaths: {},
  expectedKeyPaths: {},
  isRetryable: true,
  requiresMigration: false
});

const renderReadyBootstrap = ({
  loadReadyRuntime,
  recoverStartup = vi.fn(),
  completeStartupRecovery = vi.fn()
}) => {
  const databaseRuntime = {
    prepareLocalDatabase: vi.fn(async () => {
      setReadyRecoveryState();
      return { ready: true };
    })
  };

  return {
    ...render(
      <PosApplicationBootstrap
        databaseRuntime={databaseRuntime}
        cleanupDevelopmentServiceWorkers={vi.fn().mockResolvedValue(true)}
        loadReadyRuntime={loadReadyRuntime}
        recoverStartup={recoverStartup}
        completeStartupRecovery={completeStartupRecovery}
      />
    ),
    completeStartupRecovery,
    databaseRuntime,
    recoverStartup
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
});

afterEach(() => {
  cleanup();
  resetPosApplicationBootstrapForTests();
  clearDatabaseRecoveryState();
});

describe('PosApplicationBootstrap ready runtime recovery', () => {
  it('completes startup recovery only after the full administrative runtime loads', async () => {
    const ReadyApplication = () => <div data-testid="admin-app">ADMIN_APP</div>;
    const activate = vi.fn();
    const loadReadyRuntime = vi.fn().mockResolvedValue({
      ReadyApplication,
      activate
    });
    const completeStartupRecovery = vi.fn();
    const recoverStartup = vi.fn();

    renderReadyBootstrap({
      loadReadyRuntime,
      recoverStartup,
      completeStartupRecovery
    });

    expect(await screen.findByTestId('admin-app')).toBeInTheDocument();
    expect(loadReadyRuntime).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(completeStartupRecovery).toHaveBeenCalledTimes(1);
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it('recovers a stale second-stage chunk automatically and retries forcefully from the button', async () => {
    const chunkError = new TypeError(
      'Failed to fetch dynamically imported module: https://lanzo-pos.vercel.app/assets/App-old.js'
    );
    const loadReadyRuntime = vi.fn().mockRejectedValue(chunkError);
    const recoverStartup = vi.fn()
      .mockResolvedValueOnce({ status: 'already-attempted' })
      .mockResolvedValueOnce({ status: 'reloading' });
    const completeStartupRecovery = vi.fn();

    renderReadyBootstrap({
      loadReadyRuntime,
      recoverStartup,
      completeStartupRecovery
    });

    await waitFor(() => expect(recoverStartup).toHaveBeenCalledWith({ error: chunkError }));
    expect(completeStartupRecovery).not.toHaveBeenCalled();

    const retryButton = await screen.findByRole('button', {
      name: /actualizar lanzo pos/i
    });
    fireEvent.click(retryButton);

    await waitFor(() => expect(recoverStartup).toHaveBeenLastCalledWith({
      error: chunkError,
      force: true
    }));
    expect(screen.getByRole('heading', {
      name: /actualizando lanzo pos/i
    })).toBeInTheDocument();
  });
});
