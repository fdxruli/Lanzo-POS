import { calculateCompositePrice, validateWholesaleCondition } from '../services/pricingLogic';
import { showMessageModal, generateID } from '../services/utils';
import { db, STORES } from '../services/db/dexie';
import { getAvailableStock, getCommittedStock, normalizeStock } from '../services/db/utils';
import { getOperationalStockSnapshot, getPosStockState } from '../services/inventoryStock';
import { commitStock, releaseCommittedStock, getSortedBatchesForProduct } from '../services/sales/inventoryFlow';
import { SALE_STATUS } from '../services/sales/financialStats';
import { Money } from '../utils/moneyMath';
import {
  createCartLineId,
  ensureCartProductReference,
  ensureCartLineId,
  getCartLineId,
  getCartProductId,
  isCartLineMatch,
  shouldCreateSeparateCartLine
} from '../utils/cartLineIdentity';
import {
  compareOrderVersions,
  getNextPersistedOrderVersion
} from '../services/orders/orderVersioning';
import { isCommercialVariantProduct } from '../services/products/commercialVariants';
import { isLocalTenantAccessError } from '../services/tenant/localTenantGuard';
import { isTenantRuntimeError } from '../services/db/tenantRuntimeRouter';
import { resolveImmutableOrderCreatedAt } from '../services/sales/stableSaleTimestamp';
import { actorRuntimeController } from '../services/auth/actorRuntimeController';
import { isDirectUnitCartItem, validateCartCheckoutPriority } from '../services/sales/localCartPriority';
import {
  assertRestaurantCloudTableEditable,
  isRestaurantCloudTableShadow,
  restaurantCloudTableBlockedResult
} from '../services/restaurant/restaurantCloudTableGuards';

const OPEN_FULFILLMENT_STATUS = 'open';
const TABLE_ORDER_TYPE = 'table';

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getSellableItems = (order = []) => (
  (order || []).filter((item) => Number(item?.quantity) > 0)
);

const toSessionTableData = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const calculateOrderTotalExact = (order = []) => {
  const exactTotal = getSellableItems(order).reduce((sum, item) => {
    const lineTotal = Money.multiply(item.price || 0, item.quantity);
    return Money.add(sum, lineTotal);
  }, Money.init(0));

  return Money.toExactString(exactTotal);
};

const reconcileBatchParentCommittedStock = async () => {
  const menuTable = db.table(STORES.MENU);
  const batchesTable = db.table(STORES.PRODUCT_BATCHES);
  const products = await menuTable.toArray();
  const batchManagedProducts = products.filter((product) => product.batchManagement?.enabled);

  if (batchManagedProducts.length === 0) return 0;

  const managedIds = new Set(batchManagedProducts.map((product) => product.id));
  const batches = await batchesTable.toArray();
  const committedByProduct = new Map();

  batches.forEach((batch) => {
    if (!managedIds.has(batch.productId)) return;
    committedByProduct.set(
      batch.productId,
      normalizeStock(
        (committedByProduct.get(batch.productId) || 0) + getCommittedStock(batch)
      )
    );
  });

  const productsToRepair = batchManagedProducts
    .filter((product) => (
      getCommittedStock(product) !== (committedByProduct.get(product.id) || 0)
    ))
    .map((product) => ({
      ...product,
      committedStock: committedByProduct.get(product.id) || 0,
      updatedAt: new Date().toISOString()
    }));

  if (productsToRepair.length > 0) {
    await menuTable.bulkPut(productsToRepair);
  }

  return productsToRepair.length;
};

const shouldAggregateScannedProduct = (product) =>
  product?.saleType !== 'bulk' || Boolean(product?.batchId) || Boolean(product?.isVariant);

const findScannedProductIndex = (items, product) =>
  items.findIndex((item) => {
    if (product.isVariant && product.batchId) {
      return item.batchId === product.batchId;
    }

    if (product.batchId) {
      return item.id === product.id && item.batchId === product.batchId;
    }

    return item.id === product.id;
  });

const buildScannedLineId = (product, existingItems = []) => {
  const explicitLineId = product?.lineId || product?.uniqueLineId;
  const isAlreadyUsed = explicitLineId && existingItems.some((item, index) => (
    getCartLineId(item, index) === explicitLineId
  ));

  return !isAlreadyUsed && explicitLineId
    ? explicitLineId
    : createCartLineId(product);
};

export const getInventoryReservationKey = (item) => {
  if (!item) return null;
  if (item.batchId) return `batch:${item.batchId}`;
  const productId = item.parentId || item.id;
  return productId ? `product:${productId}` : null;
};

