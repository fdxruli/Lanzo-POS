// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  access: { isAdmin: true }, current: vi.fn(), capture: vi.fn(), status: vi.fn(), request: vi.fn(), confirm: vi.fn()
}));
vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => mocks.access, useSettingsActionGuard: () => mocks.capture
}));
vi.mock('../../../services/auth/adminRecoveryService', async (original) => ({
  ...await original(), getRecoveryContact: mocks.status, requestRecoveryContact: mocks.request, confirmRecoveryContact: mocks.confirm
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
    expect(screen.queryByLabelText('Correo que quieres verificar')).not.toBeInTheDocument();
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
