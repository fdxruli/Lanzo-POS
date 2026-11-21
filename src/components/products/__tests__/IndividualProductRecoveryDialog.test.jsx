// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inspectProduct: vi.fn(),
  recoverProduct: vi.fn()
}));

vi.mock('../../../services/products/productIndividualRecoveryService', () => ({
  productIndividualRecoveryService: {
    inspectProduct: mocks.inspectProduct,
    recoverProduct: mocks.recoverProduct
  }
}));

import IndividualProductRecoveryDialog from '../IndividualProductRecoveryDialog';

const product = { id: 'local-product-1', name: 'Algodón QA' };
const report = (canRecover = true) => ({
  success: true,
  canRecover,
  product: {
    id: product.id,
    name: product.name,
    localStatus: 'local',
    active: true,
    stock: 17,
    committedStock: 0,
    trackStock: true,
    pharmacy: { recorded: false, protectedMedicine: false }
  },
  cloud: { product: 'missing' },
  publication: { sourceType: 'local_snapshot', isPublished: true, isAvailable: true },
  batches: [{ id: 'original-batch', label: 'QA-LOTE-ALGODON-1', stock: 17, committedStock: 0, status: 'active', cloudStatus: 'absent' }],
  issues: canRecover ? [] : [{ code: 'PHARMACY_DOCUMENTED_RECEIPT_REQUIRED', message: 'Se requiere recepción documentada.' }]
});

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectProduct.mockResolvedValue(report(true));
  mocks.recoverProduct.mockResolvedValue({
    success: true,
    recovered: true,
    verified: true,
    message: 'Producto y lote verificados en Cloud.'
  });
});

describe('IndividualProductRecoveryDialog', () => {
  it('runs a read-only verification for the exact selected product and shows its original lot', async () => {
    render(<IndividualProductRecoveryDialog product={product} onClose={vi.fn()} />);

    expect(await screen.findByText('QA-LOTE-ALGODON-1')).toBeInTheDocument();
    expect(mocks.inspectProduct).toHaveBeenCalledWith({ productId: 'local-product-1' });
    expect(screen.getByText(/La verificación no escribe datos/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar recuperación' })).toBeInTheDocument();
  });

  it('does not show confirmation when verification reports a blocker', async () => {
    mocks.inspectProduct.mockResolvedValue(report(false));
    render(<IndividualProductRecoveryDialog product={product} onClose={vi.fn()} />);

    expect(await screen.findByText('Se requiere recepción documentada.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar recuperación' })).not.toBeInTheDocument();
    expect(mocks.recoverProduct).not.toHaveBeenCalled();
  });

  it('shows a retryable runtime block and refreshes without starting product recovery', async () => {
    mocks.inspectProduct
      .mockResolvedValueOnce({
        success: false,
        blocked: true,
        retryable: true,
        code: 'TENANT_RUNTIME_NOT_READY',
        product: null,
        batches: [],
        issues: [{
          code: 'TENANT_RUNTIME_NOT_READY',
          message: 'El runtime local no está listo. Reintentar no modifica productos, lotes ni inventario.'
        }]
      })
      .mockResolvedValueOnce(report(false));

    render(<IndividualProductRecoveryDialog product={product} onClose={vi.fn()} />);

    expect(await screen.findByText(/El runtime local no está listo/)).toBeInTheDocument();
    expect(screen.getByText(/Reintentar vuelve a comprobar el negocio/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar verificación' }));

    expect(await screen.findByText('Se requiere recepción documentada.')).toBeInTheDocument();
    expect(mocks.inspectProduct).toHaveBeenCalledTimes(2);
    expect(mocks.recoverProduct).not.toHaveBeenCalled();
  });

  it('shows the actual verified result after explicit confirmation', async () => {
    render(<IndividualProductRecoveryDialog product={product} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Confirmar recuperación' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recuperación' }));

    await waitFor(() => expect(mocks.recoverProduct).toHaveBeenCalledWith({ productId: 'local-product-1' }));
    expect(await screen.findByText('Recuperación verificada')).toBeInTheDocument();
    expect(screen.getByText('Producto y lote verificados en Cloud.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar recuperación' })).not.toBeInTheDocument();
  });
});
