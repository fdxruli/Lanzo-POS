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

  it('shows bounded support recovery for tenant directory corruption without naming LanzoDB1', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'TENANT_DIRECTORY_CORRUPT'
    };
    const reloadPage = vi.fn();

    renderGate({ reloadPage });

    expect(screen.getByText(/almacenamiento local de este tenant no puede abrirse/i)).toBeInTheDocument();
    expect(screen.getByText(/no se eliminó ningún dato local/i)).toBeInTheDocument();
    expect(screen.queryByText(/crear nueva base|restablecer tenant|continuar de todos modos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/LanzoDB1/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /recargar lanzo/i }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
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

  it('keeps timeout recovery actions through ignored late onblocked until native settlement', () => {
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
    const timeoutSnapshot = nativeOperationMocks.snapshot;

    // Un onblocked tardío se ignora en el store nativo: no cambia el snapshot
    // ni sustituye DB_OPEN_TIMEOUT por DB_BLOCKED.
    expect(nativeOperationMocks.snapshot).toBe(timeoutSnapshot);
    expect(screen.getByText(/todavía mantiene una solicitud activa/i)).toBeInTheDocument();
    expect(screen.queryByText(/cierra las demás pestañas de lanzo/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /recargar lanzo/i })).toBeEnabled();

    act(() => publishNativeOperations([]));

    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /recargar lanzo/i })).toBeEnabled();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
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

  it('makes unsupported newer versions actionable without inventing version numbers', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      isRetryable: false,
      detectedNativeVersion: 320,
      expectedNativeVersion: 310
    };

    renderGate();

    expect(screen.getByRole('heading', { name: /esta versión de lanzo no puede abrir tu base local/i })).toBeInTheDocument();
    expect(screen.getByText(/tus datos permanecen guardados/i)).toBeInTheDocument();
    expect(screen.getByText(/no borres los datos de la aplicación/i)).toBeInTheDocument();
    expect(screen.getByText('DB_UNSUPPORTED_NATIVE_VERSION')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('310')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar reporte a soporte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar recuperación/i })).not.toBeInTheDocument();
  });

  it('uses the central mailto report and copies that exact report for every FAILED code', async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_NOT_INSPECTABLE',
      databaseName: 'LanzoDB_t_secret-tenant',
      message: 'No se pudo inspeccionar la base local.'
    };
    const openSupportMailto = vi.fn();

    renderGate({ openSupportMailto });
    fireEvent.click(screen.getByRole('button', { name: /enviar reporte a soporte/i }));
    fireEvent.click(screen.getByRole('button', { name: /copiar diagnóstico/i }));

    expect(openSupportMailto).toHaveBeenCalledTimes(1);
    expect(openSupportMailto.mock.calls[0][0]).toContain('subject=%5BSoporte%20Lanzo%20POS%5D%20Recuperaci%C3%B3n%20local%20-%20DB_NOT_INSPECTABLE');
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard.mock.calls[0][0]).toContain('DB_NOT_INSPECTABLE');
    expect(clipboard.mock.calls[0][0]).not.toContain('secret-tenant');
    expect(await screen.findByRole('button', { name: /diagnóstico copiado/i })).toBeInTheDocument();
  });

  it('keeps copy available offline without changing the recovery code', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_UNSUPPORTED_NATIVE_VERSION',
      isRetryable: false
    };

    renderGate();

    expect(screen.getByText(/estás sin conexión/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeEnabled();
    expect(recoveryMocks.state.errorCode).toBe('DB_UNSUPPORTED_NATIVE_VERSION');
  });
});
