// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductFormV2 from '../ProductFormV2';

const renderForm = (props = {}) => render(<ProductFormV2 activeRubroContext="abarrotes" categories={[]} features={{ hasExpiry: true }} onSave={() => true} onCancel={() => {}} {...props} />);

afterEach(cleanup);

describe('ProductFormV2', () => {
  it('renders main fields and hides only inventory fields when stock control is disabled', () => {
    renderForm();
    expect(screen.getByLabelText(/Nombre del producto/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Existencia inicial/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Controlar inventario/i }));
    expect(screen.queryByLabelText(/Existencia inicial/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre del producto/i)).toBeInTheDocument();
  });

  it('opens and closes compact accordions with ARIA state', () => {
    renderForm();
    const specific = screen.getByRole('button', { name: /Forma de venta y abastecimiento/i });
    expect(specific).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(specific);
    expect(specific).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: /Forma de venta/i })).toBeInTheDocument();
  });

  it('passes the V2 save-and-add-another intent and keeps the form open', async () => {
    const onSave = vi.fn(() => ({ success: true, message: 'Guardado sin navegar.' }));
    renderForm({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Segundo producto' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar y agregar otro/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][2]).toMatchObject({ intent: 'save_and_add_another', keepFormOpen: true, source: 'product-form-v2' });
    expect(screen.getByRole('status')).toHaveTextContent(/Guardado sin navegar/i);
    expect(screen.getByLabelText(/Nombre del producto/i)).toHaveValue('');
  });

  it('does not submit the same product twice while a save is pending', async () => {
    let resolveSave;
    const onSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    renderForm({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Sin duplicados' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '25' } });

    const saveButton = screen.getByRole('button', { name: /Guardar producto/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    resolveSave(true);
  });
});
