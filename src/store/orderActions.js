import { calculateCompositePrice, validateWholesaleCondition } from '../services/pricingLogic';
import { showMessageModal, generateID } from '../services/utils';
import { db, STORES } from '../services/db/dexie';
import { getAvailableStock, getCommittedStock, normalizeStock } from '../services/db/utils';
import { commitStock, releaseCommittedStock, getSortedBatchesForProduct } from '../services/sales/inventoryFlow';
import { SALE_STATUS } from '../services/sales/financialStats';
import { Money } from '../utils/moneyMath';
import {
  compareOrderVersions,
  getNextPersistedOrderVersion
} from '../services/orders/orderVersioning';

const OPEN_FULFILLMENT_STATUS = 'open';
const TABLE_ORDER_TYPE = 'table';

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

const buildScannedLineId = (product) =>
  product?.uniqueLineId ||
  `${product?.id || 'scan'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const summarizeScannedProducts = (items = []) => {
  const groupedItems = [];

  for (const item of items) {
    if (!item?.id) {
      continue;
    }

    const quantity = Math.max(1, Number(item.quantity) || 1);

    if (!shouldAggregateScannedProduct(item)) {
      for (let index = 0; index < quantity; index += 1) {
        groupedItems.push({
          ...item,
          quantity: 1,
          uniqueLineId: buildScannedLineId(item),
        });
      }

      continue;
    }

    const existingIndex = findScannedProductIndex(groupedItems, item);

    if (existingIndex === -1) {
      groupedItems.push({
        ...item,
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
      const newItem = {
        ...groupedItem,
        quantity: 1,
        uniqueLineId: buildScannedLineId(groupedItem),
        exceedsStock: groupedItem.trackStock && 1 > (groupedItem.stock || 99999),
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
        quantity: newQuantity,
        exceedsStock: existingItem.trackStock && newQuantity > (existingItem.stock || 99999),
      };

      touchedItems.push(nextOrder[existingItemIndex]);
      incrementedCount += quantity;
      continue;
    }

    const newItem = {
      ...groupedItem,
      quantity,
      exceedsStock: groupedItem.trackStock && quantity > (groupedItem.stock || 99999),
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
        const requiresBatchResolution = (
          product?.batchManagement?.enabled &&
          !product.batchId &&
          Boolean(product.id)
        );

        if (!requiresBatchResolution) {
          get().addItem({ ...product }, orderId);
          return;
        }

        set((state) => {
          const pendingInventoryResolutions = new Map(state.pendingInventoryResolutions || []);
          const pendingCount = pendingInventoryResolutions.get(orderId) || 0;
          pendingInventoryResolutions.set(orderId, pendingCount + 1);
          return { pendingInventoryResolutions };
        });

        try {
          const sellableBatches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId')
            .equals(product.id)
            .filter(batch => batch.isActive === true && batch.stock > 0)
            .toArray();

          const sortedBatches = getSortedBatchesForProduct(sellableBatches, product);
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

          const productToAdd = validBatch
            ? {
                ...product,
                batchId: validBatch.id,
                price: validBatch.price,
                cost: validBatch.cost,
                stock: getAvailableStock(validBatch),
                isVariant: true,
                skuDetected: validBatch.sku || product.sku,
                originalPrice: validBatch.price
              }
            : { ...product };

          get().addItem(productToAdd, orderId);
        } catch (error) {
          console.warn("Fallo al resolver el lote antes de agregar el producto:", error);
          get().addItem({ ...product }, orderId);
        } finally {
          set((state) => {
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
        get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          const existingItemIndex = order.findIndex((item) => {
            if (product.isVariant && product.batchId) {
              return item.batchId === product.batchId;
            }
            return item.id === product.id;
          });

          let quantityToCheck = 1;
          let existingItem = null;

          if (existingItemIndex >= 0) {
            existingItem = order[existingItemIndex];
            quantityToCheck = existingItem.quantity + 1;
          }

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
                  const idx = currentOrder.findIndex((item) =>
                    (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
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
                      const idx = currentOrder.findIndex((item) =>
                        (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
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
              quantity: newQuantity,
              price: finalPrice,
              exceedsStock: currentItem.trackStock && newQuantity > (currentItem.stock || 99999),
              priceWarning: isPriceWarning,
              forceWholesale: validation.status === 'conflict' ? (currentItem.forceWholesale || false) : false,
              forceSafePrice: validation.status === 'conflict' ? (currentItem.forceSafePrice || false) : false,
            };
            return updatedOrder;
          } else {
            const newItem = {
              ...product,
              quantity: 1,
              price: initialPrice,
              originalPrice: product.originalPrice ?? product.price,
              stock: product.trackStock ? getAvailableStock(product) : product.stock,
              exceedsStock: product.trackStock && 1 > getAvailableStock(product),
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

        const result = { success: false, action: null, item: null };

        get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          const existingItemIndex = order.findIndex((item) => {
            if (resolvedProduct.isVariant && resolvedProduct.batchId) {
              return item.batchId === resolvedProduct.batchId;
            }
            return item.id === resolvedProduct.id;
          });

          if (existingItemIndex >= 0) {
            const existingItem = order[existingItemIndex];

            if (existingItem.saleType === 'unit') {
              const newQuantity = existingItem.quantity + 1;
              const newOrder = [...order];
              newOrder[existingItemIndex] = {
                ...existingItem,
                quantity: newQuantity,
                exceedsStock: existingItem.trackStock && newQuantity > (existingItem.stock || 99999)
              };

              result.success = true;
              result.action = 'incremented';
              result.item = newOrder[existingItemIndex];
              return newOrder;
            } else {
              const newItem = {
                ...resolvedProduct,
                uniqueLineId: `${resolvedProduct.id}-${Date.now()}`,
                quantity: 1,
                exceedsStock: resolvedProduct.trackStock && 1 > (resolvedProduct.stock || 99999)
              };

              result.success = true;
              result.action = 'added';
              result.item = newItem;
              return [...order, newItem];
            }
          } else {
            const newItem = {
              ...resolvedProduct,
              quantity: 1,
              exceedsStock: resolvedProduct.trackStock && 1 > (resolvedProduct.stock || 99999)
            };

            result.success = true;
            result.action = 'added';
            result.item = newItem;
            return [...order, newItem];
          }
        });

        return result;
      },

      addMultipleScannedProducts: (itemsArray = [], orderId = get().currentOrderId) => {
        if (!Array.isArray(itemsArray) || itemsArray.length === 0) {
          return { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };
        }

        let actionResult = { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };

        get().updateOrderItems(orderId, (prevOrder) => {
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

        return actionResult;
      },

      updateItemQuantity: (itemId, newQuantity, orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, (prevOrder) => {
          const order = prevOrder || [];
          return order.map((item) => {
            if (item.id === itemId) {
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
                          if (i.id === itemId) {
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
                              if (i.id === itemId) {
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

      removeItem: (itemId, orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, (prevOrder) => (prevOrder || []).filter((item) => item.id !== itemId));
      },

      clearOrder: (orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, []);
      },

      setOrder: (newOrder, orderId = get().currentOrderId) => {
        get().updateOrderItems(orderId, newOrder);
      },

      setTableData: (tableData, orderId = get().currentOrderId) => {
        get().updateOrder(orderId, { tableData });
      },

      saveOrderAsOpen: async (orderId = get().currentOrderId, orderSnapshot = null) => {
        const state = get();
        const activeOrderId = orderId;
        const currentOrder = orderSnapshot || (orderId ? state.activeOrders.get(orderId) || null : null);
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

              if (isSavedOrder && activeOrderId) {
                existingSale = await salesTable.get(activeOrderId);
                if (!existingSale) throw new Error('La orden activa ya no existe.');
                if (existingSale.status !== SALE_STATUS.OPEN) throw new Error('La orden activa ya no está abierta.');
                if (compareOrderVersions(existingSale, currentOrder) > 0) {
                  throw new Error('La orden fue actualizada en otro dispositivo. Recarga antes de guardar.');
                }

                const previousReservedItems = getSellableItems(existingSale.items);
                if (previousReservedItems.length > 0) {
                  await releaseCommittedStock(previousReservedItems, { db, STORES });
                }
              }

              const committedCurrentItems = await commitStock(currentItems, { db, STORES });

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
                timestamp: existingSale?.timestamp || nowIso,
                ...persistedVersion,
                items: committedCurrentItems,
                total: calculateOrderTotalExact(committedCurrentItems),
                status: SALE_STATUS.OPEN,
                orderType: TABLE_ORDER_TYPE,
                fulfillmentStatus: existingSale?.fulfillmentStatus || OPEN_FULFILLMENT_STATUS,
                tableData: finalTableData
              };

              await salesTable.put(openSaleRecord);
              return currentSaleId;
            }
          );

          // Una vez guardado, useActiveOrders se encargará de pausar o cerrar.
          return { success: true, id: saleId };
        } catch (error) {
          return { success: false, message: error?.message || 'No se pudo guardar la orden abierta.' };
        }
      },

      getTotalPrice: () => {
        const order = getCurrentOrder(get())?.items || [];
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
