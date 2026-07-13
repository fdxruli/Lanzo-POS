// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {},
  pruneDrafts: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(mocks.state);
  useAppStore.getState = () => mocks.state;
  return { useAppStore };
});

vi.mock('../../../store/installEcommerceOrderStore', () => ({}));

vi.mock('../../../services/ecommerce/ecommerceOrderCapabilities', () => ({
  canAccessEcommerceOrders: () => true
}));

vi.mock('../../../services/ecommerce/ecommercePosDraftService', () => ({
  canPrepareEcommercePosDraft: () => true,
  getEcommercePosContextIdentity: () => 'pos-context'
}));

vi.mock('../../../services/ecommerce/installEcommercePosActiveOrderGuards', () => ({
  installEcommercePosActiveOrderGuards: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => ({ pruneEcommerceDraftsForContext: mocks.pruneDrafts }) }
}));

import { ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS } from '../../../services/ecommerce/ecommerceOrderRealtimeEvent';
import EcommerceOrdersRuntime from './EcommerceOrdersRuntime';

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return { promise, resolve };
};

const renderRuntime = () => render(
  <MemoryRouter initialEntries={['/pedidos-online']}>
    <EcommerceOrdersRuntime />
  </MemoryRouter>
);

const dispatchOrderEvent = (detail) => {
  window.dispatchEvent(new CustomEvent('lanzo:ecommerce-orders-changed', { detail }));
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.state = {
    licenseDetails: { license_key: 'license-a', features: { ecommerce_order_inbox: true } },
    currentDeviceRole: 'admin',
    currentStaffUser: null,
    selectedEcommerceOrder: { id: 'order-a', status: 'accepted' },
    selectedEcommerceOrderRequestId: 'order-a',
    ecommerceSelectedOrderStale: false,
    loadEcommerceOrderSummary: vi.fn().mockResolvedValue({ success: true }),
    refreshEcommerceOrders: vi.fn().mockResolvedValue({ success: true }),
    invalidateEcommerceOrdersCache: vi.fn(),
    openEcommerceOrder: vi.fn().mockResolvedValue({ success: true }),
    markSelectedEcommerceOrderStale: vi.fn().mockReturnValue({ success: true }),
    requestSelectedEcommerceOrderRefresh: vi.fn().mockReturnValue({ success: true }),
    markSelectedEcommerceOrderFresh: vi.fn(),
    resetEcommerceOrdersState: vi.fn()
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EcommerceOrdersRuntime selected order revalidation', () => {
  it('revalidates the selected detail for the real metadata.order_id contract', async () => {
    renderRuntime();
    mocks.state.loadEcommerceOrderSummary.mockClear();

    act(() => dispatchOrderEvent({
      event: 'ecommerce_orders_changed',
      metadata: { order_id: 'order-a' }
    }));

    expect(mocks.state.markSelectedEcommerceOrderStale).toHaveBeenCalledWith('order-a');
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));

    expect(mocks.state.requestSelectedEcommerceOrderRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledWith('order-a', {
      force: true,
      markSeen: false,
      background: true
    });
  });

  it('does not revalidate A when a reliable event identifies B', async () => {
    renderRuntime();

    act(() => dispatchOrderEvent({ orderId: 'order-b' }));
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));

    expect(mocks.state.invalidateEcommerceOrdersCache).toHaveBeenCalledTimes(1);
    expect(mocks.state.markSelectedEcommerceOrderStale).not.toHaveBeenCalled();
    expect(mocks.state.openEcommerceOrder).not.toHaveBeenCalled();
  });

  it('uses a safe selected-order fallback when the event has no order id', async () => {
    renderRuntime();

    act(() => dispatchOrderEvent({ reason: 'payment_changed', metadata: {} }));
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));

    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledWith(
      'order-a',
      expect.objectContaining({ force: true, markSeen: false, background: true })
    );
  });

  it('debounces a burst into one selected-order refresh', async () => {
    renderRuntime();

    act(() => {
      for (let index = 0; index < 5; index += 1) {
        dispatchOrderEvent({ order_id: 'order-a', reason: `burst-${index}` });
      }
    });
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));

    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledTimes(1);
    expect(mocks.state.requestSelectedEcommerceOrderRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps one request in flight and runs at most one dirty follow-up', async () => {
    const firstRefresh = createDeferred();
    mocks.state.openEcommerceOrder
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValueOnce({ success: true });
    renderRuntime();

    act(() => dispatchOrderEvent({ orderId: 'order-a' }));
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));
    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledTimes(1);

    act(() => {
      dispatchOrderEvent({ orderId: 'order-a' });
      dispatchOrderEvent({ orderId: 'order-a' });
      dispatchOrderEvent({ orderId: 'order-a' });
    });
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));
    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRefresh.resolve({ success: true });
      await firstRefresh.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledTimes(2);
    expect(mocks.state.requestSelectedEcommerceOrderRefresh).toHaveBeenCalledTimes(2);
  });

  it('cleans a pending selected-order timer on unmount', async () => {
    const view = renderRuntime();
    act(() => dispatchOrderEvent({ orderId: 'order-a' }));
    expect(mocks.state.invalidateEcommerceOrdersCache).toHaveBeenCalledTimes(1);

    view.unmount();
    act(() => dispatchOrderEvent({ orderId: 'order-a' }));
    await act(() => vi.advanceTimersByTimeAsync(ECOMMERCE_SELECTED_ORDER_REFRESH_DEBOUNCE_MS));

    expect(mocks.state.openEcommerceOrder).not.toHaveBeenCalled();
    expect(mocks.state.invalidateEcommerceOrdersCache).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale selected order when the page regains focus', async () => {
    mocks.state.ecommerceSelectedOrderStale = true;
    renderRuntime();

    act(() => window.dispatchEvent(new Event('focus')));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(mocks.state.openEcommerceOrder).toHaveBeenCalledWith(
      'order-a',
      expect.objectContaining({ background: true, markSeen: false })
    );
  });
});
