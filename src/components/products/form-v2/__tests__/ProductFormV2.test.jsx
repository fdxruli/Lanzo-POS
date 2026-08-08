// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductFormV2 from '../ProductFormV2';

vi.mock('../../../../services/database', () => ({
  queryBatchesByProductIdAndActive: vi.fn(async () => [])
}));

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

  it('uses canonical sale and purchase unit selects and restores the compact wholesale action', () => {
    renderForm({ features: { hasExpiry: true, hasWholesale: true } });
    fireEvent.click(screen.getByRole('button', { name: /Forma de venta y abastecimiento/i }));

    const saleUnit = screen.getByLabelText(/Unidad de venta/i);
    expect(saleUnit.tagName).toBe('SELECT');
    expect(saleUnit).toHaveValue('pza');
    fireEvent.click(screen.getByRole('button', { name: 'A granel' }));
    expect(saleUnit).toHaveValue('kg');
    fireEvent.click(screen.getByRole('button', { name: 'Fraccionado' }));

    const purchaseUnit = screen.getByLabelText(/Unidad de compra/i);
    expect(purchaseUnit.tagName).toBe('SELECT');
    expect(Array.from(purchaseUnit.options).map((option) => option.value)).toContain('caja');
    expect(screen.getByRole('button', { name: /Configurar mayoreo/i })).toBeInTheDocument();
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

  it('uses the latest batch-confirmed parent version on an apparel partial-save retry', async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({
        partial: true,
        productRebase: { id: 'product-1', serverVersion: 12 },
        appliedVariants: { updated: [], created: [], removed: [] }
      })
      .mockResolvedValueOnce({ success: true });
    renderForm({
      activeRubroContext: 'apparel',
      features: { hasVariants: true },
      productToEdit: { id: 'product-1', name: 'Camisa', cost: 10, price: 20, serverVersion: 10 },
      onSave
    });

    const saveButton = screen.getByRole('button', { name: /Guardar producto/i });
    fireEvent.click(saveButton);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1]).toMatchObject({ serverVersion: 10 });

    fireEvent.click(saveButton);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][1]).toMatchObject({ id: 'product-1', serverVersion: 12 });
  });

  it('uses canonical unit options for restaurant ingredients instead of free text', () => {
    renderForm({ activeRubroContext: 'food_service' });
    fireEvent.click(screen.getByRole('button', { name: /Preparaci.n y venta/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insumo' }));

    const unit = screen.getByLabelText('Unidad');
    expect(unit.tagName).toBe('SELECT');
    expect(Array.from(unit.options).map((option) => option.text)).toEqual([
      'Pieza / unidad', 'Kilogramo (kg)', 'Gramo (g)', 'Litro (L)', 'Mililitro (ml)'
    ]);
    fireEvent.change(unit, { target: { value: 'kg' } });
    expect(unit).toHaveValue('kg');
  });

  it('keeps apparel variant inputs editable after variants are enabled', () => {
    renderForm({ activeRubroContext: 'apparel', features: { hasVariants: true } });
    fireEvent.click(screen.getByRole('button', { name: /Tallas, colores y variantes/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /producto tiene variantes/i }));

    const color = screen.getByPlaceholderText('Color');
    const size = screen.getByPlaceholderText('Talla');
    const stock = screen.getByPlaceholderText('0');
    fireEvent.change(color, { target: { value: 'neg' } });
    fireEvent.change(size, { target: { value: 'M' } });
    fireEvent.change(stock, { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: /Agregar variante manual/i }));
    fireEvent.click(screen.getByRole('button', { name: /Agregar variante manual/i }));
    fireEvent.click(screen.getByRole('button', { name: /Agregar variante manual/i }));
    const colors = screen.getAllByPlaceholderText('Color');
    fireEvent.change(colors[3], { target: { value: 'azul' } });

    expect(color).toHaveValue('neg');
    expect(size).toHaveValue('M');
    expect(stock).toHaveValue(3);
    expect(colors).toHaveLength(4);
    expect(colors[3]).toHaveValue('azul');
  });

  it('shows batch summary instead of initial batch inputs when editing a medicine', () => {
    const onOpenBatches = vi.fn();
    const product = {
      id: 'med-1', name: 'Medicamento', price: 20, cost: 12, stock: 10,
      rubroContext: 'farmacia', expirationMode: 'STRICT', activeSubstance: 'PARACETAMOL',
      laboratory: 'Laboratorio', presentation: 'Caja', prescriptionType: 'otc', requiresPrescription: false
    };
    renderForm({ activeRubroContext: 'farmacia', productToEdit: product, onOpenBatches });

    fireEvent.click(screen.getByRole('button', { name: /Datos farmac/i }));

    expect(screen.getByLabelText(/Inventario por lotes/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Fecha de caducidad inicial/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Lote del fabricante/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Esta configuración se aplicará/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Registrar lote/i }));
    expect(onOpenBatches).toHaveBeenCalledWith(product);
  });
});
