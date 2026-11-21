// @vitest-environment jsdom

import 'fake-indexeddb/auto';
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
  getLocalDatabaseActivityRevision: vi.fn(() => 0),
  getLocalDatabaseActivitySnapshot: vi.fn(() => ({
    preparationActive: false,
    preflightActive: false,
    nativeOperations: [],
    hasActiveNativeRequest: false,
    hasTimedOutNativeRequest: false,
    migrationActive: false
  })),
  subscribeLocalDatabaseActivity: vi.fn(() => () => {})
}));

const nativeOperationMocks = vi.hoisted(() => ({
  snapshot: Object.freeze([]),
  listeners: new Set(),
  revision: 0,
  activity: {
    preparationActive: false,
    preflightActive: false,
    migrationActive: false
  }
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

runtimeMocks.getLocalDatabaseActivityRevision.mockImplementation(() => nativeOperationMocks.revision);
runtimeMocks.getLocalDatabaseActivitySnapshot.mockImplementation(() => ({
  ...nativeOperationMocks.activity,
  nativeOperations: nativeOperationMocks.snapshot,
  hasActiveNativeRequest: nativeOperationMocks.snapshot.length > 0,
  hasTimedOutNativeRequest: nativeOperationMocks.snapshot.some(operation => operation.state === 'timed_out_waiting_native_settlement')
}));
runtimeMocks.subscribeLocalDatabaseActivity.mockImplementation((listener) => {
  nativeOperationMocks.listeners.add(listener);
  return () => nativeOperationMocks.listeners.delete(listener);
});

import DatabaseRecoveryGate from '../DatabaseRecoveryGate';

const renderGate = (props = {}) => render(
  <DatabaseRecoveryGate {...props}>
    <div>APP_CHILDREN</div>
  </DatabaseRecoveryGate>
);

const openRecoveryDetails = () => {
  fireEvent.click(screen.getByText('Detalles del problema'));
};

const publishNativeOperations = (operations) => {
  nativeOperationMocks.snapshot = Object.freeze(
    operations.map((operation) => Object.freeze({ ...operation }))
  );
  nativeOperationMocks.revision += 1;
  nativeOperationMocks.listeners.forEach((listener) => listener());
};

const publishLocalActivity = (activity) => {
  nativeOperationMocks.activity = { ...nativeOperationMocks.activity, ...activity };
  nativeOperationMocks.revision += 1;
  nativeOperationMocks.listeners.forEach((listener) => listener());
};

const createDbOperationFailure = (overrides = {}) => ({
  ...recoveryMocks.state,
  status: 'failed',
  errorCode: 'DB_OPERATION_FAILED',
  isRetryable: false,
  failure: {
    id: 12,
    phase: 'dexie_open',
    category: 'unknown',
    errorType: 'Error',
    durationMs: 25,
    nativeRequestState: 'none',
    preflightActive: false,
    restartContext: { runtimeGeneration: 1, actorGeneration: 1, actorStatus: 'locked' }
  },
  ...overrides
});

const subscribeRestartSafety = (listener) => {
  nativeOperationMocks.listeners.add(listener);
  return () => nativeOperationMocks.listeners.delete(listener);
};

const openDatabase = (name) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('sales', { keyPath: 'id' });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

beforeEach(() => {
  runtimeMocks.retryLocalDatabaseRecovery.mockReset();
  nativeOperationMocks.revision = 0;
  nativeOperationMocks.activity = {
    preparationActive: false,
    preflightActive: false,
    migrationActive: false
  };
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
    ['migrating', /preparando una actualización de la base local/i],
    ['failed', /recuperación automática no pudo completarse/i]
  ])('does not mount children while status is %s', (status, expectedCopy) => {
    recoveryMocks.state = { ...recoveryMocks.state, status };

    renderGate();

    expect(screen.queryByText('APP_CHILDREN')).not.toBeInTheDocument();
    expect(screen.getByText(expectedCopy)).toBeInTheDocument();
  });

  it('shows only an allowlisted migration phase without row counts or store payloads', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'migrating',
      affectedStores: ['sales', 'customer Ana Lopez'],
      migration: {
        phase: 'backup_complete',
        sourceCounts: { sales: 2, license_key: 'full-license-secret', customer: 'Ana Lopez' },
        targetCounts: { total: 9876.5, token: 'jwt-secret' }
      }
    };

    renderGate();

    expect(screen.getByText(/backup_complete/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Ana Lopez');
    expect(document.body.textContent).not.toContain('full-license-secret');
    expect(document.body.textContent).not.toContain('9876.5');
    expect(document.body.textContent).not.toContain('jwt-secret');
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

  it('offers one normal restart for a safe DB_OPERATION_FAILED without retrying or clearing storage', () => {
    recoveryMocks.state = createDbOperationFailure();
    const reloadPage = vi.fn();
    const getRestartBlockReason = vi.fn(() => null);

    renderGate({ reloadPage, getRestartBlockReason, subscribeRestartSafety });

    expect(screen.queryByText('APP_CHILDREN')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No se pudo comprobar la base local' })).toBeInTheDocument();
    expect(screen.getByText(/puedes reiniciar la aplicación para intentar abrirla nuevamente/i)).toBeInTheDocument();
    expect(screen.getByText(/no borres los datos del navegador/i)).toBeInTheDocument();
    const restartButton = screen.getByRole('button', { name: 'Reiniciar Lanzo' });
    expect(restartButton).toHaveClass('ui-button--primary');
    expect(screen.getByRole('button', { name: 'Copiar diagnóstico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contactar a soporte' })).toBeInTheDocument();

    fireEvent.click(restartButton);
    fireEvent.click(restartButton);

    expect(getRestartBlockReason).toHaveBeenCalledWith(12);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
  });

  it('keeps restart blocked for a live preparation and enables it when that operation settles', () => {
    recoveryMocks.state = createDbOperationFailure();
    publishLocalActivity({ preparationActive: true });
    const reloadPage = vi.fn();
    const getRestartBlockReason = () => (
      nativeOperationMocks.activity.preparationActive ? 'local_database_active' : null
    );

    renderGate({ reloadPage, getRestartBlockReason, subscribeRestartSafety });

    expect(screen.getByText(/todavía existe una operación local en curso/i)).toBeInTheDocument();
    expect(screen.getByText(/solicitud de indexeddb activa o una preparación local en curso/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar diagnóstico' })).toBeInTheDocument();

    act(() => publishLocalActivity({ preparationActive: false }));

    expect(screen.getByRole('button', { name: 'Reiniciar Lanzo' })).toBeEnabled();
    expect(screen.getByText(/puedes reiniciar la aplicación/i)).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('keeps restart blocked when a native IndexedDB request remains active after its public timeout', () => {
    recoveryMocks.state = createDbOperationFailure();
    publishNativeOperations([{
      key: 'LanzoDB_t_secret-business:current',
      state: 'timed_out_waiting_native_settlement'
    }]);
    const getRestartBlockReason = () => (
      nativeOperationMocks.snapshot.length > 0 ? 'local_database_active' : null
    );

    renderGate({ getRestartBlockReason, subscribeRestartSafety });

    expect(screen.getByText(/solicitud de indexeddb activa/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-business');
  });

  it.each([
    ['preflight', 'local_database_active'],
    ['migration', 'local_database_active'],
    ['write transaction', 'write_active'],
    ['checkout', 'checkout_active'],
    ['backup or restore', 'backup_active'],
    ['synchronization', 'sync_active']
  ])('does not allow restart during an active %s', (_label, reason) => {
    recoveryMocks.state = createDbOperationFailure();

    renderGate({ getRestartBlockReason: () => reason, subscribeRestartSafety });

    expect(screen.getByText(/todavía existe una operación local en curso/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar diagnóstico' })).toBeInTheDocument();
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
  });

  it('revalidates activity at the click and blocks a stale safe render', () => {
    recoveryMocks.state = createDbOperationFailure();
    let blockReason = null;
    const reloadPage = vi.fn();

    renderGate({
      reloadPage,
      getRestartBlockReason: () => blockReason,
      subscribeRestartSafety
    });

    blockReason = 'write_active';
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar Lanzo' }));
    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.getByText(/hay cambios locales guardándose/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
  });

  it('fails closed with an explanation when the final safety check throws', () => {
    recoveryMocks.state = createDbOperationFailure();
    let safetyCheckFails = false;
    const reloadPage = vi.fn();

    renderGate({
      reloadPage,
      getRestartBlockReason: () => {
        if (safetyCheckFails) throw new Error('safety check unavailable');
        return null;
      },
      subscribeRestartSafety
    });

    safetyCheckFails = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar Lanzo' }));

    expect(reloadPage).not.toHaveBeenCalled();
    expect(screen.getByText(/no se pudo confirmar que sea seguro reiniciar/i)).toBeInTheDocument();
  });

  it('explains a timed-out preparation without offering retry or reload', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_TIMEOUT',
      isRetryable: false
    };
    publishNativeOperations([{ key: 'LanzoDB_t_pending:current', state: 'opening' }]);

    renderGate();

    expect(screen.getByRole('heading', { name: /apertura de la base local no terminó/i })).toBeInTheDocument();
    expect(screen.getByText(/solicitud de indexeddb activa/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar recuperación|reiniciar lanzo/i })).not.toBeInTheDocument();
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
    openRecoveryDetails();
    expect(screen.getByText(/DB_TIMEOUT/i)).toBeInTheDocument();
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
    expect(screen.getByText(/esta comprobación no ejecutó una limpieza de datos/i)).toBeInTheDocument();
    expect(screen.queryByText(/crear nueva base|restablecer tenant|continuar de todos modos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/LanzoDB1/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reiniciar lanzo/i }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('keeps local sales data after the user chooses a manual reload', async () => {
    const databaseName = `lanzo-reload-preserves-sales-${Date.now()}`;
    const database = await openDatabase(databaseName);
    const sale = { id: 'sale-preserved', total: 1250, status: 'completed' };
    await requestResult(database.transaction('sales', 'readwrite').objectStore('sales').put(sale));
    database.close();

    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'recovery_required',
      errorCode: 'DB_OPEN_TIMEOUT'
    };
    const reloadPage = vi.fn();
    renderGate({ reloadPage });
    fireEvent.click(screen.getByRole('button', { name: /reiniciar lanzo/i }));

    expect(reloadPage).toHaveBeenCalledTimes(1);
    const reopened = await openDatabase(databaseName);
    const persistedSale = await requestResult(reopened.transaction('sales').objectStore('sales').get(sale.id));
    expect(persistedSale).toEqual(sale);
    reopened.close();
    await requestResult(indexedDB.deleteDatabase(databaseName));
  });

  it('does not expose a report action before actor and tenant context is ready', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_OPEN_TIMEOUT'
    };

    renderGate();

    expect(screen.queryByRole('button', { name: 'Reportar problema' })).not.toBeInTheDocument();
    expect(screen.getByText(/Este flujo no elimina la base local/i)).toBeInTheDocument();
    openRecoveryDetails();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reportar problema/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /reiniciar lanzo/i })).not.toBeInTheDocument();

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
    expect(screen.queryByRole('button', { name: /reiniciar lanzo/i })).not.toBeInTheDocument();

    act(() => publishNativeOperations([]));

    expect(screen.getByRole('button', { name: /reintentar recuperación/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /reiniciar lanzo/i })).toBeEnabled();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(runtimeMocks.retryLocalDatabaseRecovery).not.toHaveBeenCalled();
  });

  it('keeps retry blocked without showing a reload action while a native request never settles', () => {
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
    expect(screen.queryByRole('button', { name: /reiniciar lanzo/i })).not.toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
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
    expect(screen.getByText(/la comprobación no pudo abrir la base local/i)).toBeInTheDocument();
    expect(screen.getByText(/no borres los datos de la aplicación/i)).toBeInTheDocument();
    openRecoveryDetails();
    expect(screen.getByText('DB_UNSUPPORTED_NATIVE_VERSION')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('310')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reintentar recuperación/i })).not.toBeInTheDocument();
  });

  it.each([
    'DB_TIMEOUT',
    'DB_UNSUPPORTED_NATIVE_VERSION',
    'DB_PRIMARY_KEY_MISMATCH',
    'DB_CLOSED_AFTER_STRUCTURAL_ERROR',
    'DB_BROWSER_STORAGE_UNAVAILABLE'
  ])('does not expose the DB_OPERATION_FAILED restart for structural state %s', (errorCode) => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode,
      isRetryable: false
    };

    renderGate({ getRestartBlockReason: () => null });

    expect(screen.queryByRole('button', { name: 'Reiniciar Lanzo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abrir correo de soporte/i })).toBeInTheDocument();
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
    openRecoveryDetails();
    fireEvent.click(screen.getByRole('button', { name: /abrir correo de soporte/i }));
    fireEvent.click(screen.getByRole('button', { name: /copiar diagnóstico/i }));

    expect(openSupportMailto).toHaveBeenCalledTimes(1);
    expect(openSupportMailto.mock.calls[0][0]).toContain('subject=%5BSoporte%20Lanzo%20POS%5D%20Recuperaci%C3%B3n%20local%20-%20DB_NOT_INSPECTABLE');
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard.mock.calls[0][0]).toContain('DB_NOT_INSPECTABLE');
    expect(clipboard.mock.calls[0][0]).not.toContain('secret-tenant');
    expect(await screen.findByRole('button', { name: /diagnóstico copiado/i })).toBeInTheDocument();
  });

  it('does not expose raw recovery errors or unknown error codes in the screen or support link', async () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_BROWSER_STORAGE_UNAVAILABLE',
      message: 'license_key=full-license-secret customer=Ana Lopez',
      affectedStores: ['sales:9876.50', 'customer:Ana Lopez'],
      migration: {
        phase: 'token=phase-secret',
        sourceCounts: { sale: { amount: 9876.5 } },
        targetCounts: { customer: 'Ana Lopez' }
      }
    };
    runtimeMocks.retryLocalDatabaseRecovery.mockRejectedValue(
      new Error('license_key=full-license-secret token=jwt-secret customer=Ana Lopez total=9876.50')
    );
    const openSupportMailto = vi.fn();

    renderGate({ openSupportMailto });
    openRecoveryDetails();
    expect(screen.getByText('DB_BROWSER_STORAGE_UNAVAILABLE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /abrir correo de soporte/i }));
    fireEvent.click(screen.getByRole('button', { name: /reintentar recuperación/i }));

    expect(await screen.findByText(/no podemos confirmar el estado final/i)).toBeInTheDocument();
    const renderedText = document.body.textContent;
    const mailto = openSupportMailto.mock.calls[0][0];
    expect(renderedText).not.toContain('full-license-secret');
    expect(renderedText).not.toContain('jwt-secret');
    expect(renderedText).not.toContain('Ana Lopez');
    expect(renderedText).not.toContain('9876.50');
    expect(mailto).not.toContain('full-license-secret');
    expect(mailto).not.toContain('jwt-secret');
    expect(mailto).not.toContain('Ana%20Lopez');
    expect(mailto).not.toContain('9876.50');
  });

  it('replaces unknown recovery codes with a safe incident label', () => {
    recoveryMocks.state = {
      ...recoveryMocks.state,
      status: 'failed',
      errorCode: 'DB_SECRET_token-value'
    };

    renderGate();

    openRecoveryDetails();
    expect(screen.getByText('INCIDENT_INDEXEDDB')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('DB_SECRET_token-value');
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
    openRecoveryDetails();
    expect(screen.getByRole('button', { name: /copiar diagnóstico/i })).toBeEnabled();
    expect(recoveryMocks.state.errorCode).toBe('DB_UNSUPPORTED_NATIVE_VERSION');
  });
});
