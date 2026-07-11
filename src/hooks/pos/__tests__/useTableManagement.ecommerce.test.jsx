// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  activeState: null,
  splitOpenTableOrder: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn(),
  showInputPromptModal: vi.fn(),
  cloudStatus: vi.fn(),
  cloudUpsert: vi.fn(),
  closeCloudAfterSplit: vi.fn(),
  dbGet: vi.fn(),
  dbUpdate: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.appState),
    { getState: () => mocks.appState }
  )
}));

vi.mock('../../../services/salesService', () => ({
  splitOpenTableOrder: mocks.splitOpenTableOrder
}));

vi.mock('../../../services/Logger', () => ({
  default: { warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../services/db/dexie', () => ({
  STORES: { SALES: 'sales' },
  db: {
    table: vi.fn(() => ({
      get: mocks.dbGet,
      update: mocks.dbUpdate
    }))
  }
}));

vi.mock('../useActiveOrders', () => ({
  selectCurrentOrder: (state) => state.activeOrders.get(state.currentOrderId) || null,
  useActiveOrders: Object.assign(
    (selector) => selector(mocks.activeState),
    { getState: () => mocks.activeState }
  )
}));

vi.mock('../../../components/common/InputPromptModal', () => ({
  showInputPromptModal: mocks.showInputPromptModal
}));

vi.mock('../../../services/restaurant/restaurantOrdersRepository', () => ({
  restaurantOrdersRepository: {
    upsertRestaurantOrderFromLocalSale: mocks.cloudUpsert
  }
}));

vi.mock('../../../services/restaurant/restaurantOrderReconciliation', () => ({
  reconcileCartWithCancelledRestaurantItems: vi.fn(() => ({
    hasUnmatchedCancelledItems: false,
    hasRemovableCancelledItems: false,
    kept: [],
    removedCount: 0
  }))
}));

vi.mock('../../../services/sync/syncConstants', () => ({
  getLicenseKeyFromDetails: () => 'license-key',
  isRestaurantOrdersCloudEnabled: () => true
}));

vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: mocks.cloudStatus
}));

vi.mock('../../../services/restaurant/restaurantOrderCheckoutClose', () => ({
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment: mocks.closeCloudAfterSplit
}));

import { useTableManagement } from '../useTableManagement';
import { ECOMMERCE_POS_CHECKOUT_NOT_ENABLED } from '../../../services/ecommerce/ecommercePosDraftGuards';

const makeDeps = () => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  refreshData: vi.fn(),
  fetchActiveTablesCount: vi.fn(),
  features: { hasTables: true },
  handleInitiateCheckout: vi.fn(),
  cajaActual: { estado: 'abierta' },
  asegurarCajaAbierta: vi.fn()
});

const setActiveOrder = (origin) => {
  const order = {
    id: 'active-order',
    origin,
    items: [{ id: 'product-1', quantity: 1, price: 20 }],
    total: 20,
    tableData: 'Mesa 1',
    isSaved: false
  };
  mocks.activeState = {
    currentOrderId: order.id,
    activeOrders: new Map([[order.id, order]]),
    saveOrderAsOpen: vi.fn(),
    loadOpenOrder: vi.fn(),
    cancelCurrentOrder: vi.fn(),
    updateCurrentOrder: vi.fn(),
    updateOrderItems: vi.fn(),
    removeOrder: vi.fn(),
    cancelOpenSaleByIdFromPos: vi.fn()
  };
  return order;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState = {
    verifySessionIntegrity: vi.fn().mockResolvedValue(true),
    companyProfile: { name: 'Lanzo' },
    licenseDetails: { valid: true }
  };
  setActiveOrder('ecommerce');
  mocks.cloudStatus.mockResolvedValue({ skipped: true });
  mocks.showConfirmModal.mockResolvedValue(true);
  mocks.splitOpenTableOrder.mockResolvedValue({ success: true, total: 20 });
  mocks.dbGet.mockResolvedValue(null);
  mocks.dbUpdate.mockResolvedValue(1);
});

describe('useTableManagement ecommerce guard', () => {
  it('blocks save/open-kitchen flow before table prompts, Dexie and cloud sync', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTableManagement(deps));

    let response;
    await act(async () => {
      response = await result.current.handleSaveAsOpen();
    });

    expect(response).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(mocks.showInputPromptModal).not.toHaveBeenCalled();
    expect(mocks.activeState.saveOrderAsOpen).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
    expect(mocks.cloudUpsert).not.toHaveBeenCalled();
    expect(deps.fetchActiveTablesCount).not.toHaveBeenCalled();
  });

  it('blocks opening and confirming split bill before any operational effect', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTableManagement(deps));

    let openResponse;
    await act(async () => {
      openResponse = await result.current.handleOpenSplitBill();
    });

    expect(openResponse).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(deps.openModal).not.toHaveBeenCalled();
    expect(mocks.cloudStatus).not.toHaveBeenCalled();

    let confirmResponse;
    await act(async () => {
      confirmResponse = await result.current.handleConfirmSplitBill({
        mode: 'items',
        tickets: [{ paymentData: { paymentMethod: 'efectivo' } }]
      });
    });

    expect(confirmResponse).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(mocks.appState.verifySessionIntegrity).not.toHaveBeenCalled();
    expect(mocks.splitOpenTableOrder).not.toHaveBeenCalled();
    expect(mocks.closeCloudAfterSplit).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it('preserves split access for a normal POS order', async () => {
    setActiveOrder(undefined);
    const deps = makeDeps();
    const { result } = renderHook(() => useTableManagement(deps));

    await act(async () => {
      await result.current.handleOpenSplitBill();
    });

    expect(mocks.cloudStatus).toHaveBeenCalledTimes(1);
    expect(deps.openModal).toHaveBeenCalledWith('split');
  });
});
