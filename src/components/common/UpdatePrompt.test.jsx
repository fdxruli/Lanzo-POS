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
  },
}));

vi.mock('../../pwa/adminServiceWorker', () => ({
  activateAdminServiceWorkerUpdate: worker.activate,
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
    };
    useAppStore.setState({
      updateAvailable: false,
      showUpdateModal: false,
      isUpdating: false,
    });
  });

  afterEach(() => cleanup());

  it('shows the administrative prompt when the coordinator reports a waiting worker', () => {
    render(<UpdatePrompt />);

    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));

    expect(screen.getByText('Nueva version disponible')).toBeInTheDocument();
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
    expect(screen.getByText('Nueva version disponible')).toBeInTheDocument();

    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: false,
      active: true,
      error: false,
    }));

    expect(useAppStore.getState().updateAvailable).toBe(false);
    expect(screen.queryByText('Nueva version disponible')).not.toBeInTheDocument();
  });

  it('dismisses the UI for the current session without activating the worker', () => {
    render(<UpdatePrompt />);
    act(() => worker.listener({
      registered: true,
      installing: false,
      waiting: true,
      active: true,
      error: false,
    }));

    fireEvent.click(screen.getByRole('button', { name: /cerrar notificacion/i }));

    expect(sessionStorage.getItem('lanzo_update_dismissed')).toBe('true');
    expect(worker.activate).not.toHaveBeenCalled();
    expect(screen.queryByText('Nueva version disponible')).not.toBeInTheDocument();
  });
});
