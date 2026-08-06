// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
