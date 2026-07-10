// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadEcommerceOrders = vi.fn().mockResolvedValue({ success: true });
const openEcommerceOrder = vi.fn().mockResolvedValue({ success: true });
const refreshEcommerceOrders = vi.fn().mockResolvedValue({ success: true });
const setEcommerceOrdersFilter = vi.fn();
const clearSelectedEcommerceOrder = vi.fn();
const acceptEcommerceOrder = vi.fn().mockResolvedValue({ success: true });
const rejectEcommerceOrder = vi.fn().mockResolvedValue({ success: true });

let storeState;

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(storeState)
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
  loadEcommerceOrders,
  openEcommerceOrder,
  refreshEcommerceOrders,
  setEcommerceOrdersFilter,
  clearSelectedEcommerceOrder,
  acceptEcommerceOrder,
  rejectEcommerceOrder
});

const renderPage = (entry = '/pedidos-online') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/pedidos-online" element={<EcommerceOrdersPage />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  storeState = baseState();
});

describe('EcommerceOrdersPage', () => {
  it('loads the inbox and keeps address and notes out of the list', async () => {
    renderPage();

    await waitFor(() => expect(loadEcommerceOrders).toHaveBeenCalledWith({
      filter: 'all',
      force: false
    }));

    expect(screen.getByText('EC-00000011')).toBeInTheDocument();
    expect(screen.getByText('Cliente de prueba')).toBeInTheDocument();
    expect(screen.queryByText('Dirección privada')).not.toBeInTheDocument();
    expect(screen.queryByText('Notas privadas')).not.toBeInTheDocument();
  });

  it('opens a valid order deep link and requests mark-seen behavior', async () => {
    renderPage(`/pedidos-online?order=${orderId}`);

    await waitFor(() => expect(openEcommerceOrder).toHaveBeenCalledWith(orderId, {
      force: true,
      markSeen: true
    }));
  });

  it('changes filters and refreshes explicitly', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Pendientes/i }));
    await waitFor(() => expect(setEcommerceOrdersFilter).toHaveBeenCalledWith('pending'));
    expect(loadEcommerceOrders).toHaveBeenCalledWith({ filter: 'pending', force: true });

    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));
    expect(refreshEcommerceOrders).toHaveBeenCalled();
  });

  it('opens a selected order without exposing future operational actions', () => {
    storeState = {
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

    expect(screen.getByText('Dirección')).toBeInTheDocument();
    expect(screen.getByText('Notas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir WhatsApp/i })).toHaveAttribute('href', 'https://wa.me/529610000000');
    expect(screen.queryByRole('button', { name: /Preparando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Convertir a venta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceptar pedido/i })).not.toBeInTheDocument();
  });
});
