// src/store/useOrderStore.jsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { calculateCompositePrice, validateWholesaleCondition } from '../services/pricingLogic';
import { safeLocalStorageSet, showMessageModal, generateID } from '../services/utils';
import { queryBatchesByProductIdAndActive } from '../services/database';
import { db, STORES } from '../services/db/dexie';
import { getAvailableStock } from '../services/db/utils';
import { commitStock, releaseCommittedStock } from '../services/sales/inventoryFlow';
import { SALE_STATUS } from '../services/sales/financialStats';
import { Money } from '../utils/moneyMath';

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

const CORRUPTED_PREFIX = 'lanzo-cart-storage-corrupted-';
const MAX_BACKUPS = 3;

/**
 * Aísla el estado corrupto en una nueva clave antes de purgarlo.
 * Mantiene un límite de respaldos usando una cola FIFO.
 */
const backupCorruptedState = (rawData) => {
  try {
    const backupKeys = [];

    // 1. Recolección segura: Extraer primero para evitar saltos de índice 
    // si mutamos el localStorage durante la iteración.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CORRUPTED_PREFIX)) {
        backupKeys.push(key);
      }
    }

    // 2. Ordenamiento cronológico basado en el timestamp extraído
    backupKeys.sort((a, b) => {
      const timeA = parseInt(a.replace(CORRUPTED_PREFIX, '').split('-')[0], 10) || 0;
      const timeB = parseInt(b.replace(CORRUPTED_PREFIX, '').split('-')[0], 10) || 0;
      return timeA - timeB; // Ascendente (más viejos al principio)
    });

    // 3. Limpieza circular: liberar espacio si hemos alcanzado el límite
    while (backupKeys.length >= MAX_BACKUPS) {
      const oldestKey = backupKeys.shift();
      localStorage.removeItem(oldestKey);
    }

    // 4. Guardado con entropía para evitar colisiones
    const entropy = Math.random().toString(36).substring(2, 7);
    const newBackupKey = `${CORRUPTED_PREFIX}${Date.now()}-${entropy}`;

    localStorage.setItem(newBackupKey, rawData);

  } catch (backupError) {
    // Si la cuota está excedida (QuotaExceededError) o el storage está bloqueado,
    // atrapamos el error silenciosamente para no interrumpir el flujo principal de purga.
    console.error('Fallo al intentar respaldar el estado corrupto:', backupError);
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

      // Ejecutar respaldo en un flujo independiente
      if (rawItem) {
        backupCorruptedState(rawItem);
      }

      // La purga principal también requiere protección contra bloqueos del navegador
      try {
        localStorage.removeItem(name);
      } catch (removeError) {
        console.error(`Fallo crítico al intentar purgar la clave principal ${name}:`, removeError);
      }

      return null;
    }
  },
  setItem: (name, value) => {
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

export const useOrderStore = create(
  persist(
    (set, get) => ({
      order: [],
      activeOrderId: null,
      tableData: null,

      // --- [NUEVO] FUNCIÓN INTELIGENTE PARA ABARROTES ---
      // Esta es la función que debe llamar tu UI (Scanner y Menú)
      addSmartItem: async (product) => {
        let productToAdd = { ...product };

        // Solo aplicamos lógica avanzada si maneja lotes
        if (product.batchManagement?.enabled && !product.batchId) {
          try {
            // Traemos SOLO los activos (ahora es muy rápido gracias al índice)
            const activeBatches = await queryBatchesByProductIdAndActive(product.id, true);

            const sellableBatches = (activeBatches || []).filter((batch) => getAvailableStock(batch) > 0);

            if (sellableBatches.length > 0) {
              // Ordenar FIFO
              sellableBatches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

              // --- MEJORA ESPECÍFICA VERDULERÍA: FILTRO DE "POLVO" ---
              // Si es venta a granel (bulk), ignoramos lotes con stock absurdo (< 10 gramos)
              // Esto evita que el sistema se aferre a un lote que ya no existe físicamente.
              let validBatch = null;

              if (product.saleType === 'bulk') {
                // Buscamos el primer lote que tenga una cantidad "vendible" (ej. > 20 gramos)
                // OJO: Si es el ÚNICO lote que queda, lo usamos aunque sea poco.
                const UMBRAL_POLVO = 0.020; // 20 gramos

                validBatch = sellableBatches.find(b => getAvailableStock(b) > UMBRAL_POLVO);

                // Si todos son "polvo", usamos el último disponible o el que tenga más
                if (!validBatch) validBatch = sellableBatches[sellableBatches.length - 1];
              } else {
                // Para piezas (lechugas, sandías), stock > 0 es suficiente
                validBatch = sellableBatches[0];
              }

              if (validBatch) {
                productToAdd = {
                  ...productToAdd,
                  batchId: validBatch.id,
                  price: validBatch.price,
                  cost: validBatch.cost,
                  stock: getAvailableStock(validBatch),
                  isVariant: true,
                  skuDetected: validBatch.sku || product.sku
                };
              }
            }
          } catch (error) {
            console.warn("⚠️ Fallo en asignación de lote:", error);
          }
        }

        get().addItem(productToAdd);
      },

      addItem: (product) => {
        set((state) => {
          const { order } = state;

          const existingItemIndex = order.findIndex((item) => {
            if (product.isVariant && product.batchId) {
              return item.batchId === product.batchId;
            }
            return item.id === product.id;
          });

          // Calculamos cantidad tentativa
          let quantityToCheck = 1;
          let existingItem = null;

          if (existingItemIndex >= 0) {
            existingItem = order[existingItemIndex];
            quantityToCheck = existingItem.quantity + 1;
          }

          // 1. VALIDACIÓN
          const validation = validateWholesaleCondition(product, quantityToCheck);

          let initialPrice;
          let isPriceWarning = false;
          let shouldShowModal = false;

          // Recuperamos decisiones previas (si el item ya existe)
          const forceWholesale = existingItem?.forceWholesale || false;
          const forceSafePrice = existingItem?.forceSafePrice || false;

          // --- LÓGICA CON MEMORIA ---
          if (validation.status === 'conflict') {
            if (forceWholesale) {
              // CASO 1: El usuario YA HABÍA ACEPTADO la pérdida anteriormente
              initialPrice = validation.tierPrice;
              isPriceWarning = true; // Mantenemos la alerta visual
            } else if (forceSafePrice) {
              // CASO 2: El usuario YA HABÍA RECHAZADO (quería precio regular)
              initialPrice = validation.safePrice;
              isPriceWarning = true;
            } else {
              // CASO 3: Primera vez que ocurre el conflicto -> PREGUNTAR
              initialPrice = validation.safePrice; // Protegemos por defecto
              isPriceWarning = true;
              shouldShowModal = true;
            }
          } else {
            // No hay conflicto, calculamos normal
            initialPrice = calculateCompositePrice(product, quantityToCheck);
          }

          // --- MODAL (Solo si shouldShowModal es true) ---
          if (shouldShowModal) {
            showMessageModal(
              `El precio de mayoreo ($${validation.tierPrice}) es menor al costo ($${validation.cost}).\n\n¿Deseas autorizar esta venta bajo costo?`,
              () => {
                // ACCIÓN "SÍ" (Autorizar)
                set((innerState) => {
                  const currentOrder = [...innerState.order];
                  const idx = currentOrder.findIndex((item) =>
                    (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
                  );
                  if (idx >= 0) {
                    currentOrder[idx] = {
                      ...currentOrder[idx],
                      price: validation.tierPrice, // Aplicamos precio bajo
                      forceWholesale: true,        // RECORDAR DECISIÓN [SÍ]
                      forceSafePrice: false
                    };
                  }
                  return { order: currentOrder };
                });
              },
              {
                title: '⚠️ Autorización de Costo',
                type: 'warning',
                confirmButtonText: 'Sí, Autorizar',
                showCancel: false,
                // Usamos el botón extra para el "No" explícito con memoria
                extraButton: {
                  text: 'No, Precio Regular',
                  action: () => {
                    // ACCIÓN "NO" (Mantener regular y no molestar)
                    set((innerState) => {
                      const currentOrder = [...innerState.order];
                      const idx = currentOrder.findIndex((item) =>
                        (product.isVariant && product.batchId) ? item.batchId === product.batchId : item.id === product.id
                      );
                      if (idx >= 0) {
                        currentOrder[idx] = {
                          ...currentOrder[idx],
                          forceSafePrice: true, // RECORDAR DECISIÓN [NO]
                          forceWholesale: false
                        };
                      }
                      return { order: currentOrder };
                    });
                  }
                }
              }
            );
          }

          // --- ACTUALIZACIÓN DEL CARRITO ---
          if (existingItemIndex >= 0) {
            const currentItem = order[existingItemIndex];
            const newQuantity = currentItem.quantity + 1;

            // Si ya tomamos una decisión (Wholesale/Safe), initialPrice ya tiene el valor correcto.
            // Si NO había conflicto, recalculamos el precio compuesto.
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
              // Si NO hay conflicto, reseteamos las banderas (por si bajó la cantidad y volvió a subir)
              forceWholesale: validation.status === 'conflict' ? (currentItem.forceWholesale || false) : false,
              forceSafePrice: validation.status === 'conflict' ? (currentItem.forceSafePrice || false) : false,
            };
            return { order: updatedOrder };

          } else {
            // Nuevo Item
            const newItem = {
              ...product,
              quantity: 1,
              price: initialPrice,
              originalPrice: product.price,
              stock: product.trackStock ? getAvailableStock(product) : product.stock,
              exceedsStock: product.trackStock && 1 > getAvailableStock(product),
              priceWarning: isPriceWarning,
              // Inicializamos banderas en falso
              forceWholesale: false,
              forceSafePrice: false
            };
            return { order: [...order, newItem] };
          }
        });
      },

      updateItemQuantity: (itemId, newQuantity) => {
        set((state) => {
          const updatedOrder = state.order.map((item) => {
            if (item.id === itemId) {
              const safeQuantity = newQuantity === null ? 0 : newQuantity;
              const validation = validateWholesaleCondition(item, safeQuantity);

              let newPrice;
              let isPriceProtected = false;
              let shouldShowModal = false;

              // --- LÓGICA CON MEMORIA (UPDATE) ---
              if (validation.status === 'conflict') {
                isPriceProtected = true;

                if (item.forceWholesale) {
                  // Ya autorizado previamente -> Silencio
                  newPrice = validation.tierPrice;
                } else if (item.forceSafePrice) {
                  // Ya rechazado previamente -> Silencio
                  newPrice = validation.safePrice;
                } else {
                  // Conflicto nuevo -> Preguntar
                  newPrice = validation.safePrice; // Precio seguro mientras decide
                  shouldShowModal = true;
                }

                // Disparar modal solo si hay cantidad > 0 y no se ha decidido
                if (safeQuantity > 0 && shouldShowModal) {
                  showMessageModal(
                    `Al llevar ${safeQuantity} unidades, el precio baja a $${validation.tierPrice}, lo cual es menor al costo ($${validation.cost}).\n\n¿Autorizar precio bajo costo?`,
                    () => {
                      // CALLBACK SI (Autorizar)
                      set((innerState) => {
                        const innerOrder = innerState.order.map(i => {
                          if (i.id === itemId) {
                            return {
                              ...i,
                              price: validation.tierPrice,
                              forceWholesale: true, // RECORDAR
                              forceSafePrice: false
                            };
                          }
                          return i;
                        });
                        return { order: innerOrder };
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
                          // CALLBACK NO (Recordar negativa)
                          set((innerState) => {
                            const innerOrder = innerState.order.map(i => {
                              if (i.id === itemId) {
                                return {
                                  ...i,
                                  forceSafePrice: true, // RECORDAR
                                  forceWholesale: false
                                };
                              }
                              return i;
                            });
                            return { order: innerOrder };
                          });
                        }
                      }
                    }
                  );
                }
              } else {
                // SIN CONFLICTO
                newPrice = calculateCompositePrice(item, safeQuantity);
              }

              return {
                ...item,
                quantity: newQuantity,
                price: newPrice,
                exceedsStock: item.trackStock && safeQuantity > item.stock,
                priceWarning: isPriceProtected,
                // Reseteamos memoria si salimos de la zona de conflicto (ej. bajamos cantidad)
                forceWholesale: validation.status === 'conflict' ? item.forceWholesale : false,
                forceSafePrice: validation.status === 'conflict' ? item.forceSafePrice : false,
              };
            }
            return item;
          });
          return { order: updatedOrder };
        });
      },

      removeItem: (itemId) => {
        set((state) => ({
          order: state.order.filter((item) => item.id !== itemId),
        }));
      },

      clearOrder: () => set({ order: [] }),

      setOrder: (newOrder) => set({ order: newOrder }),

      setTableData: (tableData) => set({ tableData }),

      clearSession: () => set({
        order: [],
        activeOrderId: null,
        tableData: null,
      }),

      loadOpenOrder: async (id) => {
        if (!id) {
          return { success: false, message: 'Se requiere el id de la orden.' };
        }

        try {
          const sale = await db.table(STORES.SALES).get(id);

          if (!sale) {
            return { success: false, message: 'La orden no existe.' };
          }

          if (sale.status !== SALE_STATUS.OPEN) {
            return { success: false, message: 'La orden no está abierta.' };
          }

          set({
            order: Array.isArray(sale.items) ? sale.items : [],
            activeOrderId: sale.id,
            tableData: toSessionTableData(sale.tableData),
          });

          return { success: true };
        } catch (error) {
          console.error('No se pudo cargar la orden abierta:', error);
          return {
            success: false,
            message: error?.message || 'No se pudo cargar la orden abierta.'
          };
        }
      },

      saveOrderAsOpen: async () => {
        const state = get();
        const currentItems = getSellableItems(state.order);

        if (currentItems.length === 0) {
          return { success: false, message: 'El pedido está vacío.' };
        }

        const salesTable = db.table(STORES.SALES);
        const nowIso = new Date().toISOString();
        let existingSale = null;
        let previousReservedItems = [];
        let releasedPreviousReservation = false;
        let committedCurrentItems = [];

        try {
          if (state.activeOrderId) {
            existingSale = await salesTable.get(state.activeOrderId);

            if (!existingSale) {
              return { success: false, message: 'La orden activa ya no existe.' };
            }

            if (existingSale.status !== SALE_STATUS.OPEN) {
              return { success: false, message: 'La orden activa ya no está abierta.' };
            }

            previousReservedItems = getSellableItems(existingSale.items);
            if (previousReservedItems.length > 0) {
              await releaseCommittedStock(previousReservedItems, { db, STORES });
              releasedPreviousReservation = true;
            }
          }

          committedCurrentItems = await commitStock(currentItems, { db, STORES });

          const saleId = state.activeOrderId || generateID('sal');
          const tableData = toSessionTableData(state.tableData ?? existingSale?.tableData ?? null);

          const openSaleRecord = {
            ...(existingSale || {}),
            id: saleId,
            timestamp: existingSale?.timestamp || nowIso,
            updatedAt: nowIso,
            items: committedCurrentItems,
            total: calculateOrderTotalExact(committedCurrentItems),
            status: SALE_STATUS.OPEN,
            orderType: TABLE_ORDER_TYPE,
            fulfillmentStatus: OPEN_FULFILLMENT_STATUS,
            tableData
          };

          await salesTable.put(openSaleRecord);
          get().clearSession();

          return { success: true, id: saleId };
        } catch (error) {
          if (committedCurrentItems.length > 0) {
            try {
              await releaseCommittedStock(committedCurrentItems, { db, STORES });
            } catch (releaseError) {
              console.error('Rollback parcial: no se pudo liberar la nueva reserva.', releaseError);
            }
          }

          if (releasedPreviousReservation && previousReservedItems.length > 0) {
            try {
              await commitStock(previousReservedItems, { db, STORES });
            } catch (restoreError) {
              console.error('Rollback parcial: no se pudo restaurar la reserva previa.', restoreError);
            }
          }

          return {
            success: false,
            message: error?.message || 'No se pudo guardar la orden abierta.'
          };
        }
      },

      getTotalPrice: () => {
        const { order } = get();

        const exactTotal = order.reduce((sum, item) => {
          if (item.quantity && item.quantity > 0) {
            const lineTotal = Money.multiply(item.price, item.quantity);
            return Money.add(sum, lineTotal);
          }
          return sum;
        }, Money.init(0));

        // Delegamos la conversión y el redondeo estrictamente al wrapper
        return Money.toNumber(exactTotal);
      },

      // --- RECOLECCIÓN DE BASURA Y RECONCILIACIÓN ---
      reconcileOrphanedOrders: async () => {
        const state = get();
        const currentActiveId = state.activeOrderId;
        const now = new Date();

        try {
          // 1. Obtener TODAS las órdenes con estado 'open' en Dexie
          const openSales = await db.table(STORES.SALES)
            .where('status')
            .equals(SALE_STATUS.OPEN)
            .toArray();

          if (openSales.length === 0) return { success: true, count: 0 };

          // 2. Filtrar para encontrar las huérfanas.
          // Condición: No es la orden activa actual Y tiene cierta antigüedad para evitar colisiones.
          const orphanedSales = openSales.filter((sale) => {
            if (sale.id === currentActiveId) return false;

            // UMBRAL DE SEGURIDAD: Solo purgamos órdenes con más de 2 horas sin actividad.
            // Esto evita destruir órdenes legítimas si la app se recarga muy rápido.
            const saleDate = new Date(sale.updatedAt || sale.timestamp);
            const hoursDiff = (now - saleDate) / (1000 * 60 * 60);

            return hoursDiff > 2;
          });

          if (orphanedSales.length === 0) return { success: true, count: 0 };

          console.warn(`🧹 Encontradas ${orphanedSales.length} órdenes huérfanas. Reconciliando inventario...`);

          // 3. Procesar y liberar stock
          for (const orphan of orphanedSales) {
            const itemsToRelease = getSellableItems(orphan.items); // Asegúrate de que esta función esté al alcance

            if (itemsToRelease.length > 0) {
              await releaseCommittedStock(itemsToRelease, { db, STORES });
            }

            // 4. Neutralizar la orden (No borrarla, cambiar estado para auditoría)
            await db.table(STORES.SALES).update(orphan.id, {
              status: 'cancelled', // Te recomiendo agregar SALE_STATUS.CANCELLED a tus constantes
              notes: 'Sistema: Orden abandonada y stock liberado automáticamente.',
              updatedAt: now.toISOString()
            });
          }

          return { success: true, count: orphanedSales.length };

        } catch (error) {
          console.error('❌ Falla crítica en la reconciliación de inventario:', error);
          return { success: false, message: error.message };
        }
      },
    }),
    {
      name: 'lanzo-cart-storage', // Nombre único en LocalStorage para no mezclar datos
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        order: state.order,
        activeOrderId: state.activeOrderId,
        tableData: state.tableData
      }),
    }
  )
);

if (typeof window !== 'undefined') {
  window.hackStore = useOrderStore;
}