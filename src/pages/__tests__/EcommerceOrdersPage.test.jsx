// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
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
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(store.state)
}));

import EcommerceOrdersPage from '../EcommerceOrdersPage';

const orderId = '11111111-1111-4111-8111-111111111111';
const secondOrderId = '22222222-2222-4222-8222-222222222222';

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
  ecommerceOrderCounts: { new: 1, seen: 1, pending: 2, accepted: 0, rejected: 0, total: 2 },
  ecommerceOrdersLoading: false,
  ecommerceOrdersRefreshing: false,
  ecommerceOrdersError: null,
  ecommerceOrdersFilter: 'all',
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
  store.state = baseState();
});

describe('EcommerceOrdersPage', () => {
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

    const cards = screen.getAllByRole('listitem');
    fireEvent.click(cards[0]);
    fireEvent.click(cards[1]);

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

    fireEvent.click(screen.getByRole('button', { name: /Pendientes/i }));

    await waitFor(() => expect(store.clearSelectedEcommerceOrder).toHaveBeenCalled());
    expect(store.setEcommerceOrdersFilter).toHaveBeenCalledWith('pending');
    expect(store.loadEcommerceOrders).toHaveBeenCalledWith({ filter: 'pending', force: true });
    expect(screen.getByTestId('location')).not.toHaveTextContent('?order=');
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
