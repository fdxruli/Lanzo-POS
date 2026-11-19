// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SaleCancellationModal from '../SaleCancellationModal';
import { salesCloudCancellationService } from '../../../services/salesCloud/salesCloudCancellationService';

vi.mock('../../../services/salesCloud/salesCloudCancellationService', () => ({
  salesCloudCancellationService: { previewCloudSaleCancellation: vi.fn() }
}));

describe('SaleCancellationModal sale references', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  const props = (sale) => ({
    show: true,
    sale: { items: [], ...sale },
    actorHandle: { assertCurrent: vi.fn() },
    allowWaste: false,
    isSubmitting: false,
    onClose: vi.fn(),
    onConfirm: vi.fn()
  });

  it('shows the operational folio and uses a neutral fallback without one', () => {
    const { rerender } = render(<SaleCancellationModal {...props({
      id: 'sale-internal-uuid', folio: 'V-000048', posFolio: 'FG-01-000048'
    })} />);
    expect(screen.getByRole('heading', { name: 'Cancelar venta FG-01-000048' })).toBeInTheDocument();

    rerender(<SaleCancellationModal {...props({ id: 'sale-internal-uuid' })} />);
    expect(screen.getByRole('heading', { name: 'Cancelar venta sin folio' })).toBeInTheDocument();
    expect(screen.queryByText('sale-internal-uuid')).not.toBeInTheDocument();
  });

  const preview = salesCloudCancellationService.previewCloudSaleCancellation;
  const cloudSale = (id) => ({ id, sourceMode: 'cloud_committed', inventoryEffectStatus: 'applied' });
  const response = (id, inventoryRequired = true) => ({
    success: true, can_cancel: true, sale: { id, total: 100 },
    preview: {
      cash: { required: true, reversal_amount: 40 },
      inventory: { required: inventoryRequired, return_quantity: 1 },
      credit: { required: true, reversal_amount: 60, debt_before: 100, debt_after_preview: 40 }
    }
  });

  it('waits for the server before showing effects or accepting form submissions', async () => {
    const pending = Promise.withResolvers();
    preview.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response('A'));
    const view = props(cloudSale('A'));
    render(<SaleCancellationModal {...view} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText(/Motivo de cancelación/), { target: { value: 'Duplicada' } });
    expect(screen.getByRole('status')).toHaveTextContent('Validando caja, inventario y crédito…');
    expect(screen.queryByText('Inventario', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validando...' })).toBeDisabled();
    fireEvent.submit(dialog);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(view.onConfirm).not.toHaveBeenCalled();

    await act(() => pending.resolve(response('A')));
    expect(screen.getByText('1 unidad(es)')).toBeInTheDocument();
    expect(screen.getByText('$40.00 a revertir')).toBeInTheDocument();
    expect(screen.getByText('$60.00 a revertir')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación cloud' })).toBeEnabled();
    await act(() => fireEvent.submit(dialog));
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'Duplicada' }));
    expect(view.onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['error de red', () => Promise.reject(new Error('Red no disponible')), 'Red no disponible'],
    ['denegación', () => Promise.resolve({ success: false, can_cancel: false, message: 'Permiso insuficiente' }), 'Permiso insuficiente'],
    ['respuesta incompleta', () => Promise.resolve({ success: true, can_cancel: true, sale: { id: 'A' } }), 'No se pudo validar la cancelación Cloud.'],
    ['venta incorrecta', () => Promise.resolve(response('B')), 'No se pudo validar la cancelación Cloud.']
  ])('bloquea la ejecución ante %s', async (_scenario, load, message) => {
    preview.mockImplementationOnce(load);
    const view = props(cloudSale('A'));
    render(<SaleCancellationModal {...view} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Inventario', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación cloud' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('dialog'));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(view.onConfirm).not.toHaveBeenCalled();
  });

  it('ignores an old sale preview and shows No requerido for the current sale', async () => {
    const old = Promise.withResolvers();
    preview.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('B', false));
    const view = props(cloudSale('A'));
    const { rerender } = render(<SaleCancellationModal {...view} />);
    rerender(<SaleCancellationModal {...view} show={false} />);
    rerender(<SaleCancellationModal {...view} sale={cloudSale('B')} />);
    expect(await screen.findByText('No requerido', { exact: true })).toBeInTheDocument();
    await act(() => old.resolve(response('A')));
    expect(screen.queryByText('1 unidad(es)')).not.toBeInTheDocument();
  });

  it('discards the final validation after a sale or session change', async () => {
    const old = Promise.withResolvers();
    preview.mockResolvedValueOnce(response('A')).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response('B', false));
    const view = props(cloudSale('A'));
    const { rerender } = render(<SaleCancellationModal {...view} />);
    await screen.findByText('1 unidad(es)');
    fireEvent.change(screen.getByLabelText(/Motivo de cancelación/), { target: { value: 'Duplicada' } });
    fireEvent.submit(screen.getByRole('dialog'));
    rerender(<SaleCancellationModal {...props(cloudSale('B'))} />);
    expect(await screen.findByText('No requerido', { exact: true })).toBeInTheDocument();
    await act(() => old.resolve(response('A')));
    expect(view.onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('1 unidad(es)')).not.toBeInTheDocument();
  });

});
