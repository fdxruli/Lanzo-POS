// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ redeem: vi.fn() }));
vi.mock('../../../services/auth/adminRecoveryService', async (original) => ({
  ...await original(), redeemPasswordRecovery: mocks.redeem
}));
import AdminAccountRecovery from '../AdminAccountRecovery';

beforeEach(() => { mocks.redeem.mockReset(); });
afterEach(cleanup);
const fill = (confirmation = 'Newpass123') => {
  fireEvent.change(screen.getByLabelText('Código recibido de soporte'), { target: { value: 'received-code' } });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'Newpass123' } });
  fireEvent.change(screen.getByLabelText('Confirmar nueva contraseña'), { target: { value: confirmation } });
};
describe('owner recovery screen', () => {
  it('reveals the username only after a successful reset and clears secrets', async () => {
    const onRecovered = vi.fn();
    mocks.redeem.mockResolvedValue({ success: true, username: 'original-owner' });
    render(<AdminAccountRecovery licenseKey="FREE" online onBack={vi.fn()} onRecovered={onRecovered} />);
    expect(screen.queryByText('original-owner')).not.toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(await screen.findByText('original-owner')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio de sesión' }));
    expect(onRecovered).toHaveBeenCalledWith('original-owner');
  });
  it('prevents duplicate submissions and navigating away while a reset is pending', async () => {
    let resolve;
    mocks.redeem.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<AdminAccountRecovery licenseKey="PRO" online onBack={vi.fn()} onRecovered={vi.fn()} />);
    fill();
    const button = screen.getByRole('button', { name: 'Guardar nueva contraseña' });
    fireEvent.click(button); fireEvent.submit(button.closest('form'));
    expect(mocks.redeem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Volver al inicio de sesión' })).toBeDisabled();
    resolve({ success: false, code: 'RECOVERY_CODE_INVALID' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto');
  });
  it('checks confirmation locally without spending a code attempt', () => {
    render(<AdminAccountRecovery licenseKey="PRO" online onBack={vi.fn()} onRecovered={vi.fn()} />);
    fill('Different123');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden');
    expect(mocks.redeem).not.toHaveBeenCalled();
  });
  it.each([
    ['RECOVERY_CODE_EXPIRED', 'caducó'], ['RECOVERY_CODE_USED', 'ya fue utilizado'],
    ['RECOVERY_ATTEMPTS_EXHAUSTED', 'cinco intentos'], ['RECOVERY_UNCONFIRMED', 'No pudimos confirmar']
  ])('explains %s without showing private account information', async (code, text) => {
    mocks.redeem.mockResolvedValue({ success: false, code, username: 'private-owner' });
    render(<AdminAccountRecovery licenseKey="PRO" online onBack={vi.fn()} onRecovered={vi.fn()} />);
    fill(); fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByText('private-owner')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Código recibido de soporte')).toHaveValue('received-code');
  });
  it('retains entered data across connection changes', async () => {
    const props = { licenseKey: 'FREE', onBack: vi.fn(), onRecovered: vi.fn() };
    const view = render(<AdminAccountRecovery {...props} online />);
    fill(); view.rerender(<AdminAccountRecovery {...props} online={false} />);
    expect(screen.getByRole('button', { name: 'Guardar nueva contraseña' })).toBeDisabled();
    expect(screen.getByLabelText('Nueva contraseña')).toHaveValue('Newpass123');
    view.rerender(<AdminAccountRecovery {...props} online />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nueva contraseña' })).toBeEnabled());
  });

  it('offers one support dialog action beside the assisted recovery instructions', () => {
    render(<AdminAccountRecovery licenseKey="PRO" online onBack={vi.fn()} onRecovered={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ver opciones de soporte' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Soporte', exact: true })).not.toBeInTheDocument();
  });
});
