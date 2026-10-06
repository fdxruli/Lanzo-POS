// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appState: null,
  activeState: null,
  splitOpenTableOrder: vi.fn(),
  showMessageModal: vi.fn(),
  reportAuthority: vi.fn(),
  actorCapture: vi.fn(),
  actorHandle: {
    actorKey: 'admin:owner-a', actorType: 'admin', actorId: 'owner-a',
    sessionId: 'table-management-session', generation: 1, deviceRef: 'device-a',
    tenant: { opaqueId: 'tenant-a', databaseName: 'table-management-unit', generation: 1 },
    assertCurrent: vi.fn()
  },
  showConfirmModal: vi.fn(),
  showInputPromptModal: vi.fn(),
  cloudStatus: vi.fn(),
  cloudUpsert: vi.fn(),
  closeCloudAfterSplit: vi.fn(),
  dbGet: vi.fn(),
  dbUpdate: vi.fn(),
  canUseCloudSplitTableSale: vi.fn(),
  cashGetCurrentSession: vi.fn(),
  cashRegisterMovement: vi.fn(),
  licenseKey: 'license-key',
  cloudEnabled: true
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.appState),
    { getState: () => mocks.appState }
  )
}));
vi.mock('../../../services/auth/actorAuthorityRecovery', () => ({
  reportActorAuthorityError: (...args) => mocks.reportAuthority(...args),
  getActorAuthorityRecoverySnapshot: () => ({ requiresReauthentication: true })
}));
vi.mock('../../../services/auth/actorRuntimeController', async (importOriginal) => ({
  ...await importOriginal(),
  actorRuntimeController: {
    capture: (...args) => mocks.actorCapture(...args),
    getState: () => ({ status: 'granted', ...mocks.actorHandle }),
    subscribe: () => () => {}
  }
}));

vi.mock('../../../services/salesService', () => ({
  splitOpenTableOrder: mocks.splitOpenTableOrder
}));

vi.mock('../../../services/Logger', () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
  getLicenseKeyFromDetails: () => mocks.licenseKey,
  isRestaurantOrdersCloudEnabled: () => mocks.cloudEnabled,
  SYNC_ENTITY_TYPES: {
    CUSTOMER: 'customer',
    CUSTOMER_LEDGER: 'customer_ledger',
    CUSTOMER_CREDIT: 'customer_credit',
    CUSTOMER_PAYMENT: 'customer_payment',
    CATEGORY: 'category',
    PRODUCT: 'product',
    PRODUCT_BATCH: 'product_batch',
    INVENTORY_ENTRY: 'inventory_entry',
    PREPARATION_STATION: 'preparation_station',
    RESTAURANT_ORDER: 'restaurant_order',
    RESTAURANT_ORDER_ITEM: 'restaurant_order_item',
    INVENTORY_MOVEMENT: 'inventory_movement',
    CASH: 'cash',
    CASH_SESSION: 'cash_session',
    CASH_MOVEMENT: 'cash_movement',
    SALE: 'sale',
    SALE_ITEM: 'sale_item',
    SALE_PAYMENT: 'sale_payment',
    SALE_CANCELLATION: 'sale_cancellation',
    REPORT: 'report',
    GENERIC: 'generic'
  },
  SYNC_OPERATIONS: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    RESTORE: 'restore',
    UPSERT: 'upsert',
    UPSERT_SHADOW: 'upsert_shadow',
    CLOUD_COMMIT: 'cloud_commit',
    CANCEL: 'cancel',
    PULL_SNAPSHOT: 'pull_snapshot',
    PULL_CHANGES: 'pull_changes',
    TOGGLE_STATUS: 'toggle_status',
    STATUS_UPDATE: 'status_update',
    OPEN: 'open',
    CLOSE: 'close',
    MOVEMENT: 'movement',
    ADJUST: 'adjust',
    INVENTORY_ENTRY: 'inventory_entry',
    UNKNOWN: 'unknown'
  },
  SYNC_STATUS: {
    DISABLED: 'disabled',
    ONLINE: 'online',
    OFFLINE: 'offline',
    DEGRADED: 'degraded',
    ERROR: 'error'
  },
  SYNC_LIMITS: {
    DEFAULT_PULL_LIMIT: 500,
    MAX_PULL_LIMIT: 500,
    DEFAULT_OUTBOX_LIMIT: 50,
    STUCK_PROCESSING_MS: 120000
  },
  POS_SYNC_FOCUS_PULL_COOLDOWN_MS: 60000,
  POS_SYNC_REALTIME_PULL_DEBOUNCE_MS: 1000,
  shouldDeferPosBootstrapStartHook: vi.fn(() => false),
  isCloudPosSyncEnabled: vi.fn(() => true)
}));

vi.mock('../../restaurant/useRestaurantOrderCloudStatus', () => ({
  getRestaurantOrderCloudStatusSnapshot: mocks.cloudStatus
}));

vi.mock('../../../services/restaurant/restaurantOrderCheckoutClose', () => ({
  closeRestaurantCloudOrderAfterSuccessfulSplitPayment: mocks.closeCloudAfterSplit
}));

vi.mock('../../../services/salesCloud/salesCloudCashierService', () => ({
  salesCloudCashierService: {
    canUseCloudSplitTableSale: mocks.canUseCloudSplitTableSale
  }
}));

