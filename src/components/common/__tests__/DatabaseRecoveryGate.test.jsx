// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recoveryMocks = vi.hoisted(() => ({
  state: {
    status: 'ready',
    errorCode: null,
    affectedStores: [],
    isRetryable: true,
    requiresMigration: false,
    migration: null
  },
  listeners: new Set()
}));

const runtimeMocks = vi.hoisted(() => ({
  retryLocalDatabaseRecovery: vi.fn(),
  isLocalDatabasePreparationActive: vi.fn(() => false)
}));

const nativeOperationMocks = vi.hoisted(() => ({
  snapshot: Object.freeze([]),
  listeners: new Set()
}));

vi.mock('../../../services/db/databaseRecoveryState', () => ({
  DATABASE_RECOVERY_STATUS: {
    IDLE: 'idle',
    CHECKING: 'checking',
    MIGRATING: 'migrating',
    READY: 'ready',
    RECOVERY_REQUIRED: 'recovery_required',
    FAILED: 'failed'
  },
  getDatabaseRecoveryState: () => recoveryMocks.state,
  subscribeDatabaseRecoveryState: (listener) => {
    recoveryMocks.listeners.add(listener);
    return () => recoveryMocks.listeners.delete(listener);
  }
}));

vi.mock('../../../services/db/databaseRuntime', () => runtimeMocks);
vi.mock('../../../services/db/indexedDbPreflight', () => ({
  getActiveNativeOpenOperations: () => nativeOperationMocks.snapshot,
  subscribeNativeOpenOperations: (listener) => {
    nativeOperationMocks.listeners.add(listener);
    return () => nativeOperationMocks.listeners.delete(listener);
  }
}));

import DatabaseRecoveryGate from '../DatabaseRecoveryGate';

const renderGate = (props = {}) => render(
  <DatabaseRecoveryGate {...props}>
    <div>APP_CHILDREN</div>
  </DatabaseRecoveryGate>
);

const publishNativeOperations = (operations) => {
  nativeOperationMocks.snapshot = Object.freeze(
    operations.map((operation) => Object.freeze({ ...operation }))
  );
  nativeOperationMocks.listeners.forEach((listener) => listener());
};

beforeEach(() => {
  runtimeMocks.retryLocalDatabaseRecovery.mockReset();
  runtimeMocks.isLocalDatabasePreparationActive.mockReturnValue(false);
  recoveryMocks.state = {
    status: 'ready',
    errorCode: null,
    affectedStores: [],
    isRetryable: true,
    requiresMigration: false,
    migration: null
  };
  nativeOperationMocks.snapshot = Object.freeze([]);
  nativeOperationMocks.listeners.clear();
});

afterEach(() => cleanup());

describe('DatabaseRecoveryGate', () => {
  it.each([
    ['idle', /comprobando la base local/i],
    ['checking', /comprobando la base local/i],
    ['migrating', /actualizando la base local/i],
    ['failed', /recuperación automática no pudo completarse/i]
  ])('does not mount children while status is %s', (status, expectedCopy) => {
    recoveryMocks.state = { ...recoveryMocks.state, status };

    renderGate();

    expect(screen.queryByText('APP_CHILDREN')).not.toBeInTheDocument();
    expect(screen.getByText(expectedCopy)).toBeInTheDocument();
  });

  it('shows migration phase and counts while migrating', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'migrating',
      affectedStores: ['sales', 'deleted_sales'],
      migration: {
        phase: 'backup_complete',
        sourceCounts: { sales: 2, deleted_sales: 1 },
        targetCounts: {}
      }
    };

    renderGate();

    expect(screen.getByText(/backup_complete/i)).toBeInTheDocument();
    expect(screen.getByText(/"sales":2/i)).toBeInTheDocument();
  });

  it('keeps DB_BLOCKED instructions without offering a parallel retry', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_BLOCKED'
    };

    renderGate();

    expect(screen.queryByText('APP_CHILDREN')).not.toBeInTheDocument();
    expect(screen.getByText(/cierra las demás pestañas de lanzo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar recuperación/i })).not.toBeInTheDocument();
  });

  it('collapses multiple retry clicks into one recovery call', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_OPEN_TIMEOUT'
    };
    runtimeMocks.retryLocalDatabaseRecovery.mockReturnValue(new Promise(() => {}));

    renderGate();
    const button = screen.getByRole('button', { name: /reintentar recuperación/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(runtimeMocks.retryLocalDatabaseRecovery).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it('reacts when a timed-out native request settles and enables exactly one retry', async () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_OPEN_TIMEOUT'
    };
    publishNativeOperations([{
      key: 'LanzoDB1:current',
      state: 'timed_out_waiting_native_settlement'
    }]);
    runtimeMocks.retryLocalDatabaseRecovery.mockReturnValue(new Promise(() => {}));

    renderGate();

    expect(screen.getByText(/todavía mantiene una solicitud activa/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /recargar lanzo/i })).toBeEnabled();

    act(() => publishNativeOperations([]));

    const retryButton = screen.getByRole('button', { name: /reintentar recuperación/i });
    expect(retryButton).toBeEnabled();
    expect(screen.getByText(/solicitud anterior ya terminó/i)).toBeInTheDocument();
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();

    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(runtimeMocks.retryLocalDatabaseRecovery).toHaveBeenCalledTimes(1);
  });

  it('keeps a safe reload action visible when the native request never settles', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_OPEN_TIMEOUT'
    };
    publishNativeOperations([{
      key: 'LanzoDB1:current',
      state: 'timed_out_waiting_native_settlement'
    }]);

    const reloadPage = vi.fn();
    renderGate({ reloadPage });

    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeDisabled();
    const reloadButton = screen.getByRole('button', { name: /recargar lanzo/i });
    expect(reloadButton).toBeEnabled();
    fireEvent.click(reloadButton);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
  });

  it('uses stable external snapshots under StrictMode without leaking listeners', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_OPEN_TIMEOUT'
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(
      <StrictMode>
        <DatabaseRecoveryGate><div>APP_CHILDREN</div></DatabaseRecoveryGate>
      </StrictMode>
    );

    act(() => {
      publishNativeOperations([{ key: 'LanzoDB1:current', state: 'opening' }]);
      publishNativeOperations([{
        key: 'LanzoDB1:current',
        state: 'timed_out_waiting_native_settlement'
      }]);
      publishNativeOperations([]);
    });

    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeEnabled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
      /Maximum update depth exceeded|cached|snapshot/i
    );
    expect(nativeOperationMocks.listeners.size).toBe(1);
    unmount();
    expect(nativeOperationMocks.listeners.size).toBe(0);
    consoleError.mockRestore();
  });

  it('mounts children only when ready', () => {
    recoveryMocks.state = { ...recoveryMocks.state, status: 'ready' };

    renderGate();

    expect(screen.getByText('APP_CHILDREN')).toBeInTheDocument();
  });
});
