// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  createLayaway: vi.fn(),
  showMessageModal: vi.fn()
}));

vi.mock('../../useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasLayaway: true })
}));

vi.mock('../../../services/layawayFinancialService', () => ({
  layawayFinancialService: { create: mocks.createLayaway }
}));

// The ecommerce-guard suite is intentionally below an already-GRANTED actor
// boundary. Actor authority states are covered by actorOperationalAuthority;
// keeping that dependency explicit prevents these unit tests from depending on
// global ActorRuntime singleton state while production remains fail-closed.
vi.mock('../../../services/auth/actorOperationalHandoff', () => ({
  runTrackedActorOperationIfGranted: async (_label, operation) => operation()
}));

vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), log: vi.fn(), warn: vi.fn() }
}));

vi.mock('../../../services/utils', () => ({
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../useActiveOrders', () => ({
  selectCurrentOrder: (state) => state.activeOrders.get(state.currentOrderId) || null,
  useActiveOrders: { getState: () => mocks.activeState }
}));

import { useLayawayFlow } from '../useLayawayFlow';
import { ECOMMERCE_POS_CHECKOUT_NOT_ENABLED } from '../../../services/ecommerce/ecommercePosDraftGuards';

const makeDeps = () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  showToast: vi.fn(),
  order: [{ id: 'line-1', productId: 'product-1', quantity: 1, price: 20 }],
  customer: { id: 'customer-1', name: 'Cliente' },
  total: 20,
  clearOrder: vi.fn()
});

const setActiveOrder = (origin) => {
  mocks.activeState = {
    currentOrderId: 'active-order',
    activeOrders: new Map([[
      'active-order',
      {
        id: 'active-order',
        origin,
        items: [{ id: 'line-1', productId: 'product-1', quantity: 1, price: 20 }]
      }
    ]])
  };
};

const mountedHooks = new Set();

const renderLayawayHook = (deps) => {
  const hook = renderHook(() => useLayawayFlow(deps));
  mountedHooks.add(hook);
  return hook;
};

afterEach(() => {
  try {
    for (const hook of mountedHooks) {
      hook.unmount();
    }
  } finally {
    mountedHooks.clear();
    cleanup();
    mocks.activeState = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  setActiveOrder('ecommerce');
  mocks.createLayaway.mockResolvedValue({ success: true });
});

describe('useLayawayFlow ecommerce guard', () => {
  it('does not open the layaway modal for an ecommerce draft', () => {
    const deps = makeDeps();
    const { result } = renderLayawayHook(deps);

    let response;
    act(() => {
      response = result.current.handleInitiateLayaway();
    });

    expect(response).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(deps.openModal).not.toHaveBeenCalled();
    expect(mocks.createLayaway).not.toHaveBeenCalled();
  });

  it('blocks confirmation before creating the layaway, payment or caja movement', async () => {
    const deps = makeDeps();
    const { result } = renderLayawayHook(deps);

    let response;
    await act(async () => {
      response = await result.current.handleConfirmLayaway({
        initialPayment: 10,
        deadline: '2026-07-20',
        expectedCashSessionId: 'caja-1'
      });
    });

    expect(response).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(mocks.createLayaway).not.toHaveBeenCalled();
    expect(deps.clearOrder).not.toHaveBeenCalled();
    expect(deps.closeModal).not.toHaveBeenCalled();
  });

  it('preserves the normal POS layaway flow', async () => {
    setActiveOrder(undefined);
    const deps = makeDeps();
    const { result } = renderLayawayHook(deps);

    act(() => {
      result.current.handleInitiateLayaway();
    });
    expect(deps.openModal).toHaveBeenCalledWith('layaway');

    await act(async () => {
      await result.current.handleConfirmLayaway({
        initialPayment: 10,
        deadline: '2026-07-20',
        expectedCashSessionId: 'caja-1'
      });
    });

    expect(mocks.createLayaway).toHaveBeenCalledTimes(1);
    expect(mocks.createLayaway).toHaveBeenCalledWith(expect.objectContaining({
      expectedCashSessionId: 'caja-1'
    }));
    expect(deps.clearOrder).toHaveBeenCalledTimes(1);
    expect(deps.closeModal).toHaveBeenCalledWith('layaway');
  });

  it.each(['product_id', 'productId', 'parentId'])('accepts a valid product alias: %s', async (field) => {
    setActiveOrder(undefined);
    const deps = makeDeps();
    deps.order = [{ id: 'line-1', [field]: 'product-1', quantity: 1, price: 20 }];
    const { result } = renderLayawayHook(deps);

    await act(async () => {
      await result.current.handleConfirmLayaway({
        initialPayment: 0,
        deadline: '2026-07-20'
      });
    });

    expect(mocks.createLayaway).toHaveBeenCalledTimes(1);
  });

  it('blocks a line without a product reference before the financial RPC', async () => {
    setActiveOrder(undefined);
    const deps = makeDeps();
    deps.order = [{ id: 'line-only', quantity: 1, price: 20 }];
    const { result } = renderLayawayHook(deps);

    let response;
    await act(async () => {
      response = await result.current.handleConfirmLayaway({
        initialPayment: 0,
        deadline: '2026-07-20'
      });
    });

    expect(response).toMatchObject({
      success: false,
      code: 'LAYAWAY_PRODUCT_REQUIRED',
      itemIndex: 0
    });
    expect(mocks.createLayaway).not.toHaveBeenCalled();
    expect(deps.clearOrder).not.toHaveBeenCalled();
    expect(deps.closeModal).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).toHaveBeenCalledWith(
      expect.stringContaining('no tiene un producto válido'),
      null,
      { type: 'warning' }
    );
  });
});
