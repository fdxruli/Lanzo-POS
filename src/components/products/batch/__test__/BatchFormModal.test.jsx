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

const renderModal = (product) => {
  const setFieldValue = vi.fn();
  useBatchFormController.mockReturnValue({
    formValues: values,
    isEditing: false,
    firstInputRef: { current: null },
    tallaInputRef: { current: null },
    setFieldValue,
    handleProcessSave: vi.fn()
  });
  render(<BatchFormModal product={product} batchToEdit={null} onClose={() => {}} onSave={() => {}} features={{ hasVariants: product.hasVariants === true }} menu={[]} rubroGroup="retail" />);
  return { setFieldValue };
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BatchFormModal commercial pricing UX', () => {
  it('keeps cost editable and makes product sale price informational for a physical batch', () => {
    const { setFieldValue } = renderModal({ id: 'med-1', name: 'Medicamento', price: 20, batchManagement: { enabled: true } });

    fireEvent.change(screen.getByLabelText(/Costo de este lote/i), { target: { value: '13' } });
    expect(setFieldValue).toHaveBeenCalledWith('cost', '13');
    expect(screen.queryByRole('spinbutton', { name: /Precio de Venta$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Precio de venta del producto/i)).toHaveTextContent('$20.00');
    expect(screen.getByText(/se cambia desde/i)).toBeInTheDocument();
  });

  it('keeps cost and sale price editable for a commercial variant', () => {
    const { setFieldValue } = renderModal({ id: 'shirt-1', name: 'Playera', price: 200, hasVariants: true, rubroContext: 'apparel', batchManagement: { enabled: true } });

    fireEvent.change(screen.getByRole('spinbutton', { name: /Precio de Venta$/i }), { target: { value: '220' } });
    expect(screen.getByLabelText(/Costo unitario/i)).toBeInTheDocument();
    expect(setFieldValue).toHaveBeenCalledWith('price', '220');
  });
});
