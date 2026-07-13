// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const fulfillmentOrder = (status, {
  version = 1,
  paymentRegistered = false,
  publicMessage = ''
} = {}) => operationalOrder({
  fulfillment: {
    ...operationalOrder().fulfillment,
    status,
    internalStatus: status,
    version,
    paymentRegistered,
    publicMessage
  }
});

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    selectedEcommerceOrder: { id: 'order-1', status: 'accepted' },
    selectedEcommerceOrderRequestId: 'order-1',
    ecommerceSelectedOrderRefreshRevision: 0,
    ecommerceSelectedOrderRefreshOrderId: null,
    licenseDetails: { license_key: 'license-key' },
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    refreshEcommerceOrders: vi.fn().mockResolvedValue({ success: true }),
    clearSelectedEcommerceOrder: vi.fn()
  };
  mocks.getFulfillment.mockResolvedValue({ success: true, order: operationalOrder() });
  mocks.getActions.mockImplementation((order) => {
    const status = order?.fulfillment?.internalStatus;
    if (status === 'accepted') {
      return [
        { transition: 'preparing', label: 'Iniciar preparaciÃ³n' },
        { transition: 'cancelled', label: 'Cancelar pedido', destructive: true }
      ];
    }
    if (status === 'preparing') {
      return [
        { transition: 'ready', label: 'Marcar como listo' },
        { transition: 'cancelled', label: 'Cancelar pedido', destructive: true }
      ];
    }
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
  it('refreshes the visible state and action when the store revision advances', async () => {
    mocks.getFulfillment
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('accepted', { version: 1 }) })
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('preparing', { version: 2 }) });
    const view = render(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Pedido aceptado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar preparaciÃ³n' })).toBeInTheDocument();

    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText(/^En preparaci/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(mocks.getFulfillment).toHaveBeenCalledTimes(2);
  });

  it('ignores refresh revisions explicitly addressed to another order', async () => {
    mocks.getFulfillment.mockResolvedValue({
      success: true,
      order: fulfillmentOrder('accepted', { version: 1 })
    });
    const view = render(<EcommerceFulfillmentPanel />);
    expect(await screen.findByText('Pedido aceptado')).toBeInTheDocument();

    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-2';
    view.rerender(<EcommerceFulfillmentPanel />);
    await act(async () => { await Promise.resolve(); });

    expect(mocks.getFulfillment).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pedido aceptado')).toBeInTheDocument();
  });

  it('coalesces invalidations during an active request into one follow-up', async () => {
    const firstRequest = createDeferred();
    mocks.getFulfillment
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('preparing', { version: 2 }) });
    const view = render(<EcommerceFulfillmentPanel />);

    mocks.state.ecommerceSelectedOrderRefreshRevision = 3;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);
    expect(mocks.getFulfillment).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRequest.resolve({ success: true, order: fulfillmentOrder('accepted', { version: 1 }) });
      await firstRequest.promise;
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
    expect(mocks.getFulfillment).toHaveBeenCalledTimes(2);
  });

  it('does not let a late response from A overwrite the selected B panel', async () => {
    const responseA = createDeferred();
    mocks.getFulfillment
      .mockReturnValueOnce(responseA.promise)
      .mockResolvedValueOnce({
        success: true,
        order: operationalOrder({ id: 'order-2', code: 'EC-2' })
      });
    const view = render(<EcommerceFulfillmentPanel />);

    mocks.state.selectedEcommerceOrder = { id: 'order-2', status: 'accepted' };
    mocks.state.selectedEcommerceOrderRequestId = 'order-2';
    mocks.state.ecommerceSelectedOrderRefreshOrderId = null;
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Listo')).toBeInTheDocument();
    await act(async () => {
      responseA.resolve({ success: true, order: fulfillmentOrder('accepted', { version: 1 }) });
      await responseA.promise;
    });

    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.queryByText('Pedido aceptado')).not.toBeInTheDocument();
  });

  it('discards a response from the previous staff context', async () => {
    const previousContextResponse = createDeferred();
    mocks.getFulfillment
      .mockReturnValueOnce(previousContextResponse.promise)
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('ready', { version: 4 }) });
    const view = render(<EcommerceFulfillmentPanel />);

    mocks.state.currentDeviceRole = 'staff';
    mocks.state.currentStaffUser = {
      id: 'staff-2',
      permissions: { ecommerce: true }
    };
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Listo')).toBeInTheDocument();
    await act(async () => {
      previousContextResponse.resolve({
        success: true,
        order: fulfillmentOrder('accepted', { version: 1 })
      });
      await previousContextResponse.promise;
    });

    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.queryByText('Pedido aceptado')).not.toBeInTheDocument();
  });

  it('updates payment without completing a preparing order', async () => {
    mocks.getFulfillment
      .mockResolvedValueOnce({
        success: true,
        order: fulfillmentOrder('preparing', { version: 2, paymentRegistered: false })
      })
      .mockResolvedValueOnce({
        success: true,
        order: fulfillmentOrder('preparing', { version: 3, paymentRegistered: true })
      });
    const view = render(<EcommerceFulfillmentPanel />);
    expect(await screen.findByText('Sin confirmar')).toBeInTheDocument();

    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Registrado')).toBeInTheDocument();
    expect(screen.getByText(/^En preparaci/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
    expect(screen.queryByText('Completado')).not.toBeInTheDocument();
  });

  it('removes operational actions after a remote terminal refresh', async () => {
    mocks.getFulfillment
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('ready', { version: 2 }) })
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('completed', { version: 3 }) });
    const view = render(<EcommerceFulfillmentPanel />);
    expect(await screen.findByRole('button', { name: 'Completar pedido' })).toBeInTheDocument();

    mocks.state.selectedEcommerceOrder = { id: 'order-1', status: 'completed' };
    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('Este estado no tiene acciones operativas disponibles.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar pedido' })).not.toBeInTheDocument();
  });

  it('does not duplicate a manual transition when its realtime confirmation arrives', async () => {
    const readyOrder = fulfillmentOrder('ready', { version: 3 });
    mocks.getFulfillment
      .mockResolvedValueOnce({ success: true, order: fulfillmentOrder('preparing', { version: 2 }) })
      .mockResolvedValue({ success: true, order: readyOrder });
    mocks.updateFulfillment.mockResolvedValue({
      success: true,
      changed: true,
      idempotent: false,
      order: readyOrder
    });
    const view = render(<EcommerceFulfillmentPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como listo' }));

    expect(await screen.findByRole('button', { name: 'Completar pedido' })).toBeInTheDocument();
    expect(screen.getAllByText('Estado operativo actualizado.')).toHaveLength(1);

    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);
    await waitFor(() => expect(mocks.getFulfillment).toHaveBeenCalledTimes(3));

    expect(mocks.updateFulfillment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Completar pedido' })).toBeInTheDocument();
    expect(screen.queryByText(/^En preparaci/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Estado operativo actualizado.')).toHaveLength(1);
  });

  it('preserves an unsaved public message during a silent refresh', async () => {
    mocks.getFulfillment
      .mockResolvedValueOnce({
        success: true,
        order: fulfillmentOrder('accepted', { version: 1, publicMessage: 'Mensaje remoto inicial' })
      })
      .mockResolvedValueOnce({
        success: true,
        order: fulfillmentOrder('preparing', { version: 2, publicMessage: 'Mensaje remoto nuevo' })
      });
    const view = render(<EcommerceFulfillmentPanel />);
    const message = await screen.findByRole('textbox', { name: /^Mensaje p/ });
    fireEvent.change(message, { target: { value: 'Borrador local sin guardar' } });

    mocks.state.ecommerceSelectedOrderRefreshRevision = 1;
    mocks.state.ecommerceSelectedOrderRefreshOrderId = 'order-1';
    view.rerender(<EcommerceFulfillmentPanel />);

    expect(await screen.findByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Mensaje p/ })).toHaveValue(
      'Borrador local sin guardar'
    );
  });

  it('offers ready as the next action while the order is preparing', async () => {
    mocks.getFulfillment.mockResolvedValue({
      success: true,
      order: operationalOrder({
        fulfillment: {
          ...operationalOrder().fulfillment,
          status: 'preparing',
          internalStatus: 'preparing'
        }
      })
    });

    render(<EcommerceFulfillmentPanel />);

    expect(await screen.findByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
  });

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
