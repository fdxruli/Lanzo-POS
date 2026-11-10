// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  access: { isAdmin: true, actorId: 'admin-a', actorKey: 'admin:admin-a', generation: 1 },
  admin: { id: 'admin-a', display_name: 'María López', username: 'maria.admin' },
  current: vi.fn(),
  capture: vi.fn(),
  status: vi.fn(),
  request: vi.fn(),
  change: vi.fn(),
  confirm: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ currentAdminUser: mocks.admin })
}));
vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => mocks.access,
  useSettingsActionGuard: () => mocks.capture
}));
vi.mock('../../../services/auth/adminRecoveryService', async (original) => ({
  ...await original(),
  getRecoveryContact: mocks.status,
  requestRecoveryContact: mocks.request,
  requestRecoveryContactChange: mocks.change,
  confirmRecoveryContact: mocks.confirm
}));

import RecoveryContactSettings from '../RecoveryContactSettings';

let originalShowModal;
let originalClose;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access = { isAdmin: true, actorId: 'admin-a', actorKey: 'admin:admin-a', generation: 1 };
  mocks.admin = { id: 'admin-a', display_name: 'María López', username: 'maria.admin' };
  mocks.capture.mockReturnValue({ assertCurrent: mocks.current });
  mocks.status.mockResolvedValue({ success: true, contact: null, pending: null, pending_change: null });
});
afterEach(() => {
  cleanup();
  if (originalShowModal !== undefined) HTMLDialogElement.prototype.showModal = originalShowModal;
  if (originalClose !== undefined) HTMLDialogElement.prototype.close = originalClose;
  originalShowModal = undefined;
  originalClose = undefined;
});

