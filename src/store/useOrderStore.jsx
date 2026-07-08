// src/store/useOrderStore.jsx
import { create } from 'zustand';
import { calculateCompositePrice, validateWholesaleCondition } from '../services/pricingLogic';
import { safeLocalStorageSet, showMessageModal, generateID } from '../services/utils';
import { db, STORES } from '../services/db/dexie';
import { getAvailableStock } from '../services/db/utils';
import { commitStock, releaseCommittedStock, getSortedBatchesForProduct } from '../services/sales/inventoryFlow';
import { SALE_STATUS } from '../services/sales/financialStats';
import { Money } from '../utils/moneyMath';
import {
  createCartLineId,
  getCartLineId,
  isCartLineMatch,
  shouldCreateSeparateCartLine
} from '../utils/cartLineIdentity';
import { useActiveOrders } from '../hooks/pos/useActiveOrders';

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
  product?.lineId ||
  product?.uniqueLineId ||
  createCartLineId(product);

export const summarizeScannedProducts = (items = []) => {
  const groupedItems = [];

  for (const item of items) {
    if (!item?.id) {
      continue;
    }

    const quantity = Math.max(1, Number(item.quantity) || 1);

    if (!shouldAggregateScannedProduct(item)) {
      for (let index = 0; index < quantity; index += 1) {
        const lineId = buildScannedLineId(item);
        groupedItems.push({
          ...item,
          quantity: 1,
          lineId,
          uniqueLineId: item.uniqueLineId || lineId,
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
      const lineId = buildScannedLineId(groupedItem);
      const newItem = {
        ...groupedItem,
        quantity: 1,
        lineId,
        uniqueLineId: groupedItem.uniqueLineId || lineId,
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

const CORRUPTED_PREFIX = 'lanzo-cart-storage-corrupted-';
const MAX_BACKUPS = 3;

/**
 * Aísla el estado corrupto en la base de datos (IndexedDB) de forma asíncrona.
 * Mantiene un límite de respaldos usando una cola FIFO.
 */
const backupCorruptedState = async (rawData) => {
  try {
    const backupsTable = db.table(STORES.CORRUPTED_STATES);
    const count = await backupsTable.count();

    // Limpieza circular: liberar espacio si hemos alcanzado o superado el límite
    if (count >= MAX_BACKUPS) {
      const excess = count - MAX_BACKUPS + 1;
      const oldestBackups = await backupsTable.orderBy('timestamp').limit(excess).primaryKeys();
      await backupsTable.bulkDelete(oldestBackups);
    }

    // Guardado asíncrono en IndexedDB
    const entropy = Math.random().toString(36).substring(2, 7);
    const backupId = `${CORRUPTED_PREFIX}${Date.now()}-${entropy}`;

    await backupsTable.put({
      id: backupId,
      timestamp: new Date().toISOString(),
      rawData
    });

  } catch (backupError) {
    console.error('Fallo al intentar respaldar el estado corrupto en IndexedDB:', backupError);
  }
};

const safeStorage = {
  getItem: (name) => {
    let rawItem = null;
    try {
      rawItem = localStorage.getItem(name);
      if (!rawItem) return null;

      JSON.parse(rawItem);
      return rawItem;
    } catch (parseError) {
      console.error(`Estado corrupto detectado en ${name}, aislando datos antes de purgar...`);

      // 1. Respaldo síncrono garantizado en LocalStorage para evitar pérdida por crash
      let syncBackupId = null;
      if (rawItem) {
        const entropy = Math.random().toString(36).substring(2, 7);
        syncBackupId = `${CORRUPTED_PREFIX}sync-${Date.now()}-${entropy}`;
        try {
          localStorage.setItem(syncBackupId, rawItem);
        } catch (syncError) {
          console.error('Fallo al intentar respaldo síncrono:', syncError);
        }
      }

      // 2. Purgar la clave principal de manera síncrona para que no siga fallando
      try {
        localStorage.removeItem(name);
      } catch (removeError) {
        console.error(`Fallo crítico al intentar purgar la clave principal ${name}:`, removeError);
      }

      // 3. Ejecutar respaldo asíncrono en IndexedDB como almacenamiento a largo plazo
      if (rawItem) {
        backupCorruptedState(rawItem).finally(() => {
          // Limpiar el respaldo síncrono una vez que IndexedDB haya terminado
          if (syncBackupId) {
            try {
              localStorage.removeItem(syncBackupId);
            } catch (e) {
              console.error('Fallo al limpiar el respaldo síncrono:', e);
            }
          }
        });
      }

      return null;
    }
  },
  setItem: (name, value) => {
    // Guardar inmediatamente para garantizar recuperación en recarga
    // (el debounce causaba pérdida de datos si se recargaba antes de 300ms)
    safeLocalStorageSet(name, value);
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch (e) {
      console.error(`Fallo al remover ${name}:`, e);
    }
  },
};

export const useOrderStore = create((set, get) => {
  return {
      addSmartItem: (product) => {
        const productToAdd = { ...product };

        // ACCIÓN INMEDIATA
        get().addItem(productToAdd);

        // BÚSQUEDA DE LOTES EN BACKGROUND
        if (product.batchManagement?.enabled && !product.batchId) {
          if (!product.id) return;

          db.table(STORES.PRODUCT_BATCHES)
            .where('productId')
            .equals(product.id)
            .filter(b => b.isActive === true && b.stock > 0)
            .toArray()
            .then((sellableBatches) => {
              if (sellableBatches.length > 0) {
                const sortedBatches = getSortedBatchesForProduct(sellableBatches, product);
                let validBatch = null;

                if (product.saleType === 'bulk') {
                  const UMBRAL_POLVO = 0.020;
                  validBatch = sortedBatches.find(b => getAvailableStock(b) > UMBRAL_POLVO);
                  if (!validBatch) validBatch = sortedBatches[sortedBatches.length - 1];
                } else {
                  validBatch = sortedBatches[0];
                }

                if (validBatch) {
                  useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => {
                    const order = prevOrder || [];
                    const itemIndex = order.findIndex(
                      item => item.id === product.id && !item.batchId
                    );

                    if (itemIndex >= 0) {
                      const updatedOrder = [...order];
                      updatedOrder[itemIndex] = {
                        ...updatedOrder[itemIndex],
                        batchId: validBatch.id,
                        price: validBatch.price,
                        cost: validBatch.cost,
                        stock: getAvailableStock(validBatch),
                        isVariant: true,
                        skuDetected: validBatch.sku || product.sku
                      };
                      return updatedOrder;
                    }
                    return order;
                  });
                }
              }
            })
            .catch((error) => {
              console.warn("⚠️ Fallo en asignación de lote (background):", error);
            });
        }
      },

      addItem: (product) => {
        useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => {
          const order = prevOrder || [];
          const canAggregateProduct = !shouldCreateSeparateCartLine(product);
          const existingItemIndex = canAggregateProduct
            ? order.findIndex((item) => {
                if (shouldCreateSeparateCartLine(item)) return false;
                if (product.isVariant && product.batchId) {
                  return item.batchId === product.batchId;
                }
                return item.id === product.id;
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
                useActiveOrders.getState().updateCurrentOrderItems((innerState) => {
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
                    useActiveOrders.getState().updateCurrentOrderItems((innerState) => {
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
              lineId: targetLineId,
              quantity: 1,
              price: initialPrice,
              originalPrice: product.price,
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

      addScannedProduct: (resolvedProduct) => {
        if (!resolvedProduct || !resolvedProduct.id) {
          console.error('addScannedProduct: Producto inválido', resolvedProduct);
          return { success: false, action: null, item: null };
        }

        let result = { success: false, action: null, item: null };

        useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => {
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
                lineId: createCartLineId(resolvedProduct),
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
              lineId: createCartLineId(resolvedProduct),
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

      addMultipleScannedProducts: (itemsArray = []) => {
        if (!Array.isArray(itemsArray) || itemsArray.length === 0) {
          return { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };
        }

        let actionResult = { success: false, addedCount: 0, incrementedCount: 0, failedCount: 0, items: [] };

        useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => {
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

      updateItemQuantity: (lineId, newQuantity) => {
        useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => {
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
                      useActiveOrders.getState().updateCurrentOrderItems((innerState) => {
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
                          useActiveOrders.getState().updateCurrentOrderItems((innerState) => {
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

      removeItem: (lineId) => {
        useActiveOrders.getState().updateCurrentOrderItems((prevOrder) => (
          (prevOrder || []).filter((item, index) => !isCartLineMatch(item, lineId, index))
        ));
      },

      clearOrder: () => {
        useActiveOrders.getState().updateCurrentOrderItems([]);
      },

      setOrder: (newOrder) => {
        useActiveOrders.getState().updateCurrentOrderItems(newOrder);
      },

      setTableData: (tableData) => {
        useActiveOrders.getState().updateCurrentOrder({ tableData });
      },

      clearSession: () => {
        // La sesión (estado de la orden actual) ahora es administrada íntegramente por useActiveOrders.
        // Las llamadas a clearSession desde el exterior ahora son redundantes y serán removidas gradualmente.
      },

      loadOpenOrder: async (id) => {
        // useActiveOrders.js se encarga de cargar las ordenes en loadOrdersFromDB
        // Este método queda obsoleto
        return { success: false, message: 'Delegado a useActiveOrders' };
      },

      saveOrderAsOpen: async () => {
        const activeOrderId = useActiveOrders.getState().currentOrderId;
        const currentOrder = useActiveOrders.getState().currentOrder;
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

                const previousReservedItems = getSellableItems(existingSale.items);
                if (previousReservedItems.length > 0) {
                  await releaseCommittedStock(previousReservedItems, { db, STORES });
                }
              }

              const committedCurrentItems = await commitStock(currentItems, { db, STORES });

              const currentSaleId = activeOrderId || generateID('sal');
              const finalTableData = toSessionTableData(tableData ?? existingSale?.tableData ?? null);

              const openSaleRecord = {
                ...(existingSale || {}),
                id: currentSaleId,
                timestamp: existingSale?.timestamp || nowIso,
                updatedAt: nowIso,
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
        const order = useActiveOrders.getState().currentOrder?.items || [];
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
        const currentActiveId = useActiveOrders.getState().currentOrderId;
        const now = new Date();
        const LOCK_TTL_MINUTES = 15;

        try {
          const openSales = await db.table(STORES.SALES).where('status').equals(SALE_STATUS.OPEN).toArray();
          if (openSales.length === 0) return { success: true, count: 0 };

          let unlockedCount = 0;
          for (const sale of openSales) {
            if (sale.isLockedForCheckout && sale.lockedAt) {
              const lockedDate = new Date(sale.lockedAt);
              const minutesLocked = (now - lockedDate) / (1000 * 60);

              if (minutesLocked > LOCK_TTL_MINUTES) {
                await db.table(STORES.SALES).update(sale.id, {
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

          const orphanedSales = openSales.filter((sale) => {
            if (sale.id === currentActiveId) return false;
            const saleDate = new Date(sale.updatedAt || sale.timestamp);
            const hoursDiff = (now - saleDate) / (1000 * 60 * 60);
            return hoursDiff > 2;
          });

          if (orphanedSales.length === 0 && unlockedCount === 0) return { success: true, count: 0 };

          if (orphanedSales.length > 0) {
            for (const orphan of orphanedSales) {
              await db.table(STORES.SALES).update(orphan.id, {
                status: SALE_STATUS.REQUIRES_REVIEW,
                notes: 'Sistema: Orden inactiva por más de 2 horas. Requiere revisión manual.',
                updatedAt: now.toISOString()
              });
            }
          }

          return { success: true, count: orphanedSales.length, unlocked: unlockedCount };
        } catch (error) {
          console.error('❌ Falla crítica en la reconciliación:', error);
          return { success: false, message: error.message };
        }
      },
    };
});

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.hackStore = useOrderStore;
}
