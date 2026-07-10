// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  }],
  ecommerceOrderCounts: { new: 1, seen: 0, pending: 1, accepted: 0, rejected: 0, total: 1 },
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

const renderPage = (entry = '/pedidos-online') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/pedidos-online" element={<EcommerceOrdersPage />} />
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
    expect(screen.queryByText('Dirección privada')).not.toBeInTheDocument();
    expect(screen.queryByText('Notas privadas')).not.toBeInTheDocument();
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

  it('opens a valid order deep link and requests mark-seen behavior', async () => {
    renderPage(`/pedidos-online?order=${orderId}`);

    await waitFor(() => expect(store.openEcommerceOrder).toHaveBeenCalledWith(orderId, {
      force: true,
      markSeen: true
    }));
  });

  it('changes filters and refreshes explicitly', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Pendientes/i }));
    await waitFor(() => expect(store.setEcommerceOrdersFilter).toHaveBeenCalledWith('pending'));
    expect(store.loadEcommerceOrders).toHaveBeenCalledWith({ filter: 'pending', force: true });

    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));
    expect(store.refreshEcommerceOrders).toHaveBeenCalled();
  });

  it('shows authorized PII in detail without exposing future operational actions', () => {
    store.state = {
      ...baseState(),
      selectedEcommerceOrder: {
        id: orderId,
        code: 'EC-00000011',
        status: 'accepted',
        fulfillmentMethod: 'pickup',
        customer: { name: 'Cliente', phone: '9610000000', address: 'Dirección', notes: 'Notas' },
        totals: { subtotal: 20, deliveryFee: 0, discountTotal: 0, taxTotal: 0, total: 20, currency: 'MXN' },
        payment: { method: 'on_delivery', status: 'pending' },
        timestamps: { createdAt: '2026-07-10T12:00:00Z' },
        items: [{ id: 'item', productName: 'Producto', unitPrice: 20, quantity: 1, lineTotal: 20 }],
        events: [],
        contact: { whatsappUrl: 'https://wa.me/529610000000' }
      }
    };

    renderPage();

    expect(screen.getByText('9610000000')).toBeInTheDocument();
    expect(screen.getByText('Dirección')).toBeInTheDocument();
    expect(screen.getByText('Notas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir WhatsApp/i }))
      .toHaveAttribute('href', 'https://wa.me/529610000000');
    expect(screen.queryByRole('button', { name: /Preparando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Convertir a venta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceptar pedido/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rechazar pedido/i })).not.toBeInTheDocument();
  });
});
