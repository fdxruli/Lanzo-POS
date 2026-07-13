// @vitest-environment jsdom
import { StrictMode, useCallback, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDismissibleHistoryLayer } from '../../useDismissibleHistoryLayer';
import { useMobileCartModal, usePosModals } from '../usePosModals';

const HISTORY_LAYER_KEY = '__lanzoDismissibleLayer';

const normalizeUrl = (url) => {
  const resolved = new URL(url || window.location.href, window.location.origin);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

const installHistoryModel = ({ includePreviousRoute = false } = {}) => {
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  const entries = includePreviousRoute
    ? [
        { state: { route: 'previous' }, url: '/previous' },
        { state: { route: 'pos' }, url: '/pos' }
      ]
    : [{ state: { route: 'pos' }, url: '/pos' }];
  let index = entries.length - 1;

  nativeReplaceState(entries[index].state, document.title, entries[index].url);

  const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
    const normalizedUrl = normalizeUrl(url);
    entries[index] = { state, url: normalizedUrl };
    nativeReplaceState(state, title, normalizedUrl);
  });

  const pushState = vi.spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
    const normalizedUrl = normalizeUrl(url);
    entries.splice(index + 1);
    entries.push({ state, url: normalizedUrl });
    index += 1;
    nativeReplaceState(state, title, normalizedUrl);
  });

  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    if (index === 0) return;

    index -= 1;
    const entry = entries[index];
    nativeReplaceState(entry.state, document.title, entry.url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: entry.state }));
  });

  return {
    back,
    entries,
    pushState,
    replaceState,
    get index() {
      return index;
    }
  };
};

const usePosHistoryHarness = () => {
  const mobileCart = useMobileCartModal();
  const modal = usePosModals();
  const dismissActiveModal = useDismissibleHistoryLayer({
    isOpen: Boolean(modal.activeModal),
    onDismiss: () => modal.closeModal(),
    layerId: `pos-${modal.activeModal || 'modal'}`
  });

  const openFromCart = useCallback((modalName) => {
    mobileCart.closeCartForModalTransition();
    modal.openModal(modalName);
  }, [mobileCart, modal]);

  return {
    dismissActiveModal,
    mobileCart,
    modal,
    openFromCart
  };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState({}, document.title, '/');
});

