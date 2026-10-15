// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      updateAvailable: false,
      isUpdating: false,
      runUpdate: vi.fn()
    }))
  }
}));

vi.mock('../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

vi.mock('lucide-react', () => {
  const Icon = ({ size: _size, ...props }) => React.createElement('svg', props);
  return {
    Mail: Icon,
    RefreshCw: Icon,
    AlertTriangle: Icon,
    ShieldCheck: Icon,
    Store: Icon,
    ArrowRightCircle: Icon,
    Copy: Icon,
    CheckCheck: Icon,
    Wifi: Icon,
    WifiOff: Icon
  };
});

import ErrorBoundary from '../components/common/ErrorBoundary';
import Logger from '../services/Logger';
import { useAppStore } from '../store/useAppStore';

function Bomb({ error }) {
  throw error;
}

function ConditionalBomb({ error, shouldThrow }) {
  if (shouldThrow) throw error;
  return <p data-testid="safe-child">Sección recuperada</p>;
}

const renderWithError = (error, props = {}, path = '/') => {
  window.history.replaceState({}, '', `${path}?access_token=query-secret`);
  const boundaryRef = React.createRef();
  const result = render(
    <ErrorBoundary {...props} ref={boundaryRef}>
      <Bomb error={error} />
    </ErrorBoundary>
  );
  return { ...result, boundaryRef };
};

let originalCacheDescriptor;
let originalServiceWorkerDescriptor;
let originalOnlineDescriptor;
let originalClipboardDescriptor;
let originalUserAgentDescriptor;

beforeEach(() => {
  originalCacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Logger.error.mockClear();
  useAppStore.getState.mockReturnValue({
    updateAvailable: false,
    isUpdating: false,
    runUpdate: vi.fn()
  });
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  const restoreDescriptor = (object, key, descriptor) => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else delete object[key];
  };
  restoreDescriptor(globalThis, 'caches', originalCacheDescriptor);
  restoreDescriptor(navigator, 'serviceWorker', originalServiceWorkerDescriptor);
  restoreDescriptor(navigator, 'onLine', originalOnlineDescriptor);
  restoreDescriptor(navigator, 'clipboard', originalClipboardDescriptor);
  restoreDescriptor(navigator, 'userAgent', originalUserAgentDescriptor);
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its child when there is no error', () => {
    render(<ErrorBoundary><p>POS disponible</p></ErrorBoundary>);
    expect(screen.getByText('POS disponible')).toBeInTheDocument();
  });

  it('catches React render errors and shows a safe incident classification', () => {
    renderWithError(Object.assign(new TypeError('Cannot read properties of null'), { code: 'DB_OPEN_TIMEOUT' }));

    expect(screen.getAllByText('DB_OPEN_TIMEOUT')).toHaveLength(2);
    expect(screen.getByText(/Almacenamiento local/)).toBeInTheDocument();
    expect(screen.getByText(/Gravedad: section_failure/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Cannot read properties of null');
  });

  it('does not render sensitive error, cause, URL, business, license, or device details', () => {
    localStorage.setItem('lanzo_device_id', 'device-identifier-123456');
    const error = new Error('license_key=LNZ-FULL-SECRET customer=Ana Lopez total=9876.50');
    error.cause = new Error('token=jwt-secret');
    error.stack = 'Error: https://lanzo.test/caja?access_token=stack-secret';

    renderWithError(error, {}, '/clientes/Ana-Lopez');
    const renderedText = document.body.textContent;

    expect(renderedText).not.toContain('LNZ-FULL-SECRET');
    expect(renderedText).not.toContain('device-identifier-123456');
    expect(renderedText).not.toContain('Ana Lopez');
    expect(renderedText).not.toContain('Ana-Lopez');
    expect(renderedText).not.toContain('9876.50');
    expect(renderedText).not.toContain('jwt-secret');
    expect(renderedText).not.toContain('access_token');
    expect(renderedText).not.toContain('stack-secret');
  });

  it('logs only an allowlisted incident summary', () => {
    const error = new Error('token=jwt-secret');
    error.stack = 'at /private/route?key=secret';
    renderWithError(error);

    expect(Logger.error).toHaveBeenCalledWith('Error de interfaz capturado.', expect.objectContaining({
      code: 'INCIDENT_REACT_RENDER',
      category: 'react_render',
      severity: 'section_failure',
      errorType: 'Error'
    }));
    const logged = JSON.stringify(Logger.error.mock.calls);
    expect(logged).not.toContain('jwt-secret');
    expect(logged).not.toContain('/private/route');
  });

  it('copies a safe diagnostic without including the raw message or query parameters', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderWithError(Object.assign(new Error('license_key=LNZ-FULL-SECRET'), { code: 'DB_OPEN_TIMEOUT' }));

    fireEvent.click(screen.getByRole('button', { name: /Copiar reporte completo/i }));
    await act(async () => Promise.resolve());

    expect(writeText).toHaveBeenCalledOnce();
    const report = writeText.mock.calls[0][0];
    expect(report).toContain('DB_OPEN_TIMEOUT');
    expect(report).toContain('Almacenamiento local');
    expect(report).not.toContain('LNZ-FULL-SECRET');
    expect(report).not.toContain('access_token');
  });

  it('preserves browser storage when a local render retry fails and stops repeated retries', () => {
    window.sessionStorage.setItem('lanzo:authorized-session', 'keep-session');
    window.localStorage.setItem('lanzo:active-orders-storage', 'keep-orders');
    const error = new Error('same render failure');
    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /Intentar recuperar/i }));
    rerender(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    expect(window.sessionStorage.getItem('lanzo:authorized-session')).toBe('keep-session');
    expect(window.localStorage.getItem('lanzo:active-orders-storage')).toBe('keep-orders');
    expect(screen.getByRole('button', { name: /Intentar recuperar/i })).toBeDisabled();
  });

  it('allows a successful section retry without clearing saved state', () => {
    window.sessionStorage.setItem('lanzo:flow-state', 'preserve');
    const error = new Error('temporary section failure');
    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow />
      </ErrorBoundary>
    );

    rerender(
      <ErrorBoundary>
        <ConditionalBomb error={error} shouldThrow={false} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: /Intentar recuperar/i }));

    expect(screen.getByTestId('safe-child')).toHaveTextContent('Sección recuperada');
    expect(window.sessionStorage.getItem('lanzo:flow-state')).toBe('preserve');
  });

  it('blocks render recovery when the actor or tenant context became stale', () => {
    const createRecoveryContextGuard = vi.fn(() => () => false);
    renderWithError(new Error('stale section failure'), { createRecoveryContextGuard });

    fireEvent.click(screen.getByRole('button', { name: /Intentar recuperar/i }));

    expect(createRecoveryContextGuard).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Intentar recuperar/i })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/La sesión o el tenant cambió/i);
    expect(document.body.textContent).toContain('No se pudo mostrar esta sección');
  });

  it('reloads only through the explicit action and does not clear cache or update workers', () => {
    const reloadPage = vi.fn();
    const cacheDelete = vi.fn();
    const workerUpdate = vi.fn();
    globalThis.caches = { keys: vi.fn(), delete: cacheDelete };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => [{ update: workerUpdate }]) }
    });

    renderWithError(new Error('render failure'), { reloadPage });
    fireEvent.click(screen.getByRole('button', { name: /Recargar página/i }));

    expect(reloadPage).toHaveBeenCalledOnce();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(workerUpdate).not.toHaveBeenCalled();
  });

  it('does not force a PWA update when there is no confirmed update', () => {
    const runUpdate = vi.fn();
    useAppStore.getState.mockReturnValue({ updateAvailable: false, isUpdating: false, runUpdate });
    renderWithError(new Error('render failure'));

    expect(screen.queryByRole('button', { name: /Actualizar aplicación/i })).not.toBeInTheDocument();
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('deduplicates an explicit PWA update and does not fall back to cache deletion', async () => {
    let resolveUpdate;
    const runUpdate = vi.fn(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const cacheDelete = vi.fn();
    globalThis.caches = { keys: vi.fn(), delete: cacheDelete };
    useAppStore.getState.mockReturnValue({ updateAvailable: true, isUpdating: false, runUpdate });
    renderWithError(new Error('render failure'));

    const updateButton = screen.getByRole('button', { name: /Actualizar aplicación/i });
    fireEvent.click(updateButton);
    fireEvent.click(updateButton);
    await act(async () => Promise.resolve());

    expect(runUpdate).toHaveBeenCalledOnce();
    resolveUpdate();
    await act(async () => Promise.resolve());
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('routes to POS without clearing session or tenant storage', () => {
    const navigateToPos = vi.fn();
    window.sessionStorage.setItem('lanzo:authorized-session', 'keep');
    window.localStorage.setItem('lanzo:active-orders-storage', 'keep');
    renderWithError(new Error('section failure'), { navigateToPos }, '/ventas');

    fireEvent.click(screen.getByRole('button', { name: /Ir al Punto de Venta ahora/i }));

    expect(navigateToPos).toHaveBeenCalledWith('/');
    expect(window.sessionStorage.getItem('lanzo:authorized-session')).toBe('keep');
    expect(window.localStorage.getItem('lanzo:active-orders-storage')).toBe('keep');
  });

  it('does not render raw error details when offline', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const error = new Error('Failed to fetch private customer details');
    renderWithError(error);

    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private customer details');
  });

  it('keeps technical summaries bounded to allowlisted report fields', () => {
    const error = new Error('customer=Ana Lopez total=9876.50 license_key=LNZ-PRIVATE-123 token=jwt-secret');
    error.code = 'DB_OPEN_TIMEOUT';
    error.cause = new Error('phone=5551234567 email=ana@example.com');
    error.stack = 'Error: https://lanzo.test/ventas/private?access_token=stack-secret';
    const { boundaryRef } = renderWithError(error, {}, '/ventas/private-customer-id');
    const report = boundaryRef.current._buildReportMessage();

    expect(report).toContain('REPORTE TÉCNICO DE INCIDENCIA - LANZO POS');
    expect(report).toContain('Código de incidencia: DB_OPEN_TIMEOUT');
    expect(report).toContain('Clasificación: Almacenamiento local');
    expect(report).toContain('Gravedad: section_failure');
    expect(report).toContain('Tipo técnico: Error');
    expect(report).toContain('Sección: /ventas');
    expect(report).toContain('Conectividad: Online');
    expect(report).toContain('Fecha y hora:');
    expect(report).not.toContain('Ana Lopez');
    expect(report).not.toContain('private-customer-id');
    expect(report).not.toContain('9876.50');
    expect(report).not.toContain('LNZ-PRIVATE-123');
    expect(report).not.toContain('jwt-secret');
    expect(report).not.toContain('5551234567');
    expect(report).not.toContain('ana@example.com');
    expect(report).not.toContain('stack-secret');
  });

  it('does not serialize unknown codes, URL parameters, causes, or stack frames', () => {
    const error = new Error('Unexpected customer=private-name');
    error.code = 'secret-token-value-123456';
    error.cause = new Error('license_key=full-license-value');
    error.stack = 'Error at https://lanzo.test/caja?key=customer-secret';
    const { boundaryRef } = renderWithError(error, {}, '/ruta-con-identificador-123');
    const report = boundaryRef.current._buildReportMessage();

    expect(report).toContain('Código de incidencia: INCIDENT_REACT_RENDER');
    expect(report).toContain('Clasificación: Render de interfaz');
    expect(report).toContain('Gravedad: section_failure');
    expect(report).toContain('Sección: otra sección');
    expect(report).not.toContain('secret-token-value');
    expect(report).not.toContain('full-license-value');
    expect(report).not.toContain('customer-secret');
    expect(report).not.toContain('private-name');
    expect(report).not.toContain('ruta-con-identificador');
    expect(report).not.toContain('https://');
  });

  it('logs a timestamp and scalar incident fields without attaching Error objects', () => {
    const error = Object.assign(new TypeError('private detail'), { code: 'DB_BLOCKED' });
    renderWithError(error);

    const logged = Logger.error.mock.calls[0][1];
    expect(Logger.error).toHaveBeenCalledOnce();
    expect(logged.code).toBe('DB_BLOCKED');
    expect(logged.category).toBe('indexeddb');
    expect(logged.severity).toBe('section_failure');
    expect(logged.errorType).toBe('TypeError');
    expect(logged.componentStackAvailable).toBe(true);
    expect(Number.isNaN(new Date(logged.timestamp).getTime())).toBe(false);
    expect(Object.values(logged).join(' ')).not.toContain('private detail');
    expect(Object.keys(logged)).toEqual([
      'timestamp', 'code', 'category', 'severity', 'errorType', 'componentStackAvailable'
    ]);
  });

  it('uses safe fallback metadata when an error has no useful message or a custom name', () => {
    const error = new Error();
    error.name = 'CustomerTokenError';
    const { boundaryRef } = renderWithError(error);
    const report = boundaryRef.current._buildReportMessage();

    expect(screen.getByText(/No se pudo mostrar esta sección/)).toBeInTheDocument();
    expect(screen.getAllByText('INCIDENT_REACT_RENDER')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('CustomerTokenError');
    expect(report).toContain('Tipo técnico: Error');
    expect(report).toContain('Clasificación: Render de interfaz');
    expect(report.length).toBeLessThan(1_500);
  });

  it('keeps very long stack traces out of the user interface and copied report', async () => {
    const error = new Error('deep recursion customer private-data');
    error.stack = `Error: ${error.message}\n${' at internal/private/path\n'.repeat(250)}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderWithError(error);

    fireEvent.click(screen.getByRole('button', { name: /Copiar reporte completo/i }));
    await act(async () => Promise.resolve());

    const report = writeText.mock.calls[0][0];
    expect(screen.getByText(/El detalle interno se excluyó/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('deep recursion customer-private-data');
    expect(report).not.toContain('internal/private/path');
    expect(report).not.toContain('deep recursion customer');
    expect(report.length).toBeLessThan(1_500);
  });

  it('copies the safe report and shows a temporary copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { boundaryRef } = renderWithError(Object.assign(new Error('private'), { code: 'SYNC_PUSH_FAILED' }));

    fireEvent.click(screen.getByRole('button', { name: /Copiar reporte completo/i }));
    await act(async () => Promise.resolve());

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('Código de incidencia: SYNC_PUSH_FAILED');
    expect(writeText.mock.calls[0][0]).toContain('Clasificación: Sincronización');
    expect(writeText.mock.calls[0][0]).not.toContain('private');
    expect(screen.getByText(/¡Copiado!/)).toBeInTheDocument();
    expect(boundaryRef.current.state.copied).toBe(true);
  });

  it('restores the copy button label after its timeout', async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) }
      });
      renderWithError(new Error('copy timer'));
      fireEvent.click(screen.getByRole('button', { name: /Copiar reporte completo/i }));
      await act(async () => Promise.resolve());

      expect(screen.getByText(/¡Copiado!/)).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(3_100));
      expect(screen.queryByText(/¡Copiado!/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copiar reporte completo/i })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('stack');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the panel usable when clipboard access is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('permission denied')) }
    });
    renderWithError(new Error('clipboard issue'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copiar reporte completo/i }));
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar reporte completo/i })).toBeInTheDocument();
    expect(screen.queryByText(/¡Copiado!/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('permission denied');
  });

  it('offers a route back to POS only away from the POS root', () => {
    renderWithError(new Error('section failure'), {}, '/reportes/secret?access_token=query-secret');
    expect(screen.getByRole('button', { name: /Ir al Punto de Venta ahora/i })).toBeInTheDocument();
    expect(screen.getByText(/Evita regresar a esta sección/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('query-secret');
  });

  it('does not offer a route change when the POS root itself fails', () => {
    renderWithError(new Error('pos failure'), {}, '/');
    expect(screen.queryByRole('button', { name: /Ir al Punto de Venta ahora/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recargar página/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Intentar recuperar/i })).toBeInTheDocument();
  });

  it('does not claim that records or pending financial outcomes are confirmed safe', () => {
    renderWithError(Object.assign(new Error('payment result ambiguous'), { code: 'FINANCIAL_RESULT_UNKNOWN' }));
    const visible = document.body.textContent;

    expect(visible).toContain('Revisa el resultado de cualquier cobro pendiente');
    expect(visible).not.toMatch(/tus datos de ventas y caja están seguros/i);
    expect(visible).not.toMatch(/el cobro se completó correctamente/i);
    expect(visible).toContain('critical_blocker');
    expect(visible).not.toContain('payment result ambiguous');
  });

  it('does not show an update action while offline or when no update function exists', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const runUpdate = vi.fn();
    useAppStore.getState.mockReturnValue({ updateAvailable: true, isUpdating: false, runUpdate });
    renderWithError(new Error('offline section failure'));

    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actualizar aplicación/i })).not.toBeInTheDocument();
    expect(runUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Recargar página/i })).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('reports a failed PWA update once and prevents duplicate update attempts', async () => {
    const runUpdate = vi.fn().mockRejectedValue(new Error('worker activation failed'));
    useAppStore.getState.mockReturnValue({ updateAvailable: true, isUpdating: false, runUpdate });
    renderWithError(new Error('render failure'));

    const updateButton = screen.getByRole('button', { name: /Actualizar aplicación/i });
    fireEvent.click(updateButton);
    await act(async () => Promise.resolve());

    expect(runUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(/No se pudo confirmar la actualización/);
    expect(screen.getByRole('button', { name: /Actualizar aplicación/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Actualizar aplicación/i }));
    expect(runUpdate).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('worker activation failed');
    expect(window.localStorage.length).toBe(0);
  });

  it('reports an update action that resolves without applying the new worker', async () => {
    const runUpdate = vi.fn().mockResolvedValue(undefined);
    useAppStore.getState.mockReturnValue({ updateAvailable: true, isUpdating: false, runUpdate });
    renderWithError(new Error('render failure'));

    fireEvent.click(screen.getByRole('button', { name: /Actualizar aplicación/i }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/No se pudo confirmar la actualización/);
    });

    expect(runUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Actualizar aplicación/i })).toBeDisabled();
    expect(document.body.textContent).not.toContain('PWA_UPDATE_NOT_APPLIED');
  });

  it('disables updates already running in the app store', () => {
    const runUpdate = vi.fn();
    useAppStore.getState.mockReturnValue({ updateAvailable: true, isUpdating: true, runUpdate });
    renderWithError(new Error('render failure'));

    expect(screen.getByRole('button', { name: /Actualizando aplicación/i })).toBeDisabled();
    expect(runUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/Hay una actualización disponible/)).toBeInTheDocument();
  });

  it('uses a bounded browser summary and connection label in its footer and report', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36'
    });
    const { boundaryRef } = renderWithError(new Error('browser diagnostic'));
    const report = boundaryRef.current._buildReportMessage();

    expect(screen.getByText(/Lanzo POS System v/)).toBeInTheDocument();
    expect(report).toContain('Navegador: Chrome 126');
    expect(report).toContain('Conectividad: Online');
    expect(report).not.toContain('Windows NT');
    expect(report).not.toContain('Safari/537');
  });
});