describe('mobile-first administrative recovery', () => {
  it('shows the authenticated admin identity exactly once and never substitutes the business name', async () => {
    render(<RecoveryContactSettings licenseKey="FREE" />);
    expect(screen.getByText('María López')).toBeInTheDocument();
    expect(screen.getAllByText('María López')).toHaveLength(1);
    expect(screen.getByText('@maria.admin')).toBeInTheDocument();
    expect(screen.getByText('Información solo de consulta')).toBeInTheDocument();
    expect(screen.queryByText('Negocio de prueba')).not.toBeInTheDocument();
    await screen.findByText('Sin vincular');
  });

  it('shows neutral fallbacks when authenticated identity fields are missing', async () => {
    mocks.admin = { id: 'admin-a', display_name: '', username: null };
    render(<RecoveryContactSettings licenseKey="FREE" />);
    expect(screen.getByText('Nombre no disponible')).toBeInTheDocument();
    expect(screen.getByText('No disponible')).toBeInTheDocument();
  });

  it('never displays prior admin identity or recovery email on actor handoff', async () => {
    mocks.status.mockResolvedValueOnce({ success: true, contact: { email: 'old@example.com' } })
      .mockResolvedValue({ success: true, contact: { email: 'new@example.com' } });
    const view = render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(await screen.findByText('old@example.com')).toBeInTheDocument();

    mocks.admin = { id: 'admin-b', display_name: 'Nuevo Admin', username: 'new.admin' };
    mocks.access = { isAdmin: true, actorId: 'admin-b', actorKey: 'admin:admin-b', generation: 2 };
    view.rerender(<RecoveryContactSettings licenseKey="PRO" />);
    expect(screen.queryByText('María López')).not.toBeInTheDocument();
    expect(screen.queryByText('old@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Nuevo Admin')).toBeInTheDocument();
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
  });

  it('does not render or fetch administrative recovery for Staff', async () => {
    mocks.access = { isAdmin: false, actorId: 'staff-1', actorKey: 'staff:staff-1', generation: 2 };
    const view = render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(view.container).toBeEmptyDOMElement();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('displays a verified email only once and keeps request fields collapsed', async () => {
    mocks.status.mockResolvedValue({ success: true, contact: { email: 'verified@example.com', verified_at: '2026-11-01' } });
    render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(await screen.findByText('verified@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('verified@example.com')).toHaveLength(1);
    expect(screen.getByText('Verificado')).toBeInTheDocument();
    expect(screen.getByText('Solicitar cambio de correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña administrativa actual')).not.toBeVisible();
  });

  it('enrolls without persisting secrets and displays the server request reference', async () => {
    mocks.request.mockResolvedValue({ success: true });
    render(<RecoveryContactSettings licenseKey="FREE" />);
    fireEvent.change(await screen.findByLabelText('Correo que quieres verificar'), {
      target: { value: 'owner@example.com' }
    });
    fireEvent.change(screen.getByLabelText('Contraseña administrativa actual'), {
      target: { value: 'Original123' }
    });
    mocks.status.mockResolvedValue({ success: true, pending: { request_id: 'server-request-reference', email: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar vinculación' }));
    expect(await screen.findByText('server-request-reference')).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('FREE', 'owner@example.com', 'Original123');
    expect(screen.getByLabelText('Contraseña administrativa actual')).not.toBeVisible();
  });

  it('restores pending verification and confirms the supplied code with the existing service', async () => {
    mocks.status.mockResolvedValueOnce({
      success: true, pending: { request_id: 'pending-123', email: 'owner@example.com' }
    });
    mocks.confirm.mockResolvedValue({ success: true });
    render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(await screen.findByText('pending-123')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código de verificación del correo'), {
      target: { value: 'received-code' }
    });
    mocks.status.mockResolvedValue({
      success: true, contact: { email: 'owner@example.com' }, pending: null
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
    expect(await screen.findByText('Verificado')).toBeInTheDocument();
    expect(mocks.confirm).toHaveBeenCalledWith('PRO', 'received-code');
    expect(screen.queryByLabelText('Código de verificación del correo')).not.toBeInTheDocument();
  });

  it('retains the option to correct a pending email and renew the request', async () => {
    mocks.status.mockResolvedValue({
      success: true, pending: { request_id: 'pending-456', email: 'wrong@example.com' }
    });
    render(<RecoveryContactSettings licenseKey="FREE" />);
    fireEvent.click(await screen.findByText('Corregir correo o renovar solicitud'));
    expect(screen.getByLabelText('Correo que quieres verificar')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña administrativa actual')).toBeInTheDocument();
  });

  it('opens a secure change request without replacing the verified contact immediately', async () => {
    mocks.status.mockResolvedValue({ success: true, contact: { email: 'old@example.com' } });
    mocks.change.mockResolvedValue({ success: true, case_id: 'case-789' });
    render(<RecoveryContactSettings licenseKey="PRO" />);
    fireEvent.click(await screen.findByText('Solicitar cambio de correo'));
    fireEvent.change(screen.getByLabelText('Correo que quieres verificar'), {
      target: { value: 'replacement@example.com' }
    });
    fireEvent.change(screen.getByLabelText('Contraseña administrativa actual'), {
      target: { value: 'Original123' }
    });
    mocks.status.mockResolvedValue({
      success: true,
      contact: { email: 'old@example.com' },
      pending_change: { case_id: 'case-789', email: 'replacement@example.com', state: 'open' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud de cambio' }));
    expect(await screen.findByText('case-789')).toBeInTheDocument();
    expect(screen.getAllByText('old@example.com')).toHaveLength(1);
    expect(mocks.change).toHaveBeenCalledWith('PRO', 'replacement@example.com', 'Original123');
    expect(screen.queryByLabelText('Contraseña administrativa actual')).not.toBeInTheDocument();
  });

  it('shows a blocked review and its reference without offering a bypass even with no current contact', async () => {
    mocks.status.mockResolvedValue({
      success: true, contact: null,
      pending_change: { case_id: 'existing-case', email: 'proposed@example.com', state: 'blocked' }
    });
    render(<RecoveryContactSettings licenseKey="FREE" />);
    expect(await screen.findByText('existing-case')).toBeInTheDocument();
    expect(screen.getByText('Cambio en revisión')).toBeInTheDocument();
    expect(screen.getByText(/Revisión detenida/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña administrativa actual')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar vinculación' })).not.toBeInTheDocument();
  });

  it('refreshes status without writing or changing account information', async () => {
    render(<RecoveryContactSettings licenseKey="FREE" />);
    await screen.findByText('Sin vincular');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('shows user-facing connectivity errors', async () => {
    mocks.status.mockResolvedValue({ success: false, code: 'ONLINE_REQUIRED' });
    render(<RecoveryContactSettings licenseKey="FREE" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Necesitas conexión a internet');
  });

  it('discards old async recovery status when the actor guard reports stale authority', async () => {
    let resolve;
    mocks.status.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<RecoveryContactSettings licenseKey="PRO" />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
    mocks.current.mockImplementationOnce(() => { throw new Error('stale'); });
    resolve({ success: true, contact: { email: 'previous-owner@example.com' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar estado' })).toBeEnabled());
    expect(screen.queryByText('previous-owner@example.com')).not.toBeInTheDocument();
  });

  it('keeps long identity and email values in wrapping containers', async () => {
    mocks.admin.display_name = 'Nombre administrativo extremadamente largo que debe ajustarse al viewport';
    mocks.admin.username = 'usuario-administrativo-extraordinariamente-largo';
    mocks.status.mockResolvedValue({ success: true, contact: { email: 'address-with-a-very-long-local-part@example-long-domain.test' } });
    render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(screen.getByText(mocks.admin.display_name)).toHaveClass('recovery-settings__name');
    expect(screen.getByText('@' + mocks.admin.username)).toBeInTheDocument();
    expect(await screen.findByText('address-with-a-very-long-local-part@example-long-domain.test')).toHaveClass('recovery-settings__email');
  });

  it('opens support as a native overlay, closes on Escape and restores trigger focus', async () => {
    originalShowModal = HTMLDialogElement.prototype.showModal;
    originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
      this.querySelector('button')?.focus();
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };

    render(<RecoveryContactSettings licenseKey="FREE" />);
    const trigger = screen.getByRole('button', { name: 'Soporte' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Soporte LANZO' });
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    expect(dialog).toHaveTextContent('Elige cómo contactar a soporte. No compartas contraseñas ni datos sensibles.');
    expect(dialog).toHaveTextContent('lanzocontacto@gmail.com');
    expect(dialog).toHaveTextContent('LanzoPOS_Oficial');
    expect(screen.getByRole('button', { name: 'Cerrar soporte' })).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Soporte LANZO' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
