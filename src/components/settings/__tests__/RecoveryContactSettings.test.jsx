// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  access: { isAdmin: true }, current: vi.fn(), capture: vi.fn(), status: vi.fn(), request: vi.fn(), change: vi.fn(), confirm: vi.fn()
}));
vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => mocks.access, useSettingsActionGuard: () => mocks.capture
}));
vi.mock('../../../services/auth/adminRecoveryService', async (original) => ({
  ...await original(), getRecoveryContact: mocks.status, requestRecoveryContact: mocks.request, requestRecoveryContactChange: mocks.change, confirmRecoveryContact: mocks.confirm
}));
import RecoveryContactSettings from '../RecoveryContactSettings';
beforeEach(() => {
  vi.clearAllMocks(); mocks.access = { isAdmin: true };
  mocks.capture.mockReturnValue({ assertCurrent: mocks.current });
  mocks.status.mockResolvedValue({ success: true, contact: null, pending: null });
});
afterEach(cleanup);

describe('verified recovery contact enrollment', () => {
  it('requires current password and shows the backend request reference for support', async () => {
    mocks.request.mockResolvedValue({ success: true });
    render(<RecoveryContactSettings licenseKey="FREE" />);
    const email = await screen.findByLabelText('Correo que quieres verificar');
    fireEvent.change(email, { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña administrativa actual'), { target: { value: 'Original123' } });
    mocks.status.mockResolvedValue({ success: true, pending: { request_id: 'server-request-reference', email: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar vinculación' }));
    expect(await screen.findByText('server-request-reference')).toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledWith('FREE', 'owner@example.com', 'Original123');
    expect(screen.queryByLabelText('Contraseña administrativa actual')).not.toBeVisible();
  });
  it('restores the pending request after reload and confirms it without local persistence', async () => {
    mocks.status.mockResolvedValueOnce({ success: true, pending: { request_id: 'pending', email: 'owner@example.com' } });
    mocks.confirm.mockResolvedValue({ success: true });
    render(<RecoveryContactSettings licenseKey="PRO" />);
    fireEvent.change(await screen.findByLabelText('Código de verificación del correo'), { target: { value: 'received-code' } });
    mocks.status.mockResolvedValue({ success: true, contact: { email: 'owner@example.com' }, pending: null });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }));
    expect(await screen.findByText('Correo verificado:')).toBeInTheDocument();
    expect(mocks.confirm).toHaveBeenCalledWith('PRO', 'received-code');
    expect(screen.getByLabelText('Correo que quieres verificar')).not.toBeVisible();
  });
  it('does not render or load recovery contacts for Staff', async () => {
    mocks.access = { isAdmin: false };
    const view = render(<RecoveryContactSettings licenseKey="PRO" />);
    expect(view.container).toBeEmptyDOMElement();
    await waitFor(() => expect(mocks.status).not.toHaveBeenCalled());
  });
  it('discards the old owner response after authority changes', async () => {
    let resolve;
    mocks.status.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<RecoveryContactSettings licenseKey="PRO" />);
    await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
    mocks.current.mockImplementationOnce(() => { throw new Error('stale'); });
    resolve({ success: true, contact: { email: 'previous-owner@example.com' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Consultar estado' })).toBeEnabled());
    expect(screen.queryByText('previous-owner@example.com')).not.toBeInTheDocument();
  });
});

it('requests a replacement with password and recovers the case reference without overwriting contact', async () => {
  mocks.status.mockResolvedValue({ success: true, contact: { email: 'old@example.com' } });
  mocks.change.mockResolvedValue({ success: true, case_id: 'case-reference' });
  render(<RecoveryContactSettings licenseKey="PRO" />);
  fireEvent.click(await screen.findByText('Cambiar correo con ayuda de soporte'));
  fireEvent.change(screen.getByLabelText('Correo que quieres verificar'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Contraseña administrativa actual'), { target: { value: 'Original123' } });
  mocks.status.mockResolvedValue({ success: true, contact: { email: 'old@example.com' }, pending_change: { case_id: 'case-reference', email: 'new@example.com', state: 'open' } });
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambio de correo' }));
  expect(await screen.findByText('case-reference')).toBeInTheDocument();
  expect(screen.getByText('old@example.com')).toBeInTheDocument();
  expect(mocks.change).toHaveBeenCalledWith('PRO','new@example.com','Original123');
  expect(screen.queryByLabelText('Contraseña administrativa actual')).not.toBeInTheDocument();
});

it('shows an existing support case instead of initial enrollment when no contact exists', async () => {
  mocks.status.mockResolvedValue({ success:true,contact:null,pending:null,pending_change:{case_id:'existing-case',email:'proposed@example.com',state:'open'} });
  render(<RecoveryContactSettings licenseKey="FREE" />);
  expect(await screen.findByText('existing-case')).toBeInTheDocument();
  expect(screen.queryByLabelText('Contraseña administrativa actual')).not.toBeInTheDocument();
});
