import {
  resumeActorScopedStorageWrites,
  suspendActorScopedStorageWrites
} from './actorScopedStorage';
import {
  ACTOR_RUNTIME_ERROR_CODES,
  ACTOR_RUNTIME_STATUS,
  actorRuntimeController,
  ActorRuntimeError
} from './actorRuntimeController';

export const ACTOR_HANDOFF_PENDING_OPERATIONS = 'ACTOR_HANDOFF_PENDING_OPERATIONS';
export const ACTOR_HANDOFF_CHECKOUT_OWNED = 'ACTOR_HANDOFF_CHECKOUT_OWNED';

const pendingOperations = new Map();
const checkoutOwnership = new Map();
let operationSequence = 0;
let installPromise = null;
let operationalDb = null;
let operationalStores = null;

const nextOperationId = (label) => `${label}:${++operationSequence}`;

const toPendingSnapshot = (operation) => Object.freeze({
  id: operation.id,
  label: operation.label,
  actorKey: operation.handle.actorKey,
  actorGeneration: operation.handle.generation,
  tenantOpaqueId: operation.handle.tenant?.opaqueId || null,
  tenantGeneration: operation.handle.tenant?.generation ?? null,
  startedAt: operation.startedAt
});

const toCheckoutSnapshot = (ownership) => Object.freeze({
  orderId: ownership.orderId,
  actorKey: ownership.actorKey || ownership.handle?.actorKey || null,
  actorGeneration: ownership.actorGeneration ?? ownership.handle?.generation ?? null,
  tenantOpaqueId: ownership.tenantOpaqueId || ownership.handle?.tenant?.opaqueId || null,
  tenantGeneration: ownership.tenantGeneration ?? ownership.handle?.tenant?.generation ?? null,
  acquiredAt: ownership.acquiredAt || null,
  persisted: ownership.persisted === true
});

export const getPendingActorOperations = () => Object.freeze(
  [...pendingOperations.values()].map(toPendingSnapshot)
);

export const getActorCheckoutOwnerships = () => Object.freeze(
  [...checkoutOwnership.values()].map(toCheckoutSnapshot)
);

export const refreshPersistedActorCheckoutOwnership = async ({ tenant = null } = {}) => {
  if (!operationalDb || !operationalStores?.SALES) return getActorCheckoutOwnerships();

  const lockedSales = await operationalDb.table(operationalStores.SALES)
    .filter((sale) => sale?.isLockedForCheckout === true)
    .toArray();
  const persistedIds = new Set(lockedSales.map((sale) => sale.id).filter(Boolean));

  for (const [orderId, ownership] of checkoutOwnership.entries()) {
    if (
      ownership.persisted === true
      && (!tenant?.opaqueId || ownership.tenantOpaqueId === tenant.opaqueId)
      && !persistedIds.has(orderId)
    ) {
      checkoutOwnership.delete(orderId);
    }
  }

  for (const sale of lockedSales) {
    if (!sale?.id) continue;
    const existing = checkoutOwnership.get(sale.id);
    const actorKey = typeof sale.checkoutActorKey === 'string' && sale.checkoutActorKey.trim()
      ? sale.checkoutActorKey.trim()
      : null;
    const actorGeneration = Number.isFinite(sale.checkoutActorGeneration)
      ? sale.checkoutActorGeneration
      : null;

    if (existing?.handle && existing.handle.actorKey === actorKey) {
      checkoutOwnership.set(sale.id, {
        ...existing,
        persisted: true,
        actorKey,
        actorGeneration,
        tenantOpaqueId: tenant?.opaqueId || existing.tenantOpaqueId || existing.handle.tenant?.opaqueId || null,
        tenantGeneration: tenant?.generation ?? existing.tenantGeneration ?? existing.handle.tenant?.generation ?? null
      });
      continue;
    }

    checkoutOwnership.set(sale.id, {
      orderId: sale.id,
      handle: null,
      actorKey,
      actorGeneration,
      tenantOpaqueId: tenant?.opaqueId || null,
      tenantGeneration: tenant?.generation ?? null,
      acquiredAt: sale.checkoutLockedAt || sale.updatedAt || null,
      persisted: true
    });
  }

  return getActorCheckoutOwnerships();
};

