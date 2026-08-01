// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  appState: null,
  navigate: vi.fn(),
  recover: vi.fn(),
  verifyRemote: vi.fn(),
  retryConfirmation: vi.fn(),
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate
}));

vi.mock('../../../hooks/pos/ecommerceCheckoutInitiationSingleFlight', () => ({
  getEcommerceCheckoutInitiation: () => null
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    { getState: () => mocks.activeState }
  )
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.appState)
}));

vi.mock('../../../services/ecommerce/ecommercePosCheckoutConversion', () => ({
  ECOMMERCE_CONVERSION_STATUS: {
    IDLE: 'idle',
    VALIDATING: 'validating',
    PAYMENT_PENDING: 'payment_pending',
    PROCESSING_SALE: 'processing_sale',
    SALE_CREATED: 'sale_created',
    CONFIRMATION_PENDING: 'confirmation_pending',
    COMPLETED: 'completed',
    ERROR: 'error'
  },
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION: 2
}));

vi.mock('../../../services/ecommerce/ecommercePosConversionService', () => ({
  ECOMMERCE_REMOTE_CONTRACT_PENDING: 'ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING',
  getEcommercePosConversionRemoteState: mocks.verifyRemote,
  recoverEcommercePosConversion: mocks.recover,
  retryEcommerceConversionConfirmation: mocks.retryConfirmation
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

import EcommercePosConversionPanel from '../EcommercePosConversionPanel';

const createOrder = (overrides = {}) => ({
  id: 'ecom-order-local',
  origin: 'ecommerce',
  ecommerceOrderId: '179f7296-e6c5-4501-9cd8-bee392071233',
  ecommerceDraftStatus: 'prepared',
  ecommerceInventoryStatus: 'pending',
  ecommerceRemoteContractVersion: 2,
  ecommerceRemoteStateVerifiedAt: '2026-07-31T23:57:08.000Z',
  ecommerceRemoteDraftStatus: 'prepared',
  ecommerceRemoteClaimOwned: true,
  ecommerceRemoteClaimValid: true,
  ecommerceRemoteConversionStatus: 'idle',
  ecommerceRemoteConversionOwned: false,
  ecommerceConversionStatus: 'idle',
  ecommerceOperationalStatus: 'ready',
  ...overrides
});

const setActiveOrder = (order) => {
  mocks.activeState = {
    activeOrders: new Map([[order.id, order]]),
    updateOrder: vi.fn(),
    releaseEcommerceDraft: vi.fn().mockResolvedValue({ success: true }),
    removeEcommerceDraftLocal: vi.fn().mockReturnValue({ success: true })
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = { licenseDetails: { license_key: 'test-license' } };
  mocks.recover.mockResolvedValue({ success: true });
  mocks.verifyRemote.mockResolvedValue({
    success: true,
    contractVersion: 2,
    draftStatus: 'prepared',
    claimOwned: true,
    claimValid: true,
    conversionStatus: 'idle'
  });
  mocks.showConfirmModal.mockResolvedValue(true);
});

afterEach(() => cleanup());

describe('EcommercePosConversionPanel draft exit actions', () => {
  it('releases an owned ecommerce draft from the POS panel', async () => {
    const order = createOrder();
    setActiveOrder(order);
    const onDraftRemoved = vi.fn();

    render(
      <EcommercePosConversionPanel
        order={order}
        onCheckout={vi.fn()}
        onDraftRemoved={onDraftRemoved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Liberar del Punto de Venta' }));

    await waitFor(() => {
      expect(mocks.activeState.releaseEcommerceDraft).toHaveBeenCalledWith(
        order.id,
        'released_from_pos_panel'
      );
    });
    expect(onDraftRemoved).toHaveBeenCalledTimes(1);
    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Pedido liberado del Punto de Venta. Continúa aceptado en la bandeja.',
      null,
      { type: 'success' }
    );
  });

  it('removes only the stale local copy after an administrative release', async () => {
    const order = createOrder({
      ecommerceRemoteDraftStatus: 'released',
      ecommerceRemoteClaimOwned: false,
      ecommerceRemoteClaimValid: false
    });
    setActiveOrder(order);
    const onDraftRemoved = vi.fn();

    render(
      <EcommercePosConversionPanel
        order={order}
        onCheckout={vi.fn()}
        onDraftRemoved={onDraftRemoved}
      />
    );

    expect(screen.queryByRole('button', { name: 'Cobrar pedido' })).not.toBeInTheDocument();
    expect(screen.getByText('Liberado en otro dispositivo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retirar de este dispositivo' }));

    await waitFor(() => {
      expect(mocks.activeState.removeEcommerceDraftLocal).toHaveBeenCalledWith(order.id);
    });
    expect(mocks.activeState.releaseEcommerceDraft).not.toHaveBeenCalled();
    expect(onDraftRemoved).toHaveBeenCalledTimes(1);
    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Copia local retirada. El pedido sigue disponible en la bandeja para prepararlo nuevamente.',
      null,
      { type: 'success' }
    );
  });
});
