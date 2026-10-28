// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ showMessageModal: vi.fn() }));

vi.mock('../../../services/utils', () => ({
  showMessageModal: (...args) => mocks.showMessageModal(...args)
}));

import CustomerForm from '../CustomerForm';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const fillName = async (user, name = 'Cliente de prueba') => {
  await user.type(screen.getByLabelText('Nombre Completo *'), name);
};

describe('CustomerForm required phone', () => {
  it('blocks an empty phone and focuses the required field', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CustomerForm onSave={onSave} onCancel={vi.fn()} />);
    await fillName(user);
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El teléfono es obligatorio.');
    expect(screen.getByLabelText('Teléfono *')).toHaveFocus();
    expect(screen.getByLabelText('Teléfono *')).toBeRequired();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks spaces and content that has no normalizable digits', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CustomerForm onSave={onSave} onCancel={vi.fn()} />);
    await fillName(user);
    const phone = screen.getByLabelText('Teléfono *');

    await user.type(phone, '   ');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El teléfono es obligatorio.');
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(phone);
    await user.type(phone, '---()');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('al menos un dígito');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts a normalized phone without enforcing a fixed digit count', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ success: true });
    render(<CustomerForm onSave={onSave} onCancel={vi.fn()} />);
    await fillName(user);
    await user.type(screen.getByLabelText('Teléfono *'), '55');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phone: '55' })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a phone when editing a historical customer with no phone', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<CustomerForm
      onSave={onSave}
      onCancel={vi.fn()}
      customerToEdit={{ id: 'legacy', name: 'Cliente antiguo', phone: '', debt: 42, creditLimit: 100 }}
    />);
    const phone = screen.getByLabelText('Teléfono *');
    expect(phone).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Guardar Cliente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El teléfono es obligatorio.');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Limite de Credito ($)')).toHaveValue(100);
  });

  it('keeps captured data after a persistence error and blocks duplicate submissions', async () => {
    const user = userEvent.setup();
    let resolveSave;
    const onSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<CustomerForm onSave={onSave} onCancel={vi.fn()} />);
    await fillName(user);
    const phone = screen.getByLabelText('Teléfono *');
    await user.type(phone, '5551234567');

    const form = screen.getByRole('button', { name: 'Guardar Cliente' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Nombre Completo *')).toHaveValue('Cliente de prueba');
    expect(phone).toHaveValue('5551234567');

    resolveSave({ success: false, fieldErrors: { phone: 'El teléfono ya está registrado para otro cliente.' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('El teléfono ya está registrado');
    expect(phone).toHaveFocus();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
