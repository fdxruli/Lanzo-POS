// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

import DatabaseRecoveryGate from '../DatabaseRecoveryGate';

const renderGate = () => render(
  <DatabaseRecoveryGate>
    <div>APP_CHILDREN</div>
  </DatabaseRecoveryGate>
);

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

  it('shows retry only for recovery_required', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_BLOCKED'
    };

    renderGate();

    expect(screen.queryByText('APP_CHILDREN')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeEnabled();
  });

  it('collapses multiple retry clicks into one recovery call', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_BLOCKED'
    };
    runtimeMocks.retryLocalDatabaseRecovery.mockReturnValue(new Promise(() => {}));

    renderGate();
    const button = screen.getByRole('button', { name: /reintentar recuperación/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(runtimeMocks.retryLocalDatabaseRecovery).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it('mounts children only when ready', () => {
    recoveryMocks.state = { ...recoveryMocks.state, status: 'ready' };

    renderGate();

    expect(screen.getByText('APP_CHILDREN')).toBeInTheDocument();
  });
});