export const assertActorOperationalHandoffClear = ({ tenant = null, actorKey = null } = {}) => {
  const pending = getPendingActorOperations().filter((operation) => (
    !tenant?.opaqueId || operation.tenantOpaqueId === tenant.opaqueId
  ));
  if (pending.length > 0) {
    throw new ActorRuntimeError(ACTOR_HANDOFF_PENDING_OPERATIONS, {
      pending: pending.map(({ label, actorKey: pendingActorKey, actorGeneration }) => ({
        label,
        actorKey: pendingActorKey,
        actorGeneration
      }))
    });
  }

  const incompatibleCheckout = getActorCheckoutOwnerships().filter((ownership) => (
    (!tenant?.opaqueId || ownership.tenantOpaqueId === tenant.opaqueId)
    && (!actorKey || !ownership.actorKey || ownership.actorKey !== actorKey)
  ));
  if (incompatibleCheckout.length > 0) {
    throw new ActorRuntimeError(ACTOR_HANDOFF_CHECKOUT_OWNED, {
      checkout: incompatibleCheckout.map(({ orderId, actorKey: ownerActorKey, actorGeneration }) => ({
        orderId,
        actorKey: ownerActorKey,
        actorGeneration
      }))
    });
  }
  return true;
};

export const runTrackedActorOperationWithHandle = async (
  handle,
  label,
  operation,
  permission = null
) => {
  if (!handle || typeof handle.assertCurrent !== 'function' || typeof operation !== 'function') {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE);
  }

  const id = nextOperationId(label || 'actor-operation');
  pendingOperations.set(id, {
    id,
    label: label || 'actor-operation',
    handle,
    startedAt: new Date().toISOString()
  });

  const assertCurrent = (requiredPermission = permission) => handle.assertCurrent(requiredPermission);
  const guardedWrite = (write, requiredPermission = permission) => {
    if (typeof write !== 'function') throw new TypeError('guardedWrite requires a write callback');
    const current = assertCurrent(requiredPermission);
    return write(current);
  };

  try {
    assertCurrent();
    const result = await operation(Object.freeze({ assertCurrent, guardedWrite, handle }));
    assertCurrent();
    return result;
  } finally {
    pendingOperations.delete(id);
  }
};

export const runTrackedActorOperation = async (label, operation, permission = null) => (
  runTrackedActorOperationWithHandle(
    actorRuntimeController.capture(permission),
    label,
    operation,
    permission
  )
);

export const runTrackedActorOperationIfGranted = async (label, operation, permission = null) => {
  const state = actorRuntimeController.getState();
  if (state.status !== ACTOR_RUNTIME_STATUS.GRANTED) return operation();
  return runTrackedActorOperation(label, operation, permission);
};

export const runCheckoutActorOperation = async ({
  orderId,
  label = 'checkout.operation',
  operation
} = {}) => {
  const ownership = orderId ? checkoutOwnership.get(orderId) : null;
  if (ownership) {
    if (!ownership.handle) {
      throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE, {
        reason: ownership.actorKey ? 'checkout_owner_not_reauthenticated' : 'checkout_owner_unresolved',
        orderId
      });
    }
    return runTrackedActorOperationWithHandle(ownership.handle, label, operation);
  }
  return runTrackedActorOperationIfGranted(label, operation);
};

