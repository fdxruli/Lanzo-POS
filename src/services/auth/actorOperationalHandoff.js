import {
  ACTOR_RUNTIME_ERROR_CODES,
  actorRuntimeController,
  ActorRuntimeError
} from './actorRuntimeController';

export const ACTOR_HANDOFF_PENDING_OPERATIONS = 'ACTOR_HANDOFF_PENDING_OPERATIONS';

const pendingOperations = new Map();
let operationSequence = 0;
let installPromise = null;

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

export const getPendingActorOperations = () => Object.freeze(
  [...pendingOperations.values()].map(toPendingSnapshot)
);

export const assertActorOperationalHandoffClear = ({ tenant = null } = {}) => {
  const pending = getPendingActorOperations().filter((operation) => (
    !tenant?.opaqueId || operation.tenantOpaqueId === tenant.opaqueId
  ));
  if (pending.length > 0) {
    throw new ActorRuntimeError(ACTOR_HANDOFF_PENDING_OPERATIONS, {
      pending: pending.map(({ label, actorKey, actorGeneration }) => ({
        label,
        actorKey,
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
  'removeOrder',
  'addItemToOrder',
  'cancelCurrentOrder',
  'cancelOrder',
  'cancelOpenSaleByIdFromPos',
  'pauseOrder',
  'closeOrder',
  'loadOrdersFromDB',
  'lockOrderForCheckout',
  'unlockOrder'
]);

const ORDER_STORE_ASYNC_ACTIONS = Object.freeze([
  'loadOpenOrder',
  'saveOrderAsOpen',
  'reconcileOrphanedOrders'
]);

const installActiveOrderGuards = (useActiveOrders) => {
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

  installActiveOrderGuards(useActiveOrders);
  installOrderStoreAsyncGuards(useOrderStore);
  installHardenedSmartItem({
    useOrderStore,
    useActiveOrders,
    db: dexieModule.db,
    STORES: dexieModule.STORES,
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
