// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: null,
  loadEcommerceOrders: vi.fn(),
  openEcommerceOrder: vi.fn(),
  refreshEcommerceOrders: vi.fn(),
  setEcommerceOrdersFilter: vi.fn(),
  clearSelectedEcommerceOrder: vi.fn(),
  acceptEcommerceOrder: vi.fn(),
  rejectEcommerceOrder: vi.fn()
  ,preparePosDraft: vi.fn()
  ,releasePosDraft: vi.fn()
  ,showMessageModal: vi.fn()
  ,showConfirmModal: vi.fn()
  ,activeState: { activeOrders: new Map(), releaseEcommerceDraft: vi.fn() }
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(store.state),
    { getState: () => store.state }
  )
}));

vi.mock('../../services/ecommerce/ecommercePosDraftService', () => ({
  getEcommercePosDraftId: (id) => `ecom-${id}`,
  prepareEcommerceOrderPosDraft: store.preparePosDraft
}));

vi.mock('../../services/ecommerce/ecommerceOrderService', () => ({
  releaseEcommerceOrderPosDraft: store.releasePosDraft
}));

vi.mock('../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => store.activeState }
}));

vi.mock('../../services/utils', () => ({
  showMessageModal: store.showMessageModal,
  showConfirmModal: store.showConfirmModal
}));

vi.mock('../../components/ecommerce/orders/EcommerceFulfillmentPanel', () => ({
  default: ({ onTerminalSuccess } = {}) => {
    const order = store.state?.selectedEcommerceOrder;
    const fulfillment = order?.fulfillment || {};
    const isCompletionStage = (
      (order?.fulfillmentMethod === 'delivery' && fulfillment.internalStatus === 'out_for_delivery')
      || (order?.fulfillmentMethod !== 'delivery' && fulfillment.internalStatus === 'ready')
    );
    const paymentRegistered = Boolean(fulfillment.paymentRegistered || order?.payment?.status === 'paid');
    return (
      <section data-testid="embedded-fulfillment-panel">
        <button type="button">Marcar como listo</button>
        {isCompletionStage && paymentRegistered && (
          <button type="button" onClick={() => onTerminalSuccess?.('completed', order)}>
            Completar pedido
          </button>
        )}
      </section>
    );
  }
}));

import EcommerceOrdersPage from '../EcommerceOrdersPage';

const orderId = '11111111-1111-4111-8111-111111111111';
const secondOrderId = '22222222-2222-4222-8222-222222222222';
const ecommerceOrdersPageCss = readFileSync('src/pages/EcommerceOrdersPage.css', 'utf8');

const selectedOrder = (id = orderId, status = 'seen') => ({
  id,
  code: id === orderId ? 'EC-00000011' : 'EC-00000012',
  status,
  fulfillmentMethod: 'pickup',
  customer: {
    name: 'Cliente',
    phone: '9610000000',
    address: 'Calle Central 123',
    notes: 'Tocar el timbre azul'
  },
  totals: { subtotal: 20, deliveryFee: 0, discountTotal: 0, taxTotal: 0, total: 20, currency: 'MXN' },
  payment: { method: 'on_delivery', status: 'pending' },
  timestamps: { createdAt: '2026-07-10T12:00:00Z' },
  items: [{ id: 'item', productName: 'Producto', unitPrice: 20, quantity: 1, lineTotal: 20 }],
  events: [],
  contact: { whatsappUrl: 'https://wa.me/529610000000' }
  ,posDraft: { status: 'none', draftId: null, isClaimedByCurrentActor: false, claimToken: null }
});