export const rebindActorOperationalOwnership = ({ actorKey, tenant, handle } = {}) => {
  if (!actorKey || !tenant?.opaqueId || !handle || typeof handle.assertCurrent !== 'function') return 0;
  let rebound = 0;
  for (const [orderId, ownership] of checkoutOwnership.entries()) {
    const ownerActorKey = ownership.actorKey || ownership.handle?.actorKey || null;
    const ownerTenantOpaqueId = ownership.tenantOpaqueId || ownership.handle?.tenant?.opaqueId || null;
    if (ownerActorKey === actorKey && ownerTenantOpaqueId === tenant.opaqueId) {
      checkoutOwnership.set(orderId, {
        ...ownership,
        handle,
        actorKey,
        actorGeneration: handle.generation,
        tenantOpaqueId: tenant.opaqueId,
        tenantGeneration: tenant.generation
      });
      rebound += 1;
    }
  }
  return rebound;
};

const markGuarded = (fn) => {
  Object.defineProperty(fn, '__lanzoActorOperationalGuard', {
    value: true,
    enumerable: false,
    configurable: false
  });
  return fn;
};

const isGuarded = (fn) => Boolean(fn?.__lanzoActorOperationalGuard);

const ACTIVE_ORDER_ASYNC_ACTIONS = Object.freeze([
  'releaseEcommerceDraft',
  'loadOpenOrder',
  'addItemToOrder',
  'cancelCurrentOrder',
  'cancelOrder',
  'cancelOpenSaleByIdFromPos',
  'pauseOrder',
  'closeOrder'
]);

const ORDER_STORE_ASYNC_ACTIONS = Object.freeze([
  'loadOpenOrder',
  'saveOrderAsOpen',
  'reconcileOrphanedOrders'
]);

const installLoadOrdersGuard = (useActiveOrders) => {
  const original = useActiveOrders.getState().loadOrdersFromDB;
  if (typeof original !== 'function' || isGuarded(original)) return null;

  return markGuarded(() => {
    const handle = actorRuntimeController.capture();
    const ownedOrderIds = new Set(useActiveOrders.getState().activeOrders.keys());
    suspendActorScopedStorageWrites();

    return runTrackedActorOperationWithHandle(
      handle,
      'activeOrders.loadOrdersFromDB',
      async ({ assertCurrent, guardedWrite }) => {
        try {
          await original();
          assertCurrent();

          return guardedWrite(() => {
            const state = useActiveOrders.getState();
            const actorOrders = new Map(
              [...state.activeOrders.entries()].filter(([orderId]) => ownedOrderIds.has(orderId))
            );
            const nextCurrentOrderId = state.currentOrderId && actorOrders.has(state.currentOrderId)
              ? state.currentOrderId
              : (actorOrders.keys().next().value || null);

            // Only the actor-owned editing set is allowed back into persisted
            // ActiveOrders. DB-only open SALES remain tenant-shared business
            // records and can still be explicitly loaded by order id.
            resumeActorScopedStorageWrites();
            useActiveOrders.setState({
              activeOrders: actorOrders,
              currentOrderId: nextCurrentOrderId,
              isLoading: false
            });
            if (actorOrders.size === 0) useActiveOrders.getState().createOrder();
          });
        } catch (error) {
          try {
            assertCurrent();
            resumeActorScopedStorageWrites();
          } catch {
            // A stale actor must never regain write authority while unwinding.
          }
          throw error;
        }
      }
    );
  });
};

