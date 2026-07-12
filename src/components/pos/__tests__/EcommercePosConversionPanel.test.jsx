// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ECOMMERCE_CONVERSION_STATUS,
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION
} from '../../../services/ecommerce/ecommercePosCheckoutConversion';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  onCheckout: vi.fn(),
  updateOrder: vi.fn(),
  recover: vi.fn(),
  retry: vi.fn(),
  remote: vi.fn(),
  state: {
    activeOrders: new Map(),
    updateOrder: vi.fn()
  }
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ licenseDetails: { license_key: 'LIC-1' } })
}));

vi.mock('../../../services/ecommerce/ecommercePosConversionService', () => ({
  ECOMMERCE_REMOTE_CONTRACT_PENDING: 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING',
  getEcommercePosConversionRemoteState: (...args) => mocks.remote(...args),
  recoverEcommercePosConversion: (...args) => mocks.recover(...args),
  retryEcommerceConversionConfirmation: (...args) => mocks.retry(...args)
}));

import EcommercePosConversionPanel from '../EcommercePosConversionPanel';

const createOrder = (overrides = {}) => ({
  id: 'ecom-order-1',
  origin: 'ecommerce',
  ecommerceOrderId: 'order-1',
  ecommerceOrderCode: 'EC-0001',
  ecommerceDraftStatus: 'prepared',
  ecommerceInventoryStatus: 'ready',
  ecommerceInventoryResolvedAt: '2026-07-11T20:00:00.000Z',
  ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.IDLE,
  ecommerceRemoteContractVersion: ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
  ecommerceRemoteClaimOwned: true,
  ecommerceRemoteClaimValid: true,
  ecommerceRemoteConversionStatus: 'idle',
  ecommerceRemoteConversionOwned: false,
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.updateOrder = mocks.updateOrder;
  mocks.recover.mockResolvedValue({ success: true, changed: false });
  mocks.retry.mockResolvedValue({ success: true });
  mocks.remote.mockResolvedValue({
    success: true,
    remoteContractVersion: ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION,
    claimOwned: true,
    claimValid: true,
    conversionStatus: 'idle',
    conversionOwned: false,
    convertedSaleId: null
  });
});

describe('EcommercePosConversionPanel', () => {
  it('blocks checkout when inventory requires attention', () => {
    const order = createOrder({ ecommerceInventoryStatus: 'conflict' });
    mocks.state.activeOrders = new Map([[order.id, order]]);

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    expect(screen.getByText('Inventario: Requiere atención')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cobrar pedido' })).toBeDisabled();
    expect(screen.getByText('Resuelve el inventario antes de cobrar.')).toBeInTheDocument();
  });

  it('keeps checkout blocked while the remote conversion contract is pending', () => {
    const order = createOrder({
      ecommerceRemoteContractVersion: 0,
      ecommerceRemoteClaimOwned: false,
      ecommerceRemoteClaimValid: false,
      ecommerceRemoteConversionStatus: 'unknown',
      ecommerceCheckoutGateCode: 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING'
    });
    mocks.state.activeOrders = new Map([[order.id, order]]);
    mocks.remote.mockResolvedValue({
      success: false,
      code: 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING',
      remoteContractVersion: 0,
      message: 'El contrato remoto todavía no está disponible.'
    });

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    expect(screen.getByRole('button', { name: 'Cobrar pedido' })).toBeDisabled();
    expect(screen.getByText(/seguirá bloqueado hasta aplicar y validar el contrato remoto/i)).toBeInTheDocument();
  });

  it('blocks a reservation owned by another device or attempt', () => {
    const order = createOrder({
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceRemoteConversionOwned: false
    });
    mocks.state.activeOrders = new Map([[order.id, order]]);

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    expect(screen.getByRole('button', { name: 'Cobrar pedido' })).toBeDisabled();
    expect(screen.getByText(/procesado por otro dispositivo o intento/i)).toBeInTheDocument();
  });

  it('enables only the controlled checkout for a prepared and remotely idle order', async () => {
    const order = createOrder();
    mocks.state.activeOrders = new Map([[order.id, order]]);

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    const button = screen.getByRole('button', { name: 'Cobrar pedido' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(mocks.onCheckout).toHaveBeenCalledTimes(1);
  });

  it('disables duplicate interaction while processing the sale', () => {
    const order = createOrder({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceRemoteConversionOwned: true
    });
    mocks.state.activeOrders = new Map([[order.id, order]]);

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    expect(screen.getByText('Registrando venta…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrando venta…' })).toBeDisabled();
  });

  it('shows only confirmation recovery after a sale exists', async () => {
    const order = createOrder({
      ecommerceConversionStatus: ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING,
      ecommerceRemoteConversionStatus: 'reserved',
      ecommerceRemoteConversionOwned: true,
      ecommerceConvertedSaleId: 'sale-1'
    });
    mocks.state.activeOrders = new Map([[order.id, order]]);

    render(<EcommercePosConversionPanel order={order} onCheckout={mocks.onCheckout} />);

    expect(screen.queryByRole('button', { name: 'Cobrar pedido' })).not.toBeInTheDocument();
    expect(screen.getByText('La venta fue registrada, pero falta confirmar el pedido online.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ orderId: order.id }));
    expect(mocks.onCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ver venta' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/ventas', { state: { saleId: 'sale-1' } });
  });
});
