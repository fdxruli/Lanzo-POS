// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return {
    useAppStore: create((set) => ({
      appStatus: 'ready',
      isIOS: false,
      isInstallable: true,
      isStandalone: false,
      deferredPrompt: { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) },
      showInstallModal: false,
      isInstalling: false,
      showUpdateModal: false,
      pendingTermsUpdate: null,
      isStorageCritical: false,
      setInstallContext: ({ isIOS = false, isStandalone = false }) => set((state) => ({
        isIOS,
        isStandalone,
        isInstallable: !isStandalone && (Boolean(state.deferredPrompt) || isIOS),
      })),
      setDeferredPrompt: (deferredPrompt) => set((state) => ({
        deferredPrompt,
        isInstallable: !state.isStandalone && (Boolean(deferredPrompt) || state.isIOS),
      })),
      openInstallModal: () => set({ showInstallModal: true }),
      closeInstallModal: () => set({ showInstallModal: false }),
      requestInstall: vi.fn(),
      markInstalled: () => set({
        deferredPrompt: null,
        isInstallable: false,
        isStandalone: true,
        showInstallModal: false,
      }),
    }))
  };
});

import { useAppStore } from '../../store/useAppStore';
import InstallPrompt from './InstallPrompt';
import {
  INSTALL_ENGAGEMENT_STORAGE_KEY,
  INSTALL_ENGAGEMENT_THRESHOLD_MS,
} from '../../utils/installPromptPolicy';

const makePrompt = () => ({
  prompt: vi.fn(),
  userChoice: Promise.resolve({ outcome: 'dismissed' }),
});

const baseState = () => ({
  appStatus: 'ready',
  isIOS: false,
  isInstallable: true,
  isStandalone: false,
  deferredPrompt: makePrompt(),
  showInstallModal: false,
  isInstalling: false,
  showUpdateModal: false,
  pendingTermsUpdate: null,
  isStorageCritical: false,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'));
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  useAppStore.setState({ ...baseState(), showInstallModal: false });
  window.deferredPwaPrompt = useAppStore.getState().deferredPrompt;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.deferredPwaPrompt;
});

const advanceActiveTime = (milliseconds) => act(() => {
  vi.advanceTimersByTime(milliseconds);
});

describe('InstallPrompt', () => {
  it('does not appear immediately when the app becomes ready', () => {
    render(<InstallPrompt />);

    expect(screen.queryByTestId('install-prompt')).toBeNull();
    expect(localStorage.getItem(INSTALL_ENGAGEMENT_STORAGE_KEY)).toContain('activeTimeMs');
  });

  it('appears after five minutes of visible active time', () => {
    render(<InstallPrompt />);

    advanceActiveTime(INSTALL_ENGAGEMENT_THRESHOLD_MS - 1000);
    expect(screen.queryByTestId('install-prompt')).toBeNull();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId('install-prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar ahora' })).toBeInTheDocument();
  });

  it('does not count hidden-tab time', () => {
    render(<InstallPrompt />);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    advanceActiveTime(INSTALL_ENGAGEMENT_THRESHOLD_MS);

    expect(screen.queryByTestId('install-prompt')).toBeNull();
    expect(JSON.parse(localStorage.getItem(INSTALL_ENGAGEMENT_STORAGE_KEY)).invitationEnabled).toBe(false);
  });

  it('keeps dismissed prompts from returning immediately', () => {
    localStorage.setItem(INSTALL_ENGAGEMENT_STORAGE_KEY, JSON.stringify({
      activeTimeMs: INSTALL_ENGAGEMENT_THRESHOLD_MS,
      invitationEnabled: true,
    }));
    render(<InstallPrompt />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso de instalacion' }));
    expect(screen.queryByTestId('install-prompt')).toBeNull();

    useAppStore.setState({ showInstallModal: true });
    expect(screen.queryByTestId('install-prompt')).toBeNull();
    expect(localStorage.getItem('lanzo_install_dismissed')).toBe('true');
  });

  it.each([
    ['standalone', { isStandalone: true, isInstallable: false }],
    ['without a deferred prompt', { deferredPrompt: null, isInstallable: false }],
    ['while an update is active', { showUpdateModal: true }],
  ])('does not appear %s', (_caseName, state) => {
    render(<InstallPrompt />);
    useAppStore.setState(state);
    advanceActiveTime(INSTALL_ENGAGEMENT_THRESHOLD_MS);

    expect(screen.queryByTestId('install-prompt')).toBeNull();
  });

  it('cancels the invitation when the app is installed before the threshold', () => {
    render(<InstallPrompt />);
    advanceActiveTime(60_000);

    act(() => window.dispatchEvent(new Event('appinstalled')));

    advanceActiveTime(INSTALL_ENGAGEMENT_THRESHOLD_MS);
    expect(screen.queryByTestId('install-prompt')).toBeNull();
    expect(useAppStore.getState().isStandalone).toBe(true);
    expect(useAppStore.getState().isInstallable).toBe(false);
  });

  it('continues persisted engagement after a refresh', () => {
    const firstView = render(<InstallPrompt />);
    advanceActiveTime(60_000);
    firstView.unmount();

    render(<InstallPrompt />);
    advanceActiveTime(INSTALL_ENGAGEMENT_THRESHOLD_MS - 60_000 + 1000);

    expect(JSON.parse(localStorage.getItem(INSTALL_ENGAGEMENT_STORAGE_KEY)).invitationEnabled).toBe(true);
  });
});