const installActiveOrderGuards = (useActiveOrders, db, STORES) => {
  const state = useActiveOrders.getState();
  const patch = {};

  for (const actionName of ACTIVE_ORDER_ASYNC_ACTIONS) {
    const original = state[actionName];
    if (typeof original !== 'function' || isGuarded(original)) continue;
    patch[actionName] = markGuarded((...args) => runTrackedActorOperation(
      `activeOrders.${actionName}`,
      () => original(...args)
    ));
  }

  const originalLock = state.lockOrderForCheckout;
  const originalUnlock = state.unlockOrder;
  if (typeof originalLock === 'function' && !isGuarded(originalLock)) {
    patch.lockOrderForCheckout = markGuarded((orderId, ...args) => {
      const handle = actorRuntimeController.capture();
      return runTrackedActorOperationWithHandle(
        handle,
        'activeOrders.lockOrderForCheckout',
        async ({ assertCurrent }) => {
          const result = await originalLock(orderId, ...args);
          assertCurrent();
          if (result?.success && orderId) {
            try {
              await db.table(STORES.SALES).update(orderId, {
                checkoutActorKey: handle.actorKey,
                checkoutActorGeneration: handle.generation,
                checkoutLockedAt: new Date().toISOString()
              });
              assertCurrent();
            } catch (error) {
              try { await originalUnlock?.(orderId); } catch { /* keep original error */ }
              throw error;
            }
            checkoutOwnership.set(orderId, {
              orderId,
              handle,
              actorKey: handle.actorKey,
              actorGeneration: handle.generation,
              tenantOpaqueId: handle.tenant?.opaqueId || null,
              tenantGeneration: handle.tenant?.generation ?? null,
              acquiredAt: new Date().toISOString(),
              persisted: true
            });
          }
          return result;
        }
      );
    });
  }

  if (typeof originalUnlock === 'function' && !isGuarded(originalUnlock)) {
    patch.unlockOrder = markGuarded((orderId, ...args) => {
      const ownership = orderId ? checkoutOwnership.get(orderId) : null;
      const handle = ownership?.handle || actorRuntimeController.capture();
      return runTrackedActorOperationWithHandle(
        handle,
        'activeOrders.unlockOrder',
        async ({ assertCurrent }) => {
          const result = await originalUnlock(orderId, ...args);
          assertCurrent();
          if (result?.success && orderId) {
            try {
              await db.table(STORES.SALES).update(orderId, {
                checkoutActorKey: null,
                checkoutActorGeneration: null,
                checkoutLockedAt: null
              });
            } catch {
              // isLockedForCheckout=false remains authoritative; stale metadata
              // is ignored by persisted checkout inspection.
            }
            checkoutOwnership.delete(orderId);
          }
          return result;
        }
      );
    });
  }

  const originalRemove = state.removeOrder;
  if (typeof originalRemove === 'function' && !isGuarded(originalRemove)) {
    patch.removeOrder = markGuarded((orderId, ...args) => {
      const ownership = orderId ? checkoutOwnership.get(orderId) : null;
      const handle = ownership?.handle || actorRuntimeController.capture();
      return runTrackedActorOperationWithHandle(
        handle,
        'activeOrders.removeOrder',
        async ({ assertCurrent }) => {
          const result = await originalRemove(orderId, ...args);
          assertCurrent();
          if (result?.success !== false && orderId) checkoutOwnership.delete(orderId);
          return result;
        }
      );
    });
  }

  const guardedLoadOrders = installLoadOrdersGuard(useActiveOrders);
  if (guardedLoadOrders) patch.loadOrdersFromDB = guardedLoadOrders;

  if (Object.keys(patch).length > 0) useActiveOrders.setState(patch);
};

