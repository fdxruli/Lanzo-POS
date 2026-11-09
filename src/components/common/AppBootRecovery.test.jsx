// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  stale: false,
  pending: false,
  check: { status: 'idle' },
  worker: { waiting: false, reloadDeferred: false },
  checkListeners: new Set(),
  workerListeners: new Set(),
  requestCheck: vi.fn(),
  activate: vi.fn(),
  webReload: vi.fn(),
  copy: vi.fn()
}));

vi.mock('../../services/diagnostics/recoveryContext', () => ({
  createRecoveryContextGuard: () => () => !h.stale
}));
vi.mock('../../services/auth/actorOperationalHandoff', () => ({
  getPendingActorOperations: () => h.pending ? [{ label: 'venta' }] : [],
  getActorCheckoutOwnerships: () => []
}));
vi.mock('../../pwa/adminServiceWorkerUpdateMonitor', () => ({
  getAdminUpdateCheckState: () => h.check,
  subscribeAdminUpdateCheck: callback => {
    h.checkListeners.add(callback);
    return () => h.checkListeners.delete(callback);
  },
  requestAdminServiceWorkerUpdateCheck: h.requestCheck
}));
vi.mock('../../pwa/adminServiceWorker', () => ({
  getAdminServiceWorkerState: () => h.worker,
  subscribeAdminServiceWorker: callback => {
    h.workerListeners.add(callback);
    return () => h.workerListeners.delete(callback);
  },
  activateAdminServiceWorkerUpdate: h.activate,
  reloadAdminWebUpdate: h.webReload
}));
vi.mock('../../services/support/supportContact', () => ({
  buildAdminBootSupportReport: () => 'REPORTE_SEGURO',
  buildSupportMailtoUrl: ({ subject }) => `mailto:soporte@example.com?subject=${encodeURIComponent(subject)}`,
  copyTextToClipboard: h.copy
}));

import AppBootRecovery from './AppBootRecovery';

const publishCheck = status => {
  h.check = { status };
  h.checkListeners.forEach(listener => listener());
};

describe('recuperación de inicio de Lanzo POS', () => {
  beforeEach(() => {
    h.pending = false;
    h.stale = false;
    h.check = { status: 'idle' };
    h.worker = { waiting: false, reloadDeferred: false };
    h.checkListeners.clear();
    h.workerListeners.clear();
    vi.clearAllMocks();
    h.requestCheck.mockImplementation(async () => {
      publishCheck('current');
      return { status: 'current' };
    });
    h.copy.mockResolvedValue(true);
  });
  afterEach(() => cleanup());

  it('prioriza el reintento y no comprueba actualizaciones automáticamente', async () => {
    render(<AppBootRecovery />);
    expect(screen.getByRole('button', { name: 'Reintentar inicio' })).toBeEnabled();
    expect(h.requestCheck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar actualización' }));
    await waitFor(() => expect(screen.getByText(/La versión publicada coincide/)).toBeInTheDocument());
    expect(h.requestCheck).toHaveBeenCalledWith({ force: true });
    expect(screen.queryByRole('button', { name: 'Actualizar ahora' })).not.toBeInTheDocument();
  });

  it('permite comprobar versiones con el reinicio bloqueado sin aplicar cambios', async () => {
    h.pending = true;
    h.worker = { waiting: true, reloadDeferred: false };
    h.requestCheck.mockImplementation(async () => {
      publishCheck('available');
      return { status: 'available' };
    });
    render(<AppBootRecovery />);
    expect(screen.getByRole('button', { name: 'Reintentar inicio' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar actualización' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeDisabled());
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.webReload).not.toHaveBeenCalled();
  });

  it('aplica una versión disponible solo por acción explícita y guard seguro', async () => {
    h.worker = { waiting: true, reloadDeferred: false };
    h.activate.mockResolvedValue(true);
    h.requestCheck.mockImplementation(async () => {
      publishCheck('available');
      return { status: 'available' };
    });
    render(<AppBootRecovery />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar actualización' }));
    const apply = await screen.findByRole('button', { name: 'Actualizar ahora' });
    expect(h.activate).not.toHaveBeenCalled();
    fireEvent.click(apply);
    await waitFor(() => expect(h.activate).toHaveBeenCalledOnce());
  });

  it('ofrece diagnóstico seguro y soporte aun sin acceso al POS', async () => {
    h.stale = true;
    render(<AppBootRecovery />);
    expect(screen.getByRole('button', { name: 'Reintentar inicio' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Contactar soporte' })).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
    fireEvent.click(screen.getByText('Ver diagnóstico'));
    expect(screen.getByText('ADMIN_RUNTIME_BOOT_TIMEOUT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith(expect.stringContaining('REPORTE_SEGURO')));
    expect(screen.getByText('Diagnóstico copiado')).toBeInTheDocument();
  });
});
