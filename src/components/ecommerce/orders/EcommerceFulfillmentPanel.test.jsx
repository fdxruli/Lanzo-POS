// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {},
  getFulfillment: vi.fn(),
  updateFulfillment: vi.fn(),
  getActions: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(mocks.state);
  useAppStore.getState = () => mocks.state;
  return { useAppStore };
});

vi.mock('../../../services/ecommerce/ecommerceOrderFulfillmentService', () => ({
  FULFILLMENT_LABELS: {
    accepted: 'Pedido aceptado',
    preparing: 'En preparación',
    ready: 'Listo',
    completed: 'Completado',
    cancelled: 'Cancelado'
  },
  getEcommerceFulfillmentActions: mocks.getActions,
  getEcommerceOrderFulfillment: mocks.getFulfillment,
  updateEcommerceOrderFulfillment: mocks.updateFulfillment
}));

import EcommerceFulfillmentPanel from './EcommerceFulfillmentPanel';

const operationalOrder = (overrides = {}) => ({
  id: 'order-1',
  code: 'EC-1',
  status: 'accepted',
  fulfillmentMethod: 'pickup',
  fulfillment: {
    status: 'ready',
    internalStatus: 'ready',
    version: 2,
    updatedAt: '2026-07-12T12:00:00.000Z',
    publicMessage: '',
    paymentRegistered: false
  },
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    selectedEcommerceOrder: { id: 'order-1', status: 'accepted' },
    selectedEcommerceOrderRequestId: 'order-1',
    licenseDetails: { license_key: 'license-key' },
    refreshEcommerceOrders: vi.fn().mockResolvedValue({ success: true }),
    clearSelectedEcommerceOrder: vi.fn()
  };
  mocks.getFulfillment.mockResolvedValue({ success: true, order: operationalOrder() });
  mocks.getActions.mockImplementation((order) => {
    const status = order?.fulfillment?.internalStatus;
    if (status === 'ready') {
      return [
        { transition: 'completed', label: 'Completar pedido' },
        { transition: 'cancelled', label: 'Cancelar pedido', destructive: true }
      ];
    }
    return [];
  });
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
});

describe('EcommerceFulfillmentPanel', () => {
  it('refreshes counts and closes the detail after a terminal transition', async () => {
    mocks.updateFulfillment.mockResolvedValue({
      success: true,
      changed: true,
      idempotent: false,
      order: operationalOrder({
        fulfillment: {
          ...operationalOrder().fulfillment,
          status: 'completed',
          internalStatus: 'completed',
          version: 3
        }
      })
    });

    render(<EcommerceFulfillmentPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Completar pedido' }));

    await waitFor(() => {
      expect(mocks.state.refreshEcommerceOrders).toHaveBeenCalledWith({ background: true });
      expect(mocks.state.clearSelectedEcommerceOrder).toHaveBeenCalledTimes(1);
    });
    expect(mocks.updateFulfillment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1',
      transition: 'completed',
      expectedVersion: 2
    }));
  });

  it('shows a conversion-in-progress conflict and refetches the authoritative state', async () => {
    mocks.updateFulfillment.mockResolvedValue({
      success: false,
      code: 'ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS',
      message: 'Existe un cobro reservado o en progreso. Verifica la venta antes de completar o cancelar el pedido.'
    });

    render(<EcommerceFulfillmentPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar pedido' }));

    expect(await screen.findByText(/Existe un cobro reservado o en progreso/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getFulfillment).toHaveBeenCalledTimes(2));
    expect(mocks.state.refreshEcommerceOrders).not.toHaveBeenCalled();
    expect(mocks.state.clearSelectedEcommerceOrder).not.toHaveBeenCalled();
  });

  it('renders terminal states without operational actions', async () => {
    mocks.getFulfillment.mockResolvedValue({
      success: true,
      order: operationalOrder({
        fulfillment: {
          ...operationalOrder().fulfillment,
          status: 'cancelled',
          internalStatus: 'cancelled',
          version: 3
        }
      })
    });
    mocks.getActions.mockReturnValue([]);

    render(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Cancelado')).toBeInTheDocument();
    expect(screen.getByText('Este estado no tiene acciones operativas disponibles.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar pedido' })).not.toBeInTheDocument();
  });
});