// Zero/negative legacy lines are not sellable and cannot offset real claims.
export const getInventoryClaimQuantity = (value) => Math.max(0, Number(value) || 0);

const getSessionReservedQuantity = (activeOrders = new Map(), candidate, excludeOrderId = null) => {
  const reservationKey = getInventoryReservationKey(candidate);
  if (!reservationKey) return 0;

  let reserved = 0;
  activeOrders.forEach((order, orderId) => {
    // OPEN persisted orders already consume committedStock; never count twice.
    if (orderId === excludeOrderId || order?.isSaved || order?.origin === 'ecommerce') return;

    (order?.items || []).forEach((item) => {
      if (getInventoryReservationKey(item) !== reservationKey) return;
      reserved += getInventoryClaimQuantity(item.quantity);
    });
  });

  return normalizeStock(reserved);
};

// Batch cart stock is net display data; only a freshly read selected batch
// can establish authority. Never interpret parent committedStock as a batch's.
export const getCartAvailableStock = (product, batch = null) => {
  if (product?.batchId && (!batch || batch.id !== product.batchId
    || batch.productId !== (getCartProductId(product) || product.id)
    || batch.isActive !== true || batch.status === 'inactive'
    || batch.deletedAt || batch.deletedTimestamp)) return null;
  if (!product?.batchId && product?.batchManagement?.enabled) return null;
  const snapshot = getOperationalStockSnapshot(product?.batchId ? batch : product);
  return snapshot.valid && snapshot.physicalStock >= 0
    && snapshot.physicalStock >= snapshot.committedStock
    ? snapshot.availableStock : null;
};

export const getSessionAvailableStock = (state, product, orderId, batch = null) => {
  if (!product?.trackStock && !product?.batchId) return product?.stock;

  const baseAvailableStock = getCartAvailableStock(product, batch);
  if (baseAvailableStock === null) return null;
  const reservedInOtherOrders = getSessionReservedQuantity(state.activeOrders, product, orderId);

  return normalizeStock(Math.max(0, baseAvailableStock - reservedInOtherOrders));
};

export const summarizeScannedProducts = (items = []) => {
  const groupedItems = [];

  for (const item of items) {
    const normalizedItem = ensureCartProductReference(item, { allowIdFallback: true });
    if (!normalizedItem?.id) {
      continue;
    }

    const quantity = Math.max(1, Number(normalizedItem.quantity) || 1);

    if (!shouldAggregateScannedProduct(normalizedItem)) {
      for (let index = 0; index < quantity; index += 1) {
        const lineId = buildScannedLineId(normalizedItem, groupedItems);
        groupedItems.push({
          ...normalizedItem,
          quantity: 1,
          lineId,
          uniqueLineId: index === 0 ? normalizedItem.uniqueLineId || lineId : lineId,
        });
      }

      continue;
    }

    const existingIndex = findScannedProductIndex(groupedItems, normalizedItem);

    if (existingIndex === -1) {
      groupedItems.push({
        ...normalizedItem,
        quantity,
      });
      continue;
    }

    groupedItems[existingIndex] = {
      ...groupedItems[existingIndex],
      quantity: groupedItems[existingIndex].quantity + quantity,
    };
  }

  return groupedItems;
};

const applyScannedProductsToOrder = (order = [], items = []) => {
  const groupedItems = summarizeScannedProducts(items);
  const nextOrder = [...order];
  const touchedItems = [];
  let addedCount = 0;
  let incrementedCount = 0;
  let failedCount = 0;

  for (const groupedItem of groupedItems) {
    if (!groupedItem?.id) {
      failedCount += 1;
      continue;
    }

    const quantity = Math.max(1, Number(groupedItem.quantity) || 1);

    if (!shouldAggregateScannedProduct(groupedItem)) {
      const lineId = buildScannedLineId(groupedItem, nextOrder);
      const newItem = {
        ...groupedItem,
        productId: groupedItem.productId,
        quantity: 1,
        lineId,
        uniqueLineId: groupedItem.uniqueLineId && lineId === groupedItem.lineId
          ? groupedItem.uniqueLineId
          : lineId,
        exceedsStock: groupedItem.trackStock && 1 > (groupedItem.stock ?? 99999),
      };

      nextOrder.push(newItem);
      touchedItems.push(newItem);
      addedCount += 1;
      continue;
    }

    const existingItemIndex = findScannedProductIndex(nextOrder, groupedItem);

    if (existingItemIndex >= 0) {
      const existingItem = nextOrder[existingItemIndex];
      const newQuantity = existingItem.quantity + quantity;

      nextOrder[existingItemIndex] = {
        ...existingItem,
        productId: getCartProductId(existingItem) ?? groupedItem.productId,
        quantity: newQuantity,
        exceedsStock: existingItem.trackStock && newQuantity > (existingItem.stock ?? 99999),
      };

      touchedItems.push(nextOrder[existingItemIndex]);
      incrementedCount += quantity;
      continue;
    }

    const lineId = buildScannedLineId(groupedItem, nextOrder);
    const newItem = {
      ...groupedItem,
      productId: groupedItem.productId,
      quantity,
      lineId,
      uniqueLineId: groupedItem.uniqueLineId && lineId === groupedItem.lineId
        ? groupedItem.uniqueLineId
        : lineId,
      exceedsStock: groupedItem.trackStock && quantity > (groupedItem.stock ?? 99999),
    };

    nextOrder.push(newItem);
    touchedItems.push(newItem);
    addedCount += quantity;
  }

  return {
    nextOrder,
    touchedItems,
    addedCount,
    incrementedCount,
    failedCount,
  };
};