const baseState = () => ({
  licenseDetails: { features: { ecommerce_order_inbox: true } },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  ecommerceOrders: [{
    id: orderId,
    code: 'EC-00000011',
    status: 'new',
    customerName: 'Cliente de prueba',
    fulfillmentMethod: 'pickup',
    itemCount: 1,
    total: 20,
    currency: 'MXN',
    createdAt: '2026-07-10T12:00:00Z'
  }, {
    id: secondOrderId,
    code: 'EC-00000012',
    status: 'seen',
    customerName: 'Segundo cliente',
    fulfillmentMethod: 'pickup',
    itemCount: 2,
    total: 40,
    currency: 'MXN',
    createdAt: '2026-07-10T12:05:00Z'
  }],
  ecommerceOrderCounts: { new: 1, seen: 1, pending: 2, accepted: 0, rejected: 0, closed: 0, total: 2 },
  ecommerceOrdersLoading: false,
  ecommerceOrdersRefreshing: false,
  ecommerceOrdersError: null,
  ecommerceOrdersFilter: 'all',
  ecommerceOrdersPagination: { limit: 50, offset: 0, hasMore: false },
  selectedEcommerceOrder: null,
  selectedEcommerceOrderLoading: false,
  selectedEcommerceOrderError: null,
  ecommerceOrderActionLoading: null,
  loadEcommerceOrders: store.loadEcommerceOrders,
  openEcommerceOrder: store.openEcommerceOrder,
  refreshEcommerceOrders: store.refreshEcommerceOrders,
  setEcommerceOrdersFilter: store.setEcommerceOrdersFilter,
  clearSelectedEcommerceOrder: store.clearSelectedEcommerceOrder,
  acceptEcommerceOrder: store.acceptEcommerceOrder,
  rejectEcommerceOrder: store.rejectEcommerceOrder
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const renderPage = (entry = '/pedidos-online') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/pedidos-online" element={<><EcommerceOrdersPage /><LocationProbe /></>} />
    </Routes>
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  store.loadEcommerceOrders.mockResolvedValue({ success: true });
  store.openEcommerceOrder.mockResolvedValue({ success: true });
  store.refreshEcommerceOrders.mockResolvedValue({ success: true });
  store.acceptEcommerceOrder.mockResolvedValue({ success: true });
  store.rejectEcommerceOrder.mockResolvedValue({ success: true });
  store.preparePosDraft.mockResolvedValue({ success: true, draftId: `ecom-${orderId}` });
  store.releasePosDraft.mockResolvedValue({ success: true });
  store.showConfirmModal.mockResolvedValue(true);
  store.activeState = { activeOrders: new Map(), releaseEcommerceDraft: vi.fn() };
  store.state = baseState();
});

