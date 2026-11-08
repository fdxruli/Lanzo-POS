// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStableDeviceId: vi.fn(), showMessageModal: vi.fn(), copy: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ handleLogin: vi.fn(), handleFreeTrial: vi.fn() })
}));
vi.mock('../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../services/supabase', () => ({ getStableDeviceId: mocks.getStableDeviceId }));
vi.mock('../../../services/utils', () => ({ showMessageModal: mocks.showMessageModal }));
vi.mock('../../../services/support/supportContact', async (importOriginal) => ({
  ...await importOriginal(), copyTextToClipboard: mocks.copy
}));
import WelcomeModal from '../WelcomeModal';

// jsdom does not provide native dialog methods, so mimic the browser's open state.
const nativeShowModal = HTMLDialogElement.prototype.showModal;
const nativeClose = HTMLDialogElement.prototype.close;

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  cleanup();
  if (nativeShowModal) HTMLDialogElement.prototype.showModal = nativeShowModal;
  else delete HTMLDialogElement.prototype.showModal;
  if (nativeClose) HTMLDialogElement.prototype.close = nativeClose;
  else delete HTMLDialogElement.prototype.close;
});

describe('WelcomeModal shared support', () => {
  it('does not request identity, copy automatically, show a message modal or schedule navigation', async () => {
    render(<WelcomeModal />);
    const timer = vi.spyOn(window, 'setTimeout');
    fireEvent.click(screen.getByRole('button', { name: 'Soporte' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('dialog', { name: 'Soporte LANZO' })).toHaveAttribute('open');
    expect(mocks.getStableDeviceId).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
    const url = new URL(screen.getByRole('link', { name: 'Abrir borrador de correo' }).href);
    expect(url.searchParams.get('body')).toBe('Hola equipo de LANZO,\n\nNecesito orientación con LANZO POS.\nPantalla: Bienvenida.');
  });
});