const getCurrentOrder = (state) => (
  state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null
);

export const createOrderActions = (set, get) => ({
      addSmartItem: async (product, orderId = get().currentOrderId) => {
        assertRestaurantCloudTableEditable(get().activeOrders.get(orderId));
        const requiresBatchResolution = (
          product?.batchManagement?.enabled &&
          !product.batchId &&
          Boolean(product.id)
        );

        if (!requiresBatchResolution) {
          return get().addItem({ ...product }, orderId);
        }

        const actorHandle = actorRuntimeController.capture('pos');
        set((state) => {
          const pendingInventoryResolutions = new Map(state.pendingInventoryResolutions || []);
          const pendingCount = pendingInventoryResolutions.get(orderId) || 0;
          pendingInventoryResolutions.set(orderId, pendingCount + 1);
          return { pendingInventoryResolutions };
        });

        try {
          const allBatches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId')
            .equals(product.id)
            .toArray();
          const sellableBatches = allBatches.filter((batch) => batch.isActive === true
            && Number(batch.stock) > 0
            && getPosStockState(batch, { tracked: true }).kind === 'available');
          const sortedBatches = getSortedBatchesForProduct(sellableBatches, product);
          if (allBatches.length > 0 && sortedBatches.length === 0) {
            const candidate = allBatches.find((batch) => batch.isActive === true) || allBatches[0];
            const observed = candidate.isActive === true
              ? getPosStockState(candidate, { tracked: true })
              : { kind: 'unknown', blocked: true, snapshot: null };
            const stockState = observed.blocked ? observed : { kind: 'unknown', blocked: true, snapshot: null };
            return { success: false, code: 'POS_INVENTORY_BLOCKED', stockState };
          }
          let validBatch = null;

          if (product.saleType === 'bulk') {
            const minimumBulkBatchStock = 0.020;
            validBatch = sortedBatches.find(
              batch => getAvailableStock(batch) > minimumBulkBatchStock
            );
            if (!validBatch) validBatch = sortedBatches[sortedBatches.length - 1];
          } else {
            validBatch = sortedBatches[0];
          }

          const isCommercialVariant = isCommercialVariantProduct({
            ...product,
            activeBatches: validBatch ? [validBatch] : product.activeBatches
          });
          const salePrice = isCommercialVariant
            ? toFiniteNumber(validBatch?.price)
            : toFiniteNumber(product.price);
          const productToAdd = validBatch
            ? {
                ...product,
                batchId: validBatch.id,
                price: salePrice,
                cost: validBatch.cost,
                stock: getAvailableStock(validBatch),
                isVariant: isCommercialVariant,
                skuDetected: validBatch.sku || product.sku,
                originalPrice: salePrice
              }
            : { ...product };

          actorHandle.assertCurrent();
          return await get().addItem(productToAdd, orderId);
        } catch (error) {
          // An isolation failure is never a valid reason to add the parent
          // product: doing so would turn a blocked tenant operation into a
          // cross-context business mutation.
          actorHandle.assertCurrent();
          if (isLocalTenantAccessError(error) || isTenantRuntimeError(error)) throw error;
          console.warn("Fallo al resolver el lote antes de agregar el producto:", error);
          return { success: false, code: 'LOCAL_INVENTORY_NOT_TRANSFERABLE' };
        } finally {
          let contextCurrent = true;
          try { actorHandle.assertCurrent(); } catch { contextCurrent = false; }
          if (contextCurrent) set((state) => {
            const pendingInventoryResolutions = new Map(state.pendingInventoryResolutions || []);
            const pendingCount = pendingInventoryResolutions.get(orderId) || 0;

            if (pendingCount <= 1) {
              pendingInventoryResolutions.delete(orderId);
            } else {
              pendingInventoryResolutions.set(orderId, pendingCount - 1);
            }

            return { pendingInventoryResolutions };
          });
        }
      },

      addItem: (product, orderId = get().currentOrderId) => {
        const productForCart = ensureCartProductReference(product, { allowIdFallback: true });
        return get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          const canAggregateProduct = !shouldCreateSeparateCartLine(product);
          const existingItemIndex = canAggregateProduct
            ? order.findIndex((item) => {
                if (shouldCreateSeparateCartLine(item)) return false;
                if (product.isVariant && product.batchId) {
                  return item.batchId === product.batchId;
                }
                return item.id === product.id && (item.batchId || null) === (product.batchId || null);
              })
            : -1;

          let quantityToCheck = 1;
          let existingItem = null;

          if (existingItemIndex >= 0) {
            existingItem = order[existingItemIndex];
            quantityToCheck = existingItem.quantity + 1;
          }
          const targetLineId = existingItem
            ? getCartLineId(existingItem, existingItemIndex)
            : product.lineId || createCartLineId(product);

          const validation = validateWholesaleCondition(product, quantityToCheck);

          let initialPrice;
          let isPriceWarning = false;
          let shouldShowModal = false;

          const forceWholesale = existingItem?.forceWholesale || false;
          const forceSafePrice = existingItem?.forceSafePrice || false;

          if (validation.status === 'conflict') {
            if (forceWholesale) {
              initialPrice = validation.tierPrice;
              isPriceWarning = true;
            } else if (forceSafePrice) {
              initialPrice = validation.safePrice;
              isPriceWarning = true;
            } else {
              initialPrice = validation.safePrice;
              isPriceWarning = true;
              shouldShowModal = true;
            }
          } else {
            initialPrice = calculateCompositePrice(product, quantityToCheck);
          }

          if (shouldShowModal) {
            showMessageModal(
              `El precio de mayoreo ($${validation.tierPrice}) es menor al costo ($${validation.cost}).

¿Deseas autorizar esta venta bajo costo?`,
              () => {
                get().updateOrderItems(orderId, (innerState) => {
                  const currentOrder = [...(innerState || [])];
                  const idx = currentOrder.findIndex((item, index) =>
                    isCartLineMatch(item, targetLineId, index)
                  );
                  if (idx >= 0) {
                    currentOrder[idx] = {
                      ...currentOrder[idx],
                      price: validation.tierPrice,
                      forceWholesale: true,
                      forceSafePrice: false
                    };
                  }
                  return currentOrder;
                });
              },
              {
                title: '⚠️ Autorización de Costo',
                type: 'warning',
                confirmButtonText: 'Sí, Autorizar',
                showCancel: false,
                extraButton: {
                  text: 'No, Precio Regular',
                  action: () => {
                    get().updateOrderItems(orderId, (innerState) => {
                      const currentOrder = [...(innerState || [])];
                      const idx = currentOrder.findIndex((item, index) =>
                        isCartLineMatch(item, targetLineId, index)
                      );
                      if (idx >= 0) {
                        currentOrder[idx] = {
                          ...currentOrder[idx],
                          forceSafePrice: true,
                          forceWholesale: false
                        };
                      }
                      return currentOrder;
                    });
                  }
                }
              }
            );
          }

          if (existingItemIndex >= 0) {
            const currentItem = order[existingItemIndex];
            const newQuantity = currentItem.quantity + 1;
            let finalPrice = initialPrice;

            if (validation.status !== 'conflict') {
              finalPrice = calculateCompositePrice(currentItem, newQuantity);
            }

            const updatedOrder = [...order];
            updatedOrder[existingItemIndex] = {
              ...currentItem,
              productId: getCartProductId(currentItem) ?? productForCart.productId,
              quantity: newQuantity,
              price: finalPrice,
              // Refresh the provisional snapshot after a cancellation or inventory sync.
              // Final checkout still uses Dexie/Supabase as the authority.
              stock: product.stock,
              committedStock: product.committedStock ?? product.committed_stock ?? currentItem.committedStock,
              exceedsStock: currentItem.trackStock && newQuantity > (product.stock ?? 99999),
              priceWarning: isPriceWarning,
              forceWholesale: validation.status === 'conflict' ? (currentItem.forceWholesale || false) : false,
              forceSafePrice: validation.status === 'conflict' ? (currentItem.forceSafePrice || false) : false,
            };
            return updatedOrder;
          } else {
            const sessionAvailableStock = product.trackStock
              ? getSessionAvailableStock(get(), product, orderId)
              : product.stock;
            const newItem = {
              ...productForCart,
              productId: productForCart.productId,
              lineId: targetLineId,
              quantity: 1,
              price: initialPrice,
              originalPrice: product.originalPrice ?? product.price,
              stock: product.stock,
              exceedsStock: product.trackStock && 1 > sessionAvailableStock,
              priceWarning: isPriceWarning,
              forceWholesale: false,
              forceSafePrice: false
            };
            return [...order, newItem];
          }
        });
      },

      addScannedProduct: (resolvedProduct, orderId = get().currentOrderId) => {
        if (!resolvedProduct || !resolvedProduct.id) {
          console.error('addScannedProduct: Producto inválido', resolvedProduct);
          return { success: false, action: null, item: null };
        }

        const productForCart = ensureCartProductReference(resolvedProduct, { allowIdFallback: true });
        const result = { success: false, action: null, item: null };

        const updateResult = get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          const existingItemIndex = order.findIndex((item) => {
            if (resolvedProduct.isVariant && resolvedProduct.batchId) {
              return item.batchId === resolvedProduct.batchId;
            }
            return item.id === resolvedProduct.id
              && (item.batchId || null) === (resolvedProduct.batchId || null);
          });

          if (existingItemIndex >= 0) {
            const existingItem = order[existingItemIndex];

            if (existingItem.saleType === 'unit') {
              const newQuantity = existingItem.quantity + 1;
              const newOrder = [...order];
              newOrder[existingItemIndex] = {
                ...existingItem,
                productId: getCartProductId(existingItem) ?? productForCart.productId,
                quantity: newQuantity,
                stock: resolvedProduct.stock,
                committedStock: resolvedProduct.committedStock ?? resolvedProduct.committed_stock ?? existingItem.committedStock,
                exceedsStock: existingItem.trackStock && newQuantity > (resolvedProduct.stock ?? 99999)
              };

              result.success = true;
              result.action = 'incremented';
              result.item = newOrder[existingItemIndex];
              return newOrder;
            } else {
              const sessionAvailableStock = resolvedProduct.trackStock
                ? getSessionAvailableStock(get(), resolvedProduct, orderId)
                : resolvedProduct.stock;
              const lineId = buildScannedLineId(productForCart, order);
              const newItem = {
                ...productForCart,
                productId: productForCart.productId,
                lineId,
                uniqueLineId: productForCart.uniqueLineId && lineId === productForCart.lineId
                  ? productForCart.uniqueLineId
                  : lineId,
                quantity: 1,
                stock: resolvedProduct.stock,
                exceedsStock: resolvedProduct.trackStock && 1 > sessionAvailableStock
              };

              result.success = true;
              result.action = 'added';
              result.item = newItem;
              return [...order, newItem];
            }
          } else {
            const sessionAvailableStock = resolvedProduct.trackStock
              ? getSessionAvailableStock(get(), resolvedProduct, orderId)
              : resolvedProduct.stock;
            const lineId = buildScannedLineId(productForCart, order);
            const newItem = {
              ...productForCart,
              productId: productForCart.productId,
              lineId,
              quantity: 1,
              stock: resolvedProduct.stock,
              exceedsStock: resolvedProduct.trackStock && 1 > sessionAvailableStock
            };

            result.success = true;
            result.action = 'added';
            result.item = newItem;
            return [...order, newItem];
          }
        });

        const finish = (update) => update?.success === true ? result : {
          success: false, action: null, item: null, code: update?.code || 'SCAN_ADD_REJECTED'
        };
        return updateResult?.then ? updateResult.then(finish) : finish(updateResult);
      },

      addMultipleScannedProducts: (itemsArray = [], orderId = get().currentOrderId) => {
        if (!Array.isArray(itemsArray) || itemsArray.length === 0) {
          return { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };
        }

        let actionResult = { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };

        const updateResult = get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          const { nextOrder, touchedItems, addedCount, incrementedCount, failedCount } =
            applyScannedProductsToOrder(order, itemsArray);

          actionResult = {
            success: addedCount > 0 || incrementedCount > 0,
            addedCount,
            incrementedCount,
            failedCount,
            items: touchedItems
          };

          if (!actionResult.success) {
            return order;
          }
          return nextOrder;
        });

        const finish = (update) => update?.success === true ? actionResult : {
          success: false, addedCount: 0, incrementedCount: 0,
          failedCount: itemsArray.length, items: [], code: update?.code || 'SCAN_ADD_REJECTED'
        };
        return updateResult?.then ? updateResult.then(finish) : finish(updateResult);
      },

      updateItemQuantity: (lineId, newQuantity, orderId = get().currentOrderId) => {
        return get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          return order.map((item, index) => {
            if (isCartLineMatch(item, lineId, index)) {
              const safeQuantity = newQuantity === null ? 0 : newQuantity;
              const validation = validateWholesaleCondition(item, safeQuantity);

              let newPrice;
              let isPriceProtected = false;
              let shouldShowModal = false;

              if (validation.status === 'conflict') {
                isPriceProtected = true;

                if (item.forceWholesale) {
                  newPrice = validation.tierPrice;
                } else if (item.forceSafePrice) {
                  newPrice = validation.safePrice;
                } else {
                  newPrice = validation.safePrice;
                  shouldShowModal = true;
                }

                if (safeQuantity > 0 && shouldShowModal) {
                  showMessageModal(
                    `Al llevar ${safeQuantity} unidades, el precio baja a $${validation.tierPrice}, lo cual es menor al costo ($${validation.cost}).

¿Autorizar precio bajo costo?`,
                    () => {
                      get().updateOrderItems(orderId, (innerState) => {
                        return (innerState || []).map(i => {
                          if (isCartLineMatch(i, lineId)) {
                            return { ...i, price: validation.tierPrice, forceWholesale: true, forceSafePrice: false };
                          }
                          return i;
                        });
                      });
                    },
                    {
                      title: '⚠️ Autorización de Costo',
                      type: 'warning',
                      confirmButtonText: 'Sí, Autorizar',
                      showCancel: false,
                      extraButton: {
                        text: 'No, Precio Regular',
                        action: () => {
                          get().updateOrderItems(orderId, (innerState) => {
                            return (innerState || []).map(i => {
                              if (isCartLineMatch(i, lineId)) {
                                return { ...i, forceSafePrice: true, forceWholesale: false };
                              }
                              return i;
                            });
                          });
                        }
                      }
                    }
                  );
                }
              } else {
                newPrice = calculateCompositePrice(item, safeQuantity);
              }

              return {
                ...item,
                quantity: newQuantity,
                price: newPrice,
                exceedsStock: item.trackStock && safeQuantity > item.stock,
                priceWarning: isPriceProtected,
                forceWholesale: validation.status === 'conflict' ? item.forceWholesale : false,
                forceSafePrice: validation.status === 'conflict' ? item.forceSafePrice : false,
              };
            }
            return item;
          });
        });
      },

      removeItem: (lineId, orderId = get().currentOrderId) => {
        return get().updateOrderItems(orderId, (prevOrder) => (
          (prevOrder || []).filter((item, index) => !isCartLineMatch(item, lineId, index))
        ));
      },

      clearOrder: (orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, []);
      },

      setOrder: (newOrder, orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, (newOrder || []).map(ensureCartLineId));
      },

      setTableData: (tableData, orderId = get().currentOrderId) => {
        get().updateOrder(orderId, { tableData });
      },

      saveOrderAsOpen: async (orderId = get().currentOrderId, orderSnapshot = null, saveOptions = {}) => {
        const actorHandle = actorRuntimeController.getState?.()?.status === 'granted'
          ? actorRuntimeController.capture() : null;
        const assertActorCurrent = () => actorHandle?.assertCurrent();
        const state = get();
        const activeOrderId = orderId;
        const currentOrder = orderSnapshot || (orderId ? state.activeOrders.get(orderId) || null : null);
        if (isRestaurantCloudTableShadow(currentOrder) || isRestaurantCloudTableShadow(state.activeOrders.get(orderId))) {
          return restaurantCloudTableBlockedResult();
        }
        const order = currentOrder?.items || [];
        const tableData = currentOrder?.tableData || null;
        const isSavedOrder = currentOrder?.isSaved || false;
        const currentItems = getSellableItems(order);

        if (currentItems.length === 0) {
          return { success: false, message: 'El pedido está vacío.' };
        }

        const nowIso = new Date().toISOString();

        try {
          const saleId = await db.transaction(
            'rw',
            [db.table(STORES.SALES), db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)],
            async () => {
              const salesTable = db.table(STORES.SALES);
              let existingSale = null;
              if (activeOrderId) {
                assertRestaurantCloudTableEditable(await salesTable.get(activeOrderId));
              }

              // A successful table save may outlive the actor that was closing
              // its tab. Never reserve that stale draft a second time.
              if (!isSavedOrder && activeOrderId) {
                const durableSale = await salesTable.get(activeOrderId);
                if (durableSale?.tableTabCleanup?.status === 'pending') {
                  const pendingError = new Error('La mesa ya quedó guardada. Vuelve a cargarla antes de editarla.');
                  pendingError.code = 'TABLE_RUNTIME_CLEANUP_PENDING';
                  throw pendingError;
                }
              }

              if (isSavedOrder && activeOrderId) {
                existingSale = await salesTable.get(activeOrderId);
                if (!existingSale) throw new Error('La orden activa ya no existe.');
                if (existingSale.status !== SALE_STATUS.OPEN) throw new Error('La orden activa ya no está abierta.');
                if (compareOrderVersions(existingSale, currentOrder) > 0) {
                  throw new Error('La orden fue actualizada en otro dispositivo. Recarga antes de guardar.');
                }

                const previousReservedItems = getSellableItems(existingSale.items);
                if (previousReservedItems.length > 0) {
                  assertActorCurrent();
                  await releaseCommittedStock(previousReservedItems, { db, STORES, assertActorCurrent });
                }
              }

              // Pausing is a formal stock reservation. A later provisional cart
              // must not reserve units already claimed by an earlier local cart.
              if (!isSavedOrder && activeOrderId) {
                const directIds = [...new Set(currentItems
                  .filter(isDirectUnitCartItem)
                  .map((item) => getCartProductId(item) ?? item.id))];
                if (directIds.length > 0) {
                  const currentProducts = await Promise.all(directIds.map(
                    (id) => db.table(STORES.MENU).get(id)
                  ));
                  assertActorCurrent();
                  if (currentProducts.some((product) => !product || product.trackStock !== true
                    || !Number.isFinite(Number(product.stock)))) {
                    const error = new Error('No se pudo confirmar el inventario al guardar esta venta.');
                    error.code = 'LOCAL_STOCK_UNKNOWN';
                    throw error;
                  }

                  const liveState = get();
                  const liveOrder = liveState.activeOrders.get(activeOrderId);
                  if (!liveOrder || liveOrder.isSaved || liveOrder.isLockedForCheckout
                    || (orderSnapshot && liveOrder.revision !== currentOrder.revision)) {
                    const error = new Error('El carrito cambió antes de guardarse. Revisa las ventas.');
                    error.code = 'LOCAL_CART_STALE';
                    throw error;
                  }
                  const activeOrders = new Map(liveState.activeOrders);
                  activeOrders.set(activeOrderId, { ...liveOrder, items: currentItems });
                  const conflict = validateCartCheckoutPriority({
                    state: { ...liveState, activeOrders },
                    orderId: activeOrderId,
                    catalog: currentProducts
                  });
                  if (conflict) {
                    const error = new Error(
                      `No se puede guardar: la venta ${conflict.origin} tiene prioridad provisional de estas unidades.`
                    );
                    error.code = conflict.code;
                    throw error;
                  }
                }
              }

              assertActorCurrent();
              const committedCurrentItems = await commitStock(currentItems, { db, STORES });
              // This is still inside the parent transaction. Losing authority
              // during reservation aborts both stock and the table atomically.
              assertActorCurrent();

              const currentSaleId = activeOrderId || generateID('sal');
              const finalTableData = toSessionTableData(tableData ?? existingSale?.tableData ?? null);
              const persistedVersion = getNextPersistedOrderVersion(
                currentOrder,
                existingSale,
                nowIso
              );

              const openSaleRecord = {
                ...(existingSale || {}),
                id: currentSaleId,
                timestamp: resolveImmutableOrderCreatedAt({
                  durableOrder: existingSale,
                  activeOrder: currentOrder
                }),
                ...persistedVersion,
                items: committedCurrentItems,
                total: calculateOrderTotalExact(committedCurrentItems),
                status: SALE_STATUS.OPEN,
                orderType: TABLE_ORDER_TYPE,
                fulfillmentStatus: saveOptions.tableTabCleanup
                  ? 'pending' : existingSale?.fulfillmentStatus || OPEN_FULFILLMENT_STATUS,
                ...(saveOptions.tableTabCleanup ? { tableTabCleanup: { ...saveOptions.tableTabCleanup } } : {}),
                tableData: finalTableData,
                checkoutDraft: false
              };

              await salesTable.put(openSaleRecord);
              assertActorCurrent();
              return currentSaleId;
            }
          );

          // Una vez guardado, useActiveOrders se encargará de pausar o cerrar.
          return { success: true, id: saleId };
        } catch (error) {
          if (String(error?.code || '').startsWith('ACTOR_')) throw error;
          return { success: false, ...(error?.code ? { code: error.code } : {}), message: error?.message || 'No se pudo guardar la orden abierta.' };
        }
      },

      getTotalPrice: () => {
        const currentOrder = getCurrentOrder(get());
        if (isRestaurantCloudTableShadow(currentOrder)) return Number(currentOrder.total);
        const order = currentOrder?.items || [];
        const exactTotal = order.reduce((sum, item) => {
          if (item.quantity && item.quantity > 0) {
            const lineTotal = Money.multiply(item.price, item.quantity);
            return Money.add(sum, lineTotal);
          }
          return sum;
        }, Money.init(0));
        return Money.toNumber(exactTotal);
      },

      reconcileOrphanedOrders: async () => {
        const currentActiveId = get().currentOrderId;
        const now = new Date();
        const LOCK_TTL_MINUTES = 15;

        try {
          const repairedBatchParents = await reconcileBatchParentCommittedStock();
          const salesTable = db.table(STORES.SALES);
          const [openSales, legacyReviewSales] = await Promise.all([
            salesTable.where('status').equals(SALE_STATUS.OPEN).toArray(),
            salesTable.where('status').equals(SALE_STATUS.REQUIRES_REVIEW).toArray()
          ]);

          // `requires_review` no es un estado financiero terminal. Versiones anteriores
          // ocultaban estas órdenes de Mesas sin liberar su inventario comprometido.
          for (const sale of legacyReviewSales) {
            if (isRestaurantCloudTableShadow(sale)) continue;
            await salesTable.update(sale.id, {
              status: SALE_STATUS.OPEN,
              requiresReview: true,
              reviewReason: sale.reviewReason || 'Orden inactiva. Requiere revisión manual.',
              updatedAt: now.toISOString()
            });
          }

          const recoverableOpenSales = [
            ...openSales,
            ...legacyReviewSales.map((sale) => ({
              ...sale,
              status: SALE_STATUS.OPEN,
              requiresReview: true,
              updatedAt: now.toISOString()
            }))
          ];

          if (recoverableOpenSales.length === 0) {
            return { success: true, count: 0, recovered: 0, repairedBatchParents };
          }

          let unlockedCount = 0;
          for (const sale of recoverableOpenSales) {
            if (isRestaurantCloudTableShadow(sale)) continue;
            if (sale.isLockedForCheckout && sale.lockedAt) {
              const lockedDate = new Date(sale.lockedAt);
              const minutesLocked = (now - lockedDate) / (1000 * 60);

              if (minutesLocked > LOCK_TTL_MINUTES) {
                await salesTable.update(sale.id, {
                  isLockedForCheckout: false,
                  lockedAt: null,
                  updatedAt: now.toISOString()
                });
                console.warn(`[Garbage Collector] Orden ${sale.id} liberada.`);
                unlockedCount++;
                sale.isLockedForCheckout = false;
              }
            }
          }

          const orphanedSales = recoverableOpenSales.filter((sale) => {
            if (isRestaurantCloudTableShadow(sale)) return false;
            if (sale.id === currentActiveId) return false;
            const saleDate = new Date(sale.updatedAt || sale.timestamp);
            const hoursDiff = (now - saleDate) / (1000 * 60 * 60);
            return hoursDiff > 2;
          });

          if (orphanedSales.length === 0 && unlockedCount === 0 && legacyReviewSales.length === 0) {
            return { success: true, count: 0, recovered: 0, repairedBatchParents };
          }

          if (orphanedSales.length > 0) {
            for (const orphan of orphanedSales) {
              await salesTable.update(orphan.id, {
                status: SALE_STATUS.OPEN,
                requiresReview: true,
                reviewReason: 'Orden inactiva por más de 2 horas. Requiere revisión manual.',
                updatedAt: now.toISOString()
              });
            }
          }

          return {
            success: true,
            count: orphanedSales.length,
            recovered: legacyReviewSales.length,
            repairedBatchParents,
            unlocked: unlockedCount
          };
        } catch (error) {
          console.error('❌ Falla crítica en la reconciliación:', error);
          return { success: false, message: error.message };
        }
      },
});
