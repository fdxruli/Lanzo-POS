// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TELEGRAM_CONTACT_BASE_URL } from '../../../services/support/telegramContact';

const copy = vi.hoisted(() => vi.fn());
vi.mock('../../../services/support/supportContact', async (importOriginal) => ({
  ...await importOriginal(), copyTextToClipboard: copy
}));
import PreloginSupportAccess from '../PreloginSupportAccess';

beforeEach(() => { vi.stubEnv('VITE_SUPPORT_EMAIL', ''); copy.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
const open = () => {
  render(<PreloginSupportAccess screen="Bienvenida" />);
  fireEvent.click(screen.getByRole('button', { name: 'Soporte' }));
};

describe('prelogin official support', () => {
  it('uses the configured email with a visible fallback and a bounded draft', () => {
    open();
    expect(screen.getByText('lanzocontacto@gmail.com')).toBeVisible();
    const url = new URL(screen.getByRole('link', { name: 'Abrir borrador de correo' }).href);
    expect(url.pathname).toBe('lanzocontacto@gmail.com');
    expect(url.searchParams.get('subject')).toBe('[Soporte LANZO POS] Bienvenida');
    expect(url.searchParams.get('body')).toBe('Hola equipo de LANZO,\n\nNecesito orientación con LANZO POS.\nPantalla: Bienvenida.');
    expect(screen.getByText(/Abrir el borrador no envía el mensaje/)).toBeVisible();
    expect(copy).not.toHaveBeenCalled();
  });

  it('honors the existing email configuration', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'official@example.com');
    open();
    expect(screen.getByText('official@example.com')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Abrir borrador de correo' }).href).toMatch(/^mailto:official@example.com\?/);
  });

  it('opens only the public Telegram reference and explains its limits', () => {
    open();
    const link = screen.getByRole('link', { name: /Abrir canal oficial/ });
    expect(link).toHaveAttribute('href', TELEGRAM_CONTACT_BASE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/No se ha verificado que reciba mensajes privados/)).toBeVisible();
    expect(link.href).not.toContain('share');
  });

  it.each([true, false, 'reject'])('reports clipboard outcome %s without claiming delivery', async (outcome) => {
    if (outcome === 'reject') copy.mockRejectedValue(new Error('denied'));
    else copy.mockResolvedValue(outcome);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar correo' }));
    expect(copy).toHaveBeenCalledWith('lanzocontacto@gmail.com');
    expect(await screen.findByText(outcome === true
      ? 'Correo copiado. Aún no se ha enviado ningún mensaje.'
      : 'No se pudo copiar. Selecciona y copia la dirección visible.')).toBeVisible();
    expect(screen.getByText('lanzocontacto@gmail.com')).toBeVisible();
  });

  it('supports keyboard disclosure, Escape and explicit close with focus return', async () => {
    const user = userEvent.setup();
    render(<PreloginSupportAccess screen="Bienvenida" />);
    const trigger = screen.getByRole('button', { name: 'Soporte' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copiar correo' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'Cerrar soporte' }));
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Soporte oficial de LANZO' })).not.toBeInTheDocument();
  });

  it('provides an accessible native modal presentation for access pages', async () => {
    const user = userEvent.setup();
    const originalShowModal = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
      this.querySelector('button')?.focus();
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };

    render(<PreloginSupportAccess screen="Acceso administrador" modal triggerClassName="auth-page__footer-link" />);
    const trigger = screen.getByRole('button', { name: 'Soporte' });
    expect(trigger).toHaveClass('auth-page__footer-link');
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Soporte LANZO' });
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    expect(dialog).toContainElement(screen.getByRole('region', { name: 'Soporte oficial de LANZO' }));
    expect(screen.getByRole('button', { name: 'Cerrar soporte' })).toHaveFocus();

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    expect(screen.queryByRole('dialog', { name: 'Soporte LANZO' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    HTMLDialogElement.prototype.showModal = originalShowModal;
    HTMLDialogElement.prototype.close = originalClose;
  });
});