describe('EcommerceOrdersPage', () => {
  it('renders the loading detail safely while the selected order is temporarily null', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: null,
      selectedEcommerceOrderLoading: true
    };

    const view = renderPage();

    expect(screen.getByRole('dialog', { name: 'Detalle del pedido online' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Cargando detalle…')).toBeInTheDocument();

    store.state = {
      ...store.state,
      selectedEcommerceOrder: selectedOrder(orderId, 'completed'),
      selectedEcommerceOrderLoading: false
    };
    view.rerender(
      <MemoryRouter initialEntries={['/pedidos-online']}>
        <Routes>
          <Route path="/pedidos-online" element={<><EcommerceOrdersPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('dialog', { name: 'Detalle del pedido online' }))
      .toHaveTextContent('EC-00000011');
    expect(screen.queryByText('Cargando detalle…')).not.toBeInTheDocument();
  });

  it('renders fulfillment actions inside the opened order detail', () => {
    store.state = { ...baseState(), selectedEcommerceOrder: selectedOrder(orderId, 'accepted') };

    renderPage();

    const detail = screen.getByRole('dialog', { name: 'Detalle del pedido online' });
    expect(detail).toContainElement(screen.getByTestId('embedded-fulfillment-panel'));
    expect(screen.getByRole('button', { name: 'Marcar como listo' })).toBeInTheDocument();
  });

  it('shows structured delivery location and reference while keeping the formatted address', () => {
    const order = selectedOrder(orderId, 'accepted');
    order.fulfillmentMethod = 'delivery';
    order.customer = {
      ...order.customer,
      address: 'Calle Central #24, Centro, Tuxtla, Chiapas, CP 29000',
      deliveryAddress: {
        street: 'Calle Central',
        exteriorNumber: '24',
        interiorNumber: '',
        neighborhood: 'Centro',
        municipality: 'Tuxtla',
        state: 'Chiapas',
        postalCode: '29000',
        reference: 'Frente al parque'
      }
    };
    store.state = { ...baseState(), selectedEcommerceOrder: order };

    renderPage();

    expect(screen.getByText('Calle Central #24, Centro, Tuxtla, Chiapas, CP 29000')).toBeInTheDocument();
    expect(screen.getByText('Municipio / estado / CP')).toBeInTheDocument();
    expect(screen.getByText('Tuxtla · Chiapas · CP 29000')).toBeInTheDocument();
    expect(screen.getByText('Referencia para llegar')).toBeInTheDocument();
    expect(screen.getByText('Frente al parque')).toBeInTheDocument();
  });

  it('keeps secondary mobile detail sections collapsed until requested', () => {
    store.state = { ...baseState(), selectedEcommerceOrder: selectedOrder(orderId, 'accepted') };

    renderPage();

    const customerSection = screen.getByRole('button', { name: /Cliente: Cliente/i });
    const itemsSection = screen.getByRole('button', { name: /Artículos y total: 1 artículo/i });
    expect(customerSection).toHaveAttribute('aria-expanded', 'false');
    expect(itemsSection).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(itemsSection);
    expect(itemsSection).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows prepare only to admin or staff with ecommerce and POS permissions', () => {
    store.state = { ...baseState(), selectedEcommerceOrder: selectedOrder(orderId, 'accepted') };
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: /Preparar en Punto de Venta/i })).toBeInTheDocument();
    unmount();

    store.state = {
      ...baseState(),
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-1', permissions: { ecommerce: true, pos: false } },
      selectedEcommerceOrder: selectedOrder(orderId, 'accepted')
    };
    renderPage();
    expect(screen.queryByRole('button', { name: /Preparar en Punto de Venta/i })).not.toBeInTheDocument();
  });

  it('shows a safe conflict state when another device owns the claim', () => {
    const order = selectedOrder(orderId, 'accepted');
    order.posDraft = { status: 'claimed', isClaimedByCurrentActor: false };
    store.state = { ...baseState(), selectedEcommerceOrder: order };
    renderPage();

    expect(screen.getByRole('button', { name: 'En preparación en otro dispositivo' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Preparar en Punto de Venta/i })).not.toBeInTheDocument();
  });

  it('deduplicates prepare clicks while the action is pending', async () => {
    let resolvePrepare;
    store.preparePosDraft.mockReturnValue(new Promise((resolve) => { resolvePrepare = resolve; }));
    store.state = { ...baseState(), selectedEcommerceOrder: selectedOrder(orderId, 'accepted') };
    renderPage();

    const button = screen.getByRole('button', { name: /Preparar en Punto de Venta/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(store.preparePosDraft).toHaveBeenCalledTimes(1);

    resolvePrepare({ success: false, code: 'FIXTURE', message: 'fixture' });
    await waitFor(() => expect(store.showMessageModal).toHaveBeenCalled());
  });
  it('loads the inbox and keeps address and notes out of the list', async () => {
    renderPage();

    await waitFor(() => expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'all',
      force: false
    }));

    expect(screen.getByText('EC-00000011')).toBeInTheDocument();
    expect(screen.getByText('Cliente de prueba')).toBeInTheDocument();
    expect(screen.queryByText('Calle Central 123')).not.toBeInTheDocument();
    expect(screen.queryByText('Tocar el timbre azul')).not.toBeInTheDocument();
  });

  it('does not call the inbox RPC while the device role is unresolved', async () => {
    store.state = {
      ...baseState(),
      currentDeviceRole: null
    };

    renderPage();
    await Promise.resolve();

    expect(store.loadEcommerceOrders).not.toHaveBeenCalled();
    expect(store.openEcommerceOrder).not.toHaveBeenCalled();
  });

  it('opens a valid deep link through the shared detail intent and removes the query immediately', async () => {
    renderPage(`/pedidos-online?order=${orderId}`);

    await waitFor(() => expect(store.openEcommerceOrder).toHaveBeenCalledWith(orderId, {
      force: true,
      markSeen: true
    }));
    expect(screen.getByTestId('location')).toHaveTextContent('/pedidos-online');
    expect(screen.getByTestId('location')).not.toHaveTextContent('?order=');
  });

  it('creates a new detail intent for every card click', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Abrir EC-00000011/i }));
    fireEvent.click(screen.getByRole('button', { name: /Abrir EC-00000012/i }));

    expect(store.openEcommerceOrder).toHaveBeenNthCalledWith(1, orderId, { markSeen: true });
    expect(store.openEcommerceOrder).toHaveBeenNthCalledWith(2, secondOrderId, { markSeen: true });
  });

  it('clears the current detail and stale deep link when the filter changes', async () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder()
    };
    renderPage(`/pedidos-online?order=${orderId}`);
    await waitFor(() => expect(store.openEcommerceOrder).toHaveBeenCalled());

    fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), {
      target: { value: 'pending' }
    });

    await waitFor(() => expect(store.clearSelectedEcommerceOrder).toHaveBeenCalled());
    expect(store.setEcommerceOrdersFilter).toHaveBeenCalledWith('pending');
    expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'pending',
      limit: 50,
      offset: 0,
      force: true
    });
    expect(screen.getByTestId('location')).not.toHaveTextContent('?order=');
  });

  it('groups orders by operational stage and searches without exposing more customer data', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Pedidos en línea' })).toBeInTheDocument();
    expect(screen.getByText('La búsqueda aplica a la página actual.')).toBeInTheDocument();
    expect(screen.queryByText('Tienda online')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Requieren atención' }))
      .toContainElement(screen.getByText('EC-00000011'));
    expect(screen.getByRole('region', { name: 'En proceso' }))
      .toContainElement(screen.getByText('EC-00000012'));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), {
      target: { value: 'Segundo cliente' }
    });

    expect(screen.queryByText('EC-00000011')).not.toBeInTheDocument();
    expect(screen.getByText('EC-00000012')).toBeInTheDocument();
  });

  it('lets mobile users jump between operational groups without traversing every list', () => {
    renderPage();

    const attentionTab = screen.getByRole('tab', { name: 'Atención, 1 pedido' });
    const processTab = screen.getByRole('tab', { name: 'En proceso, 1 pedido' });
    expect(attentionTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(processTab);

    expect(processTab).toHaveAttribute('aria-selected', 'true');
    expect(attentionTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('region', { name: 'En proceso' })).toHaveClass('is-mobile-active');
  });

  it('selects attention when pending results replace a previously selected closed group', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Cerrados, 0 pedidos' }));

    store.state = {
      ...baseState(),
      ecommerceOrdersFilter: 'pending',
      ecommerceOrders: [{ ...baseState().ecommerceOrders[0], status: 'new' }]
    };
    view.rerender(
      <MemoryRouter initialEntries={['/pedidos-online']}>
        <Routes><Route path="/pedidos-online" element={<><EcommerceOrdersPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'Atención, 1 pedido' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Requieren atención' })).toHaveClass('is-mobile-active');
  });

  it('selects the first populated group when all results replace a previous empty group', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Cerrados, 0 pedidos' }));

    store.state = {
      ...baseState(),
      ecommerceOrdersFilter: 'all',
      ecommerceOrders: [{ ...baseState().ecommerceOrders[1], status: 'seen' }]
    };
    view.rerender(
      <MemoryRouter initialEntries={['/pedidos-online']}>
        <Routes><Route path="/pedidos-online" element={<><EcommerceOrdersPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('tab', { name: 'En proceso, 1 pedido' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects process when pending results contain only seen orders', () => {
    store.state = {
      ...baseState(),
      ecommerceOrdersFilter: 'pending',
      ecommerceOrders: [{ ...baseState().ecommerceOrders[1], status: 'seen' }]
    };
    renderPage();

    expect(screen.getByRole('tab', { name: 'En proceso, 1 pedido' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps converted-to-sale orders in process while fulfillment is active', () => {
    store.state = {
      ...baseState(),
      ecommerceOrdersFilter: 'accepted',
      ecommerceOrders: [{
        ...baseState().ecommerceOrders[0],
        status: 'converted_to_sale',
        fulfillmentStatus: 'out_for_delivery'
      }]
    };
    renderPage();

    expect(screen.getByRole('tab', { name: 'En proceso, 1 pedido' })).toHaveAttribute('aria-selected', 'true');
  });

  it('groups terminal fulfillment and rejected orders under Cerrados', () => {
    const orders = [
      { ...baseState().ecommerceOrders[0], id: 'completed-order', code: 'EC-COMPLETE', status: 'accepted', fulfillmentStatus: 'completed' },
      { ...baseState().ecommerceOrders[1], id: 'cancelled-order', code: 'EC-CANCELLED', status: 'accepted', fulfillmentStatus: 'cancelled' },
      { ...baseState().ecommerceOrders[0], id: 'rejected-order', code: 'EC-REJECTED', status: 'rejected' }
    ];
    store.state = {
      ...baseState(),
      ecommerceOrders: orders,
      ecommerceOrderCounts: { ...baseState().ecommerceOrderCounts, closed: 3, total: 3 }
    };

    renderPage();

    const closed = screen.getByRole('region', { name: 'Cerrados' });
    expect(closed).toContainElement(screen.getByText('EC-COMPLETE'));
    expect(closed).toContainElement(screen.getByText('EC-CANCELLED'));
    expect(closed).toContainElement(screen.getByText('EC-REJECTED'));
  });

  it('uses the closed backend scope when the history filter is selected', async () => {
    renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), {
      target: { value: 'closed' }
    });

    await waitFor(() => expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'closed',
      limit: 50,
      offset: 0,
      force: true
    }));
  });

  it('navigates bounded pages and replaces the visible rows without mixing results', () => {
    const firstPageOrder = baseState().ecommerceOrders[0];
    const secondPageOrder = baseState().ecommerceOrders[1];
    store.state = {
      ...baseState(),
      ecommerceOrders: [firstPageOrder],
      ecommerceOrdersPagination: { limit: 1, offset: 0, hasMore: true }
    };
    const view = renderPage();

    expect(screen.getByText('Página 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'all',
      limit: 1,
      offset: 1,
      force: true
    });

    store.state = {
      ...store.state,
      ecommerceOrders: [secondPageOrder],
      ecommerceOrdersPagination: { limit: 1, offset: 1, hasMore: false }
    };
    view.rerender(
      <MemoryRouter initialEntries={['/pedidos-online']}>
        <Routes><Route path="/pedidos-online" element={<><EcommerceOrdersPage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Página 2')).toBeInTheDocument();
    expect(screen.queryByText('EC-00000011')).not.toBeInTheDocument();
    expect(screen.getByText('EC-00000012')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'all',
      limit: 1,
      offset: 0,
      force: true
    });
  });

  it('resets the pagination offset when the filter changes', async () => {
    store.state = {
      ...baseState(),
      ecommerceOrdersPagination: { limit: 25, offset: 50, hasMore: true }
    };
    renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), {
      target: { value: 'closed' }
    });

    await waitFor(() => expect(store.loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'closed',
      limit: 25,
      offset: 0,
      force: true
    }));
  });

  it('keeps search page-local while the pagination scope remains explicit', () => {
    store.state = {
      ...baseState(),
      ecommerceOrders: [baseState().ecommerceOrders[0]],
      ecommerceOrdersPagination: { limit: 1, offset: 0, hasMore: true }
    };
    renderPage();

    expect(screen.getByText('La búsqueda aplica a la página actual.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), {
      target: { value: 'EC-00000012' }
    });

    expect(screen.getByText('No encontramos pedidos')).toBeInTheDocument();
  });

  it('labels the terminal unpaid POS action as Cobrar en Punto de Venta', () => {
    const order = selectedOrder(orderId, 'accepted');
    order.fulfillmentMethod = 'delivery';
    order.fulfillment = {
      internalStatus: 'out_for_delivery',
      status: 'out_for_delivery',
      paymentRegistered: false,
      version: 4
    };
    store.state = { ...baseState(), selectedEcommerceOrder: order };

    renderPage();

    expect(screen.getByRole('button', { name: 'Cobrar en Punto de Venta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar pedido' })).not.toBeInTheDocument();
  });

  it('exposes completion in the detail once payment is registered', () => {
    const order = selectedOrder(orderId, 'accepted');
    order.fulfillmentMethod = 'delivery';
    order.fulfillment = {
      internalStatus: 'out_for_delivery',
      status: 'out_for_delivery',
      paymentRegistered: true,
      version: 4
    };
    store.state = { ...baseState(), selectedEcommerceOrder: order };

    renderPage();

    expect(screen.getByRole('button', { name: 'Completar pedido' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cobrar en Punto de Venta' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Completar pedido' }));
    expect(store.showMessageModal).toHaveBeenCalledWith('Pedido completado', null, { type: 'success' });
  });

  it('shows paid and POS conversion evidence in the terminal detail', () => {
    const order = selectedOrder(orderId, 'converted_to_sale');
    order.fulfillmentMethod = 'delivery';
    order.payment = { method: 'cash', status: 'pending' };
    order.fulfillment = {
      internalStatus: 'out_for_delivery',
      status: 'out_for_delivery',
      paymentRegistered: true,
      version: 4
    };
    order.posConversion = {
      status: 'completed',
      convertedSaleId: 'sale-125'
    };
    store.state = { ...baseState(), selectedEcommerceOrder: order };

    renderPage();

    expect(screen.getByText('Registrado en Punto de Venta')).toBeInTheDocument();
    expect(screen.getByText('Registrada · sale-125')).toBeInTheDocument();
  });

  it('keeps accepted and active converted sales in process', () => {
    store.state = {
      ...baseState(),
      ecommerceOrdersFilter: 'accepted',
      ecommerceOrders: [
        { ...baseState().ecommerceOrders[0], status: 'accepted' },
        { ...baseState().ecommerceOrders[1], status: 'converted_to_sale' }
      ]
    };
    renderPage();

    expect(screen.getByRole('tab', { name: 'En proceso, 2 pedidos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the active mobile group when it still has visible orders', () => {
    renderPage();
    const processTab = screen.getByRole('tab', { name: 'En proceso, 1 pedido' });
    fireEvent.click(processTab);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), {
      target: { value: 'Segundo cliente' }
    });

    expect(processTab).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a stable valid group for an empty result set', () => {
    renderPage();
    const closedTab = screen.getByRole('tab', { name: 'Cerrados, 0 pedidos' });
    fireEvent.click(closedTab);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), {
      target: { value: 'sin coincidencias' }
    });

    expect(closedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('moves to the group containing the first local search match', () => {
    renderPage();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar pedidos' }), {
      target: { value: 'Segundo cliente' }
    });

    expect(screen.getByRole('tab', { name: 'En proceso, 1 pedido' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the three-column detail grid out of tablet widths', () => {
    expect(ecommerceOrdersPageCss).toContain('@media (min-width: 960px)');
    expect(ecommerceOrdersPageCss).not.toContain('@media (min-width: 760px)');
  });

  it('collapses long mobile groups into six-order batches', () => {
    const seedOrder = baseState().ecommerceOrders[0];
    store.state = {
      ...baseState(),
      ecommerceOrders: Array.from({ length: 8 }, (_, index) => ({
        ...seedOrder,
        id: `mobile-order-${index + 1}`,
        code: `EC-MOBILE-${index + 1}`
      }))
    };
    renderPage();

    const moreButton = screen.getByRole('button', { name: 'Mostrar 2 más · 2 restantes' });
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moreButton);
    expect(screen.getByRole('button', { name: 'Mostrar menos' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Requieren atención' })).toHaveClass('is-mobile-expanded');
  });

  it('closes the detail through clearSelectedEcommerceOrder', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder()
    };
    renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar detalle' })[1]);
    expect(store.clearSelectedEcommerceOrder).toHaveBeenCalledTimes(1);
  });

  it('uses the currently visible order id for accept and reject actions', async () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder(secondOrderId, 'seen')
    };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Aceptar pedido' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aceptación' }));
    await waitFor(() => expect(store.acceptEcommerceOrder).toHaveBeenCalledWith(secondOrderId));

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar pedido' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Motivo/i }), {
      target: { value: 'Sin existencia' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
    await waitFor(() => expect(store.rejectEcommerceOrder).toHaveBeenCalledWith(secondOrderId, 'Sin existencia'));
  });

  it('does not expose actions while the selected detail is changing', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder(orderId, 'seen'),
      selectedEcommerceOrderLoading: true
    };
    renderPage();

    expect(screen.getByRole('dialog', { name: 'Detalle del pedido online' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Aceptar pedido' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar pedido' })).not.toBeInTheDocument();
  });

  it('disables both actions while an operation is active', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder(orderId, 'seen'),
      ecommerceOrderActionLoading: 'accept'
    };
    renderPage();

    expect(screen.getByRole('button', { name: /Aceptando/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rechazar pedido' })).toBeDisabled();
  });

  it('shows authorized PII in detail without exposing future operational actions', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: selectedOrder(orderId, 'accepted')
    };

    renderPage();

    expect(screen.getByText('9610000000')).toBeInTheDocument();
    expect(screen.getByText('Calle Central 123')).toBeInTheDocument();
    expect(screen.getByText('Tocar el timbre azul')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir WhatsApp/i }))
      .toHaveAttribute('href', 'https://wa.me/529610000000');
    expect(screen.queryByRole('button', { name: /Preparando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Convertir a venta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceptar pedido/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rechazar pedido/i })).not.toBeInTheDocument();
  });
});