vi.mock('../../../services/cash/cashRepository', () => ({
  cashRepository: {
    getCurrentCashSession: mocks.cashGetCurrentSession,
    registerMovement: mocks.cashRegisterMovement
  }
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
  mocks.actorCapture.mockReturnValue(mocks.actorHandle);
  mocks.actorHandle.assertCurrent.mockReturnValue(mocks.actorHandle);
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
  mocks.licenseKey = 'license-key';
  mocks.cloudEnabled = true;
  mocks.canUseCloudSplitTableSale.mockResolvedValue(true);
  mocks.cashGetCurrentSession.mockResolvedValue({
    success: true,
    cashSession: { id: 'cloud-session', estado: 'abierta' },
    readOnly: false,
    stateKnown: true
  });
});

describe('useTableManagement ecommerce guard', () => {
  it('handles a returned split auth failure without exposing its code or retrying payment', async () => {
    setActiveOrder(undefined);
    mocks.splitOpenTableOrder.mockResolvedValue({ success: false, message: 'DEVICE_TOKEN_INVALID' });
    mocks.reportAuthority.mockReturnValue(true);
    const { result } = renderHook(() => useTableManagement(makeDeps()));
    let response;
    await act(async () => {
      response = await result.current.handleConfirmSplitBill({ splitIntent: 'equal_payment',
        tickets: [{ paymentData: { paymentMethod: 'efectivo', amountPaid: '20' } }] });
    });
    expect(response).toMatchObject({ success: false, code: 'DEVICE_TOKEN_INVALID', recoveryRequired: true });
    expect(mocks.reportAuthority).toHaveBeenCalled();
    expect(mocks.splitOpenTableOrder).toHaveBeenCalledTimes(1);
    expect(mocks.closeCloudAfterSplit).not.toHaveBeenCalled();
    expect(mocks.showMessageModal).not.toHaveBeenCalledWith('DEVICE_TOKEN_INVALID', null, expect.anything());
  });

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

  it('blocks a quick action on a normal table while an ecommerce draft is the live active order', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTableManagement(deps));

    let response;
    await act(async () => {
      response = await result.current.handleQuickTableAction({
        id: 'normal-table-order',
        origin: undefined,
        items: [{ id: 'product-2', quantity: 1, price: 30 }]
      }, 'checkout');
    });

    expect(response).toMatchObject({
      success: false,
      code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
    });
    expect(mocks.activeState.loadOpenOrder).not.toHaveBeenCalled();
    expect(deps.handleInitiateCheckout).not.toHaveBeenCalled();
    expect(mocks.cloudStatus).not.toHaveBeenCalled();
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

  it.each([
    { label: 'Free/local 100% fiado', cloud: false, methods: ['fiado', 'fiado'] },
    { label: 'Pro/cloud 100% fiado', cloud: true, methods: ['fiado', 'fiado'] },
    { label: '100% efectivo', cloud: false, methods: ['efectivo', 'efectivo'] },
    { label: 'split mixto efectivo/fiado', cloud: true, methods: ['efectivo', 'fiado'] }
  ])('ensures one session for $label when caja is closed', async ({ cloud, methods }) => {
    setActiveOrder(undefined);
    mocks.licenseKey = cloud ? 'license-key' : null;
    mocks.cloudEnabled = cloud;
    const deps = {
      ...makeDeps(),
      cajaActual: { estado: 'cerrada' },
      asegurarCajaAbierta: vi.fn().mockResolvedValue({ id: 'opened-session' })
    };
    const { result } = renderHook(() => useTableManagement(deps));

    let response;
    await act(async () => {
      response = await result.current.handleConfirmSplitBill({
        splitIntent: 'by_items',
        tickets: methods.map((paymentMethod, index) => ({
          label: `T${index + 1}`,
          paymentData: { paymentMethod, amountPaid: '0', customerId: paymentMethod === 'fiado' ? 'cust-1' : null },
          lines: [{ lineIndex: index, quantity: 1 }]
        }))
      });
    });

    expect(response.success).toBe(true);
    expect(deps.asegurarCajaAbierta).toHaveBeenCalledTimes(1);
    expect(mocks.cashRegisterMovement).not.toHaveBeenCalled();
    expect(mocks.splitOpenTableOrder).toHaveBeenCalledTimes(1);
    if (cloud) {
      expect(mocks.canUseCloudSplitTableSale).toHaveBeenCalledTimes(1);
      expect(mocks.cashGetCurrentSession).toHaveBeenCalledTimes(1);
      expect(mocks.splitOpenTableOrder.mock.calls[0][0]).toMatchObject({
        cloudSpecialFlows: true,
        cashSessionId: 'cloud-session'
      });
    } else {
      expect(mocks.canUseCloudSplitTableSale).not.toHaveBeenCalled();
    }
  });

  it('does not ensure another session when caja is already open, and fiado stays non-cash', async () => {
    setActiveOrder(undefined);
    const deps = {
      ...makeDeps(),
      cajaActual: { id: 'existing-session', estado: 'abierta' },
      asegurarCajaAbierta: vi.fn()
    };
    const { result } = renderHook(() => useTableManagement(deps));

    let response;
    await act(async () => {
      response = await result.current.handleConfirmSplitBill({
        splitIntent: 'by_items',
        tickets: [
          { label: 'T1', paymentData: { paymentMethod: 'fiado', customerId: 'cust-1', amountPaid: '0' }, lines: [{ lineIndex: 0, quantity: 1 }] },
          { label: 'T2', paymentData: { paymentMethod: 'fiado', customerId: 'cust-1', amountPaid: '0' }, lines: [{ lineIndex: 1, quantity: 1 }] }
        ]
      });
    });

    expect(response.success).toBe(true);
    expect(deps.asegurarCajaAbierta).not.toHaveBeenCalled();
    expect(mocks.cashRegisterMovement).not.toHaveBeenCalled();
  });
});
