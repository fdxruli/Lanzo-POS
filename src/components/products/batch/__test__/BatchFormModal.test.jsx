// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BatchFormModal from '../BatchFormModal';
import { useBatchFormController } from '../hooks/useBatchFormController';

vi.mock('../hooks/useBatchFormController', () => ({ useBatchFormController: vi.fn() }));
vi.mock('../../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: ({ onDismiss }) => onDismiss
}));

const values = {
  cost: '12', price: '25', stock: '10', notes: '', expiryDate: '', sku: '',
  attribute1: '', attribute2: '', location: '', pagadoDeCaja: false, supplier: '',
  updateGlobalPrice: false, manufacturerBatchId: '', pao: ''
};

const renderModal = (product, controller = {}, batchToEdit = null) => {
  const setFieldValue = vi.fn();
  const startProductPriceEditing = vi.fn();
  const cancelProductPriceEditing = vi.fn();
  useBatchFormController.mockReturnValue({
    formValues: values,
    isEditing: false,
    firstInputRef: { current: null },
    tallaInputRef: { current: null },
    setFieldValue,
    isProductPriceEditing: false,
    startProductPriceEditing,
    cancelProductPriceEditing,
    handleProcessSave: vi.fn(),
    ...controller
  });
  render(<BatchFormModal product={product} batchToEdit={batchToEdit} onClose={() => {}} onSave={() => {}} features={{ hasVariants: product.hasVariants === true }} menu={[]} rubroGroup="retail" />);
  return { setFieldValue, startProductPriceEditing, cancelProductPriceEditing };
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BatchFormModal commercial pricing UX', () => {
  it('keeps cost editable and makes product sale price informational for a physical batch', () => {
    const { setFieldValue, startProductPriceEditing } = renderModal({ id: 'med-1', name: 'Medicamento', price: 20, batchManagement: { enabled: true } });

    fireEvent.change(screen.getByLabelText(/Costo de este lote/i), { target: { value: '13' } });
    expect(setFieldValue).toHaveBeenCalledWith('cost', '13');
    expect(screen.queryByRole('spinbutton', { name: /Precio de Venta$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Precio de venta del producto/i)).toHaveTextContent('$20.00');
    fireEvent.click(screen.getByRole('button', { name: /Cambiar precio/i }));
    expect(startProductPriceEditing).toHaveBeenCalledOnce();
  });

  it('muestra el cambio de precio inline y permite cancelarlo', () => {
    const { cancelProductPriceEditing } = renderModal(
      { id: 'med-1', name: 'Medicamento', price: 20, batchManagement: { enabled: true } },
      { formValues: { ...values, price: '24.50' }, isProductPriceEditing: true }
    );

    expect(screen.getByRole('spinbutton', { name: /Nuevo precio de venta/i })).toHaveValue(24.5);
    expect(screen.getByText('$20.00 → $24.50')).toBeInTheDocument();
    expect(screen.getByText(/no solamente este lote/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar cambio/i }));
    expect(cancelProductPriceEditing).toHaveBeenCalledOnce();
  });

  it('keeps cost and sale price editable for a commercial variant', () => {
    const { setFieldValue } = renderModal({ id: 'shirt-1', name: 'Playera', price: 200, hasVariants: true, rubroContext: 'apparel', batchManagement: { enabled: true } });

    fireEvent.change(screen.getByRole('spinbutton', { name: /Precio de Venta$/i }), { target: { value: '220' } });
    expect(screen.getByLabelText(/Costo unitario/i)).toBeInTheDocument();
    expect(setFieldValue).toHaveBeenCalledWith('price', '220');
  });

  it('scopes the safe-area modal treatment and accessible title to Apparel variants', () => {
    renderModal({ id: 'shirt-1', name: 'Playera', price: 200, hasVariants: true, rubroContext: 'apparel' });

    const dialog = screen.getByRole('dialog', { name: 'Registrar Variante' });
    expect(dialog).toHaveClass('batch-form-modal-overlay--apparel');
    expect(dialog.querySelector('.batch-modal-wrapper')).toHaveClass('batch-modal-wrapper--apparel');
  });

  it('keeps the shared lot dialog presentation for other rubros', () => {
    renderModal({ id: 'grocery-1', name: 'Arroz', price: 30, batchManagement: { enabled: true } });

    const dialog = screen.getByRole('dialog', { name: 'Registrar lote' });
    expect(dialog).not.toHaveClass('batch-form-modal-overlay--apparel');
    expect(dialog.querySelector('.batch-modal-wrapper')).not.toHaveClass('batch-modal-wrapper--apparel');
  });

  it('uses the Apparel edit title while preserving the existing edit action', () => {
    renderModal(
      { id: 'shirt-1', name: 'Playera', price: 200, hasVariants: true, rubroContext: 'apparel' },
      { isEditing: true },
      { id: 'variant-1' }
    );

    expect(screen.getByRole('dialog', { name: 'Editar Variante' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Actualizar/i })).toBeInTheDocument();
  });

  it('keeps new medicine lots at zero and warns that expired identity is unavailable for sale', () => {
    renderModal({
      id: 'medicine-vi', name: 'Medicamento VI', price: 20, expirationMode: 'STRICT',
      batchManagement: { enabled: true },
      metadata: { pharmacy: { kind: 'medicine', status: 'confirmed', fraction: 'VI' } }
    }, { formValues: { ...values, stock: '0', expiryDate: '2000-01-01', manufacturerBatchId: 'VI-HIST-001' } });

    expect(screen.getByRole('spinbutton', { name: /Existencia del lote/i })).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: /Existencia del lote/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/solo puede conservarse como identidad histórica con cero unidades/i);
    expect(screen.getByRole('status')).toHaveTextContent(/No estará disponible para venta/i);
  });
});
