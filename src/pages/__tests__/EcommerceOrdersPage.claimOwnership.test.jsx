// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: null,
  releaseRemote: vi.fn(),
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn(),
  prepare: vi.fn(),
  activeState: null
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}));

vi.mock('../../services/ecommerce/ecommerceOrderCapabilities', () => ({
  canAccessEcommerceOrders: () => true,
  canPrepareEcommerceOrderInPos: () => true
}));

vi.mock('../../services/ecommerce/ecommerceOrderService', () => ({
  releaseEcommerceOrderPosDraft: mocks.releaseRemote
}));

vi.mock('../../services/ecommerce/ecommercePosDraftService', () => ({
  getEcommercePosDraftId: (id) => `ecom-${id}`,
  prepareEcommerceOrderPosDraft: mocks.prepare
}));

vi.mock('../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => mocks.activeState }
}));

vi.mock('../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

import EcommerceOrdersPage from '../EcommerceOrdersPage';

const orderId = '11111111-1111-4111-8111-111111111111';

const makeOrder = (posDraft, role = 'staff') => ({
  role,
  order: {
    id: orderId,
    code: 'EC-00000011',
    status: 'accepted',
    fulfillmentMethod: 'pickup',
    customer: { name: 'Cliente', phone: '9610000000' },
    totals: { subtotal: 20, total: 20, currency: 'MXN' },
    payment: { status: 'pending' },
    timestamps: { createdAt: '2026-07-11T10:00:00Z' },
    items: [{ id: 'item-1', productName: 'Producto', quantity: 1, unitPrice: 20, lineTotal: 20 }],
    events: [],
    contact: { whatsappUrl: null },
    posDraft
  }
});

const buildState = ({ role, order }) => ({
  licenseDetails: { features: { ecommerce_order_inbox: true } },
  currentDeviceRole: role,
  currentStaffUser: role === 'staff' ? { permissions: { ecommerce: true, pos: true } } : null,
  ecommerceOrders: [],
  ecommerceOrderCounts: { new: 0, seen: 0, pending: 0, accepted: 1, rejected: 0 },
  ecommerceOrdersLoading: false,
  ecommerceOrdersRefreshing: false,
  ecommerceOrdersError: null,
  ecommerceOrdersFilter: 'all',
  selectedEcommerceOrder: order,
  selectedEcommerceOrderLoading: false,
  selectedEcommerceOrderError: null,
  ecommerceOrderActionLoading: null,
  loadEcommerceOrders: vi.fn(),
  openEcommerceOrder: vi.fn(),
  refreshEcommerceOrders: vi.fn(),
  setEcommerceOrdersFilter: vi.fn(),
  clearSelectedEcommerceOrder: vi.fn(),
  acceptEcommerceOrder: vi.fn(),
  rejectEcommerceOrder: vi.fn()
});

const renderOrder = ({ role, order }) => {
  mocks.state = buildState({ role, order });
  return render(<MemoryRouter><EcommerceOrdersPage /></MemoryRouter>);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.showConfirmModal.mockResolvedValue(true);
  mocks.releaseRemote.mockResolvedValue({ success: true });
  mocks.prepare.mockResolvedValue({ success: true });
  mocks.activeState = {
    activeOrders: new Map(),
    releaseEcommerceDraft: vi.fn(),
    removeEcommerceDraftLocal: vi.fn()
  };
});

afterEach(() => cleanup());

describe('EcommerceOrdersPage claim ownership', () => {
  it('shows open and release only for a prepared draft owned by the current actor', () => {
    renderOrder(makeOrder({
      status: 'prepared',
      draftId: `ecom-${orderId}`,
      isClaimedByCurrentActor: true,
      claimToken: 'owned-token'
    }));

    expect(screen.getByRole('button', { name: 'Abrir en Punto de Venta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Liberar borrador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparado en otro dispositivo' })).not.toBeInTheDocument();
  });

  it('shows only an informational prepared state to staff when another device owns it', () => {
    renderOrder(makeOrder({
      status: 'prepared',
      draftId: `ecom-${orderId}`,
      isClaimedByCurrentActor: false,
      claimToken: null
    }));

    expect(screen.getByRole('button', { name: 'Preparado en otro dispositivo' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Abrir en Punto de Venta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar administrativamente' })).not.toBeInTheDocument();
  });

  it('allows an administrator to release a prepared draft from another device with explicit confirmation', async () => {
    renderOrder(makeOrder({
      status: 'prepared',
      draftId: `ecom-${orderId}`,
      isClaimedByCurrentActor: false,
      claimToken: null
    }, 'admin'));

    fireEvent.click(screen.getByRole('button', { name: 'Liberar administrativamente' }));

    await waitFor(() => expect(mocks.showConfirmModal).toHaveBeenCalledWith(
      'Este borrador fue preparado en otro dispositivo. Al liberarlo, ese dispositivo perderá su reserva local y el pedido podrá prepararse nuevamente.',
      expect.objectContaining({ confirmButtonText: 'Liberar administrativamente' })
    ));
    await waitFor(() => expect(mocks.releaseRemote).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      claimToken: null,
      reason: 'administrative_release_other_device'
    })));
  });

  it('shows continue only for a claimed draft with a valid current-actor token', () => {
    renderOrder(makeOrder({
      status: 'claimed',
      draftId: null,
      isClaimedByCurrentActor: true,
      claimToken: 'owned-token'
    }));
    expect(screen.getByRole('button', { name: 'Continuar preparación' })).toBeInTheDocument();

    cleanup();
    renderOrder(makeOrder({
      status: 'claimed',
      draftId: null,
      isClaimedByCurrentActor: false,
      claimToken: null
    }));
    expect(screen.getByRole('button', { name: 'En preparación en otro dispositivo' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Continuar preparación' })).not.toBeInTheDocument();
  });

  it('fails closed for an unknown posDraft status', () => {
    renderOrder(makeOrder({
      status: 'future_state',
      draftId: null,
      isClaimedByCurrentActor: true,
      claimToken: 'unexpected-token'
    }));

    expect(screen.getByRole('button', { name: 'Estado en conflicto. Actualiza el pedido.' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Punto de Venta/i })).not.toBeInTheDocument();
  });
});