const installOrderStoreAsyncGuards = (useOrderStore) => {
  const state = useOrderStore.getState();
  const patch = {};

  for (const actionName of ORDER_STORE_ASYNC_ACTIONS) {
    const original = state[actionName];
    if (typeof original !== 'function' || isGuarded(original)) continue;
    patch[actionName] = markGuarded((...args) => runTrackedActorOperation(
      `orderStore.${actionName}`,
      () => original(...args)
    ));
  }

  if (Object.keys(patch).length > 0) useOrderStore.setState(patch);
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const installHardenedSmartItem = ({
  useOrderStore,
  useActiveOrders,
  db,
  STORES,
  getAvailableStock,
  getSortedBatchesForProduct,
  isCommercialVariantProduct
}) => {
  const current = useOrderStore.getState();
  if (isGuarded(current.addSmartItem)) return;

  const hardenedAddSmartItem = markGuarded((product) => {
    const handle = actorRuntimeController.capture();
    const targetOrderId = useActiveOrders.getState().currentOrderId;
    const productToAdd = { ...product };

    // Preserve the existing immediate cart UX. The actor handle is captured
    // before the synchronous mutation and therefore represents its real owner.
    useOrderStore.getState().addItem(productToAdd);

    if (!product?.batchManagement?.enabled || product?.batchId || !product?.id || !targetOrderId) {
      return;
    }

    void runTrackedActorOperationWithHandle(
      handle,
      'orderStore.addSmartItem.batchResolution',
      async ({ assertCurrent, guardedWrite }) => {
        const sellableBatches = await db.table(STORES.PRODUCT_BATCHES)
          .where('productId')
          .equals(product.id)
          .filter((batch) => batch.isActive === true && batch.stock > 0)
          .toArray();

        assertCurrent();
        if (sellableBatches.length === 0) return;

        const sortedBatches = getSortedBatchesForProduct(sellableBatches, product);
        let validBatch = null;
        if (product.saleType === 'bulk') {
          const dustThreshold = 0.020;
          validBatch = sortedBatches.find((batch) => getAvailableStock(batch) > dustThreshold)
            || sortedBatches[sortedBatches.length - 1];
        } else {
          validBatch = sortedBatches[0];
        }
        if (!validBatch) return;

        const isCommercialVariant = isCommercialVariantProduct({
          ...product,
          activeBatches: [validBatch]
        });
        const salePrice = isCommercialVariant
          ? toFiniteNumber(validBatch.price)
          : toFiniteNumber(product.price);

        guardedWrite(() => {
          useActiveOrders.getState().updateOrderItems(targetOrderId, (previousOrder) => {
            const order = previousOrder || [];
            const itemIndex = order.findIndex(
              (item) => item.id === product.id && !item.batchId
            );
            if (itemIndex < 0) return order;

            const updatedOrder = [...order];
            updatedOrder[itemIndex] = {
              ...updatedOrder[itemIndex],
              batchId: validBatch.id,
              price: salePrice,
              originalPrice: salePrice,
              cost: validBatch.cost,
              stock: getAvailableStock(validBatch),
              isVariant: isCommercialVariant,
              skuDetected: validBatch.sku || product.sku
            };
            return updatedOrder;
          });
        });
      }
    ).catch((error) => {
      if (error?.code === ACTOR_RUNTIME_ERROR_CODES.CONTEXT_STALE) return;
      console.warn('[ActorOperationalHandoff] Falló resolución actor-scoped de lote:', error);
    });
  });

  useOrderStore.setState({ addSmartItem: hardenedAddSmartItem });
};

const installGuards = async () => {
  const [
    orderStoreModule,
    activeOrdersModule,
    dexieModule,
    dbUtilsModule,
    inventoryFlowModule,
    variantsModule
  ] = await Promise.all([
    import('../../store/useOrderStore.jsx'),
    import('../../hooks/pos/useActiveOrders.js'),
    import('../db/dexie.js'),
    import('../db/utils.js'),
    import('../sales/inventoryFlow.js'),
    import('../products/commercialVariants.js')
  ]);

  const useOrderStore = orderStoreModule.useOrderStore;
  const useActiveOrders = activeOrdersModule.useActiveOrders;
  if (!useOrderStore || !useActiveOrders) {
    throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.CONTEXT_LOCKED, {
      reason: 'actor_operational_store_missing'
    });
  }

  operationalDb = dexieModule.db;
  operationalStores = dexieModule.STORES;
  installActiveOrderGuards(useActiveOrders, operationalDb, operationalStores);
  installOrderStoreAsyncGuards(useOrderStore);
  installHardenedSmartItem({
    useOrderStore,
    useActiveOrders,
    db: operationalDb,
    STORES: operationalStores,
    getAvailableStock: dbUtilsModule.getAvailableStock,
    getSortedBatchesForProduct: inventoryFlowModule.getSortedBatchesForProduct,
    isCommercialVariantProduct: variantsModule.isCommercialVariantProduct
  });
};

export const installActorOperationalHandoffGuards = async () => {
  if (!installPromise) {
    installPromise = installGuards().catch((error) => {
      installPromise = null;
      throw error;
    });
  }
  await installPromise;
  return true;
};