describe('mobile POS history layer transitions', () => {
  it('opens the mobile cart with exactly one owned history entry', () => {
    const historyModel = installHistoryModel();
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());

    expect(result.current.mobileCart.isOpen).toBe(true);
    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(historyModel.entries).toHaveLength(2);
    expect(window.history.state?.[HISTORY_LAYER_KEY]).toContain('mobile-cart');
  });

  it('closes the mobile cart once when Back leaves its owned entry', () => {
    const onDismiss = vi.fn();
    const historyModel = installHistoryModel();
    const { result } = renderHook(() => {
      const [isOpen, setIsOpen] = useState(false);
      const handleDismiss = useCallback(() => {
        onDismiss();
        setIsOpen(false);
      }, []);
      const dismiss = useDismissibleHistoryLayer({
        isOpen,
        onDismiss: handleDismiss,
        layerId: 'mobile-cart'
      });
      return { dismiss, isOpen, open: () => setIsOpen(true) };
    }, { wrapper: StrictMode });

    act(() => result.current.open());
    act(() => window.history.back());
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });

    expect(result.current.isOpen).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(historyModel.index).toBe(0);
    expect(window.history.state).not.toHaveProperty(HISTORY_LAYER_KEY);
  });

  it('hands the cart entry to payment without a second push or an unmarked duplicate', () => {
    const historyModel = installHistoryModel({ includePreviousRoute: true });
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());
    const cartToken = window.history.state[HISTORY_LAYER_KEY];

    act(() => result.current.openFromCart('payment'));
    const paymentToken = window.history.state[HISTORY_LAYER_KEY];

    expect(result.current.mobileCart.isOpen).toBe(false);
    expect(result.current.modal.activeModal).toBe('payment');
    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(historyModel.replaceState).toHaveBeenCalledTimes(1);
    expect(historyModel.entries).toHaveLength(3);
    expect(historyModel.index).toBe(2);
    expect(paymentToken).toContain('pos-payment');
    expect(paymentToken).not.toBe(cartToken);
    expect(historyModel.entries[2].state[HISTORY_LAYER_KEY]).toBe(paymentToken);
  });

  it('ignores a late popstate owned by the cart after payment claimed the entry', () => {
    installHistoryModel();
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());
    const cartToken = window.history.state[HISTORY_LAYER_KEY];
    act(() => result.current.openFromCart('payment'));
    const paymentToken = window.history.state[HISTORY_LAYER_KEY];

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { [HISTORY_LAYER_KEY]: cartToken }
      }));
    });

    expect(result.current.modal.activeModal).toBe('payment');
    expect(window.history.state[HISTORY_LAYER_KEY]).toBe(paymentToken);
  });

  it('closes payment with the first Back and reaches the previous route with the second', () => {
    const historyModel = installHistoryModel({ includePreviousRoute: true });
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());
    act(() => result.current.openFromCart('payment'));

    act(() => window.history.back());
    expect(result.current.modal.activeModal).toBeNull();
    expect(historyModel.index).toBe(1);
    expect(window.location.pathname).toBe('/pos');
    expect(window.history.state).not.toHaveProperty(HISTORY_LAYER_KEY);

    act(() => window.history.back());
    expect(historyModel.index).toBe(0);
    expect(window.location.pathname).toBe('/previous');
  });

  it('does not accumulate invisible entries across three cart-payment-cancel cycles', () => {
    const historyModel = installHistoryModel({ includePreviousRoute: true });
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      act(() => result.current.mobileCart.openCart());
      act(() => result.current.openFromCart('payment'));
      act(() => result.current.dismissActiveModal());

      expect(result.current.modal.activeModal).toBeNull();
      expect(historyModel.index).toBe(1);
      expect(window.location.pathname).toBe('/pos');
      expect(window.history.state).not.toHaveProperty(HISTORY_LAYER_KEY);
    }

    expect(historyModel.pushState).toHaveBeenCalledTimes(3);
    expect(historyModel.replaceState).toHaveBeenCalledTimes(3);
    expect(historyModel.back).toHaveBeenCalledTimes(3);

    act(() => window.history.back());
    expect(historyModel.index).toBe(0);
    expect(window.location.pathname).toBe('/previous');
  });

  it('reuses the cart entry for prescription and then payment', () => {
    const historyModel = installHistoryModel({ includePreviousRoute: true });
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());
    act(() => result.current.openFromCart('prescription'));
    const prescriptionToken = window.history.state[HISTORY_LAYER_KEY];

    expect(result.current.modal.activeModal).toBe('prescription');
    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(prescriptionToken).toContain('pos-prescription');

    act(() => {
      result.current.modal.closeModal('prescription');
      result.current.modal.openModal('payment');
    });

    expect(result.current.modal.activeModal).toBe('payment');
    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(historyModel.replaceState).toHaveBeenCalledTimes(2);
    expect(window.history.state[HISTORY_LAYER_KEY]).toContain('pos-payment');

    act(() => window.history.back());
    expect(result.current.modal.activeModal).toBeNull();
    expect(historyModel.index).toBe(1);
  });

  it('opens payment directly with its own entry and closes it normally', () => {
    const historyModel = installHistoryModel({ includePreviousRoute: true });
    const { result } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.openFromCart('payment'));

    expect(result.current.mobileCart.isOpen).toBe(false);
    expect(result.current.modal.activeModal).toBe('payment');
    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(historyModel.replaceState).not.toHaveBeenCalled();
    expect(window.history.state[HISTORY_LAYER_KEY]).toContain('pos-payment');

    act(() => result.current.dismissActiveModal());

    expect(result.current.modal.activeModal).toBeNull();
    expect(historyModel.back).toHaveBeenCalledTimes(1);
    expect(historyModel.index).toBe(1);
    expect(window.history.state).not.toHaveProperty(HISTORY_LAYER_KEY);
  });

  it('recovers an unclaimed handoff without calling an unmounted component', () => {
    vi.useFakeTimers();
    const historyModel = installHistoryModel();
    const { result, unmount } = renderHook(() => usePosHistoryHarness(), {
      wrapper: StrictMode
    });

    act(() => result.current.mobileCart.openCart());
    act(() => result.current.mobileCart.closeCartForModalTransition());
    unmount();

    act(() => vi.advanceTimersByTime(1000));

    expect(historyModel.pushState).toHaveBeenCalledTimes(1);
    expect(window.history.state).not.toHaveProperty(HISTORY_LAYER_KEY);
  });
});
