// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import UpdatePrompt from './UpdatePrompt';

const worker = vi.hoisted(() => ({
  activate: vi.fn().mockResolvedValue(true),
  listener: null,
  state: {
    registered: false,
    installing: false,
    waiting: false,
    active: false,
    error: false,
    reloadDeferred: false,
  },
}));

vi.mock('../../pwa/adminServiceWorker', () => ({
  activateAdminServiceWorkerUpdate: worker.activate,
  reloadAdminWebUpdate: worker.activate,
  getAdminServiceWorkerState: () => worker.state,
  subscribeAdminServiceWorker: (listener) => {
    worker.listener = listener;
    return () => { worker.listener = null; };
  },
}));

describe('UpdatePrompt controlled activation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    worker.activate.mockClear();
    worker.state = {
      registered: false,
      installing: false,
      waiting: false,
      active: false,
      error: false,
      reloadDeferred: false,
    };
    useAppStore.setState({
      updateAvailable: false,
      showUpdateModal: false,
      isUpdating: false,
      updateError: null,
      updateId: null,
    });
  });

  afterEach(() => cleanup());

  it('retains the waiting-worker state while the prompt is suppressed on a 404', () => {
    const view = render(<UpdatePrompt isSuppressed />);
    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));

    expect(screen.queryByText('Nueva actualización disponible')).not.toBeInTheDocument();
    view.rerender(<UpdatePrompt />);
    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();
    expect(useAppStore.getState().updateAvailable).toBe(true);
  });

  it('shows the administrative prompt when the coordinator reports a waiting worker', () => {
    render(<UpdatePrompt />);

    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));

    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();
  });

  it('keeps the prompt available when a worker activated in another tab but reload was deferred', () => {
    render(<UpdatePrompt />);

    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: false,
      active: true,
      error: false,
      reloadDeferred: true,
    }));

    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();
    expect(useAppStore.getState().updateAvailable).toBe(true);
  });

  it('activates only after the user presses the update action', async () => {
    render(<UpdatePrompt />);
    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));

    fireEvent.click(screen.getByRole('button', { name: /actualizar ahora/i }));

    expect(worker.activate).toHaveBeenCalledOnce();
  });

  it('closes a stale prompt when an automatic activation is already active', () => {
    render(<UpdatePrompt />);
    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));
    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();

    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: false,
      active: true,
      error: false,
    }));

    expect(useAppStore.getState().updateAvailable).toBe(false);
    expect(screen.queryByText('Nueva actualización disponible')).not.toBeInTheDocument();
  });

  it('postpones only the current notice, permits reopening and notifies a new build', () => {
    render(<UpdatePrompt />);
    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      updateId: 'current-build',
      active: true,
      error: false,
    }));

    fireEvent.click(screen.getByRole('button', { name: /posponer actualización/i }));

    expect(useAppStore.getState().updateAvailable).toBe(true);
    expect(worker.activate).not.toHaveBeenCalled();
    expect(screen.queryByText('Nueva actualización disponible')).not.toBeInTheDocument();
    act(() => useAppStore.getState().openUpdateModal());
    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /más tarde/i }));
    act(() => worker.listener({ waiting: true, updateId: 'next-build' }));
    expect(screen.getByText('Nueva actualización disponible')).toBeInTheDocument();

  });
});
