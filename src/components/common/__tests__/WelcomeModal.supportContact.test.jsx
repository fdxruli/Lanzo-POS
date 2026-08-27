// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildSupportMailtoUrl: vi.fn(() => 'mailto:soporte@example.com?subject=Ayuda'),
  copyTextToClipboard: vi.fn(),
  getStableDeviceId: vi.fn(),
  showMessageModal: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    handleLogin: vi.fn(),
    handleFreeTrial: vi.fn()
  })
}));
vi.mock('../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../services/supabase', () => ({ getStableDeviceId: mocks.getStableDeviceId }));
vi.mock('../../../services/utils', () => ({ showMessageModal: mocks.showMessageModal }));
vi.mock('../../../services/support/supportContact', () => ({
  buildSupportMailtoUrl: mocks.buildSupportMailtoUrl,
  copyTextToClipboard: mocks.copyTextToClipboard,
  getSupportEmail: () => 'soporte@example.com'
}));

import WelcomeModal from '../WelcomeModal';

const openSupport = () => {
  render(<WelcomeModal />);
  fireEvent.click(screen.getByRole('button', { name: /necesitas ayuda/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStableDeviceId.mockResolvedValue('device-id');
  mocks.buildSupportMailtoUrl.mockReturnValue('mailto:soporte@example.com?subject=Ayuda');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WelcomeModal support contact', () => {
  it('does not request stable device identity when the welcome screen mounts', async () => {
    render(<WelcomeModal />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.getStableDeviceId).not.toHaveBeenCalled();
  });

  it('shows copy success only when the shared helper returns true', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(true);

    openSupport();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      expect.stringContaining('Correo de soporte copiado: soporte@example.com')
    );
  });

  it('does not claim copy success when the shared helper returns false', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(false);

    openSupport();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      expect.stringContaining('No pudimos copiar el correo automáticamente')
    );
    expect(mocks.showMessageModal).not.toHaveBeenCalledWith(
      expect.stringContaining('Correo de soporte copiado')
    );
  });

  it('still builds the configured support mailto when copy returns false', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(false);

    openSupport();

    expect(mocks.buildSupportMailtoUrl).toHaveBeenCalledWith(expect.objectContaining({
      to: 'soporte@example.com',
      subject: 'Ayuda - No puedo acceder a Lanzo POS'
    }));
  });
});
