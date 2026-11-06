// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UpdateControls from './UpdateControls';
import { resetAdminServiceWorkerUpdateMonitorForTests } from '../../pwa/adminServiceWorkerUpdateMonitor';
import { resetAdminServiceWorkerForTests } from '../../pwa/adminServiceWorker';
import { useAppStore } from '../../store/useAppStore';
import { APP_BUILD_ID } from '../../config/appVersion';

describe('manual update control', () => {
  beforeEach(() => {
    useAppStore.setState({ updateAvailable: false, isUpdating: false, updateError: null });
  });
  afterEach(() => {
    cleanup(); resetAdminServiceWorkerUpdateMonitorForTests(); resetAdminServiceWorkerForTests(); vi.unstubAllGlobals();
  });
  it('is available without a pending update and shows real network success', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      app: 'lanzo-pos', buildId: APP_BUILD_ID, version: '4.0.0', commit: 'qa', builtAt: '2026-11-06T00:00:00Z',
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<UpdateControls />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar actualizaciones' }));
    expect(screen.getByText('Buscando actualizaciones…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar actualizaciones' })).toBeDisabled();
    await waitFor(() => expect(screen.getByText('Tu aplicación está actualizada.')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('shows a failure without claiming the app is current', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    render(<UpdateControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar actualizaciones' }));
    await waitFor(() => expect(screen.getByText('No pudimos comprobar las actualizaciones.')).toBeInTheDocument());
    expect(screen.queryByText('Tu aplicación está actualizada.')).not.toBeInTheDocument();
  });
});
