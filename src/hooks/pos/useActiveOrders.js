import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useOrderStore } from '../../store/useOrderStore';
import { generateID } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { Money } from '../../utils/moneyMath';
import { releaseCommittedStock } from '../../services/sales/inventoryFlow';

const noopStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { }
};

const normalizeTableData = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

// Utilidad local para calcular el total exacto de una orden
const getSellableItems = (order = []) => (
  (order || []).filter((item) => Number(item?.quantity) > 0)
);

const calculateOrderTotalExact = (order = []) => {
  const exactTotal = getSellableItems(order).reduce((sum, item) => {
    const lineTotal = Money.multiply(item.price || 0, item.quantity);
    return Money.add(sum, lineTotal);
  }, Money.init(0));

  return Money.toNumber(exactTotal);
};

/**
 * Hook para gestionar múltiples órdenes simultáneas en el POS.
 * Mantiene sincronización con useOrderStore para la orden activa actual.
 */
export const useActiveOrders = create(
  persist((set, get) => ({
    activeOrders: new Map(),
    currentOrderId: null,
    isLoading: false,

    /**
     * @returns {Object|null} La orden activa siendo editada
     */
    get currentOrder() {
      const { activeOrders, currentOrderId } = get();
      return currentOrderId ? activeOrders.get(currentOrderId) || null : null;
    },

    /**
     * @returns {number} Cantidad de órdenes en sesión
     */
    get ordersCount() {
      return get().activeOrders.size;
    },

    /**
     * @returns {boolean} True si hay más de una orden
     */
    get hasMultipleOrders() {
      return get().activeOrders.size > 1;
    },

    /**
     * @returns {Array<Object>} Lista de todas las órdenes
     */
    get orderList() {
      return Array.from(get().activeOrders.values());
    },

    /**
     * Crea nueva orden vacía y la activa
     * @param {string} [customerId] - ID del cliente opcional
     * @param {string} [tableData] - Referencia o datos de mesa opcional
     * @returns {string} El ID de la orden creada
     */
    createOrder: (customerId = null, tableData = null) => {
      const state = get();

      // Ya no se bloquea la creación de nuevas órdenes vacías
      // para permitir abrir pestañas a clientes que se atrasan.

      if (state.activeOrders.size >= 10) {
        throw new Error("Límite máximo de 10 órdenes simultáneas alcanzado.");
      }

      const id = generateID('sal');
      const newOrder = {
        id,
        items: [],
        customer: customerId ? { id: customerId } : null,
        tableData: normalizeTableData(tableData),
        createdAt: new Date().toISOString(),
        total: 0
      };

      const nextOrders = new Map(state.activeOrders);
      nextOrders.set(id, newOrder);

      set({ activeOrders: nextOrders });
      get().switchOrder(id);

      return id;
    },

    /**
     * Cambia currentOrderId (no guarda a BD)
     * @param {string} orderId - ID de la orden a activar
     */
    switchOrder: (orderId) => {
      const state = get();
      const order = state.activeOrders.get(orderId);
      if (!order) return;

      set({ currentOrderId: orderId });

      // 🔥 VALIDACIÓN CRÍTICA: Evaluar estado de supervivencia del carrito principal
      const cartState = useOrderStore.getState();
      const isSameOrder = cartState.activeOrderId === orderId;
      const cartHasItems = Array.isArray(cartState.order) && cartState.order.length > 0;
      const tabIsEmpty = !Array.isArray(order.items) || order.items.length === 0;

      // Si es la misma orden y el carrito salvó los datos pero la pestaña no, 
      // invertimos el flujo: la pestaña se reconstruye a partir del carrito.
      if (isSameOrder && cartHasItems && tabIsEmpty) {
        const nextOrders = new Map(get().activeOrders);
        nextOrders.set(orderId, {
          ...order,
          items: cartState.order,
          tableData: cartState.tableData,
          total: typeof cartState.getTotalPrice === 'function' ? cartState.getTotalPrice() : 0
        });
        set({ activeOrders: nextOrders });
        return; // Detenemos la ejecución aquí para NO vaciar el store.
      }

      // Flujo normal: Forzar la actualización inmediata del carrito principal
      useOrderStore.setState({
        order: order.items || [],
        tableData: order.tableData || null,
        activeOrderId: orderId
      });
    },

    /**
     * Agrega item a una orden específica
     * @param {string} orderId - ID de la orden
     * @param {Object} product - Producto a agregar
     */
    addItemToOrder: async (orderId, product) => {
      const state = get();
      if (!state.activeOrders.has(orderId)) return;

      if (state.currentOrderId === orderId) {
        useOrderStore.getState().addSmartItem(product);
      } else {
        const order = state.activeOrders.get(orderId);
        const nextOrders = new Map(state.activeOrders);
        const newItems = [...order.items, { ...product, quantity: 1, price: product.price }];

        nextOrders.set(orderId, {
          ...order,
          items: newItems,
          total: calculateOrderTotalExact(newItems)
        });
        set({ activeOrders: nextOrders });
      }
    },

    /**
     * Quita item de una orden específica
     * @param {string} orderId - ID de la orden
     * @param {string} productId - ID del producto
     */
    removeItemFromOrder: (orderId, productId) => {
      const state = get();
      if (!state.activeOrders.has(orderId)) return;

      if (state.currentOrderId === orderId) {
        useOrderStore.getState().removeItem(productId);
      } else {
        const order = state.activeOrders.get(orderId);
        const nextOrders = new Map(state.activeOrders);
        const newItems = order.items.filter(i => i.id !== productId);

        nextOrders.set(orderId, {
          ...order,
          items: newItems,
          total: calculateOrderTotalExact(newItems)
        });
        set({ activeOrders: nextOrders });
      }
    },

    /**
     * Actualiza la orden activa con propiedades como customer
     * @param {Object} updates - Propiedades a actualizar
     */
    updateCurrentOrder: (updates) => {
      const state = get();
      if (!state.currentOrderId) return;

      const normalizedUpdates = updates.tableData !== undefined
        ? { ...updates, tableData: normalizeTableData(updates.tableData) }
        : updates;

      const order = state.activeOrders.get(state.currentOrderId);
      const nextOrders = new Map(state.activeOrders);

      nextOrders.set(state.currentOrderId, {
        ...order,
        ...normalizedUpdates
      });

      set({ activeOrders: nextOrders });

      if (updates.tableData !== undefined) {
        useOrderStore.getState().setTableData(normalizedUpdates.tableData);
      }
    },

    /**
     * Cancela la orden actual completamente (vacía carrito, libera stock, borra pestaña y DB)
     */
    cancelCurrentOrder: async () => {
      set({ isLoading: true });
      try {
        const state = get();
        const orderId = state.currentOrderId;
        if (!orderId) return;

        // 1. Eliminar de la sesión activa INMEDIATAMENTE para la UI
        const nextOrders = new Map(state.activeOrders);
        nextOrders.delete(orderId);
        set({ activeOrders: nextOrders });

        // 2. Limpiar store principal y cambiar de orden
        useOrderStore.getState().clearSession();
        if (nextOrders.size > 0) {
          get().switchOrder(Array.from(nextOrders.keys())[0]);
        } else {
          set({ currentOrderId: null });
          get().createOrder();
        }

        // 3. Limpieza profunda en DB (background)
        // 2. Actualizar DB de forma segura
        try {
          const existing = await db.table(STORES.SALES).get(orderId);

          // CORRECCIÓN: Si la orden existe en DB, la cancelamos SIEMPRE, sin importar 
          // si su status exacto era SALE_STATUS.OPEN, para evitar que resurja al recargar.
          if (existing) {
            const itemsToRelease = getSellableItems(existing.items);
            if (itemsToRelease.length > 0) {
              try {
                // Validamos que la función importada exista antes de llamarla
                if (typeof releaseCommittedStock === 'function') {
                  await releaseCommittedStock(itemsToRelease, { db, STORES });
                }
              } catch (stockErr) {
                console.error("Error liberando stock en cancelOrder:", stockErr);
              }
            }

            await db.table(STORES.SALES).update(orderId, {
              status: SALE_STATUS.CANCELLED || 'cancelled',
              fulfillmentStatus: 'cancelled',
              notes: 'Sistema: Orden cancelada por el usuario desde pestañas de POS.',
              updatedAt: new Date().toISOString()
            });
          }
        } catch (dbErr) {
          console.error("Error actualizando DB en cancelOrder:", dbErr);
        }

      } catch (error) {
        console.error("Error al cancelar la orden:", error);
      } finally {
        set({ isLoading: false });
      }
    },

    /**
     * Cancela una orden especifica, sea activa o inactiva.
     * A diferencia de pauseOrder, persiste el cierre como cancelled para que no
     * vuelva a aparecer al recargar la pagina.
     */
    cancelOrder: async (orderId) => {
      set({ isLoading: true });
      try {
        const state = get();
        if (!orderId) throw new Error("Se requiere el ID de la orden.");

        const order = state.activeOrders.get(orderId);
        if (!order) throw new Error("La orden no existe en sesion.");

        // 1. Actualizar UI inmediatamente
        const nextOrders = new Map(state.activeOrders);
        nextOrders.delete(orderId);
        set({ activeOrders: nextOrders });

        if (state.currentOrderId === orderId) {
          useOrderStore.getState().clearSession();
          if (nextOrders.size > 0) {
            get().switchOrder(Array.from(nextOrders.keys())[0]);
          } else {
            set({ currentOrderId: null });
            get().createOrder();
          }
        }

        // 2. Actualizar DB de forma segura
        try {
          const existing = await db.table(STORES.SALES).get(orderId);
          if (existing && existing.status === SALE_STATUS.OPEN) {
            const itemsToRelease = getSellableItems(existing.items);
            if (itemsToRelease.length > 0) {
              try {
                await releaseCommittedStock(itemsToRelease, { db, STORES });
              } catch (stockErr) {
                console.error("Error liberando stock en cancelOrder:", stockErr);
              }
            }

            await db.table(STORES.SALES).update(orderId, {
              status: SALE_STATUS.CANCELLED || 'cancelled',
              fulfillmentStatus: 'cancelled',
              notes: 'Sistema: Orden cancelada por el usuario desde pestanas de POS.',
              updatedAt: new Date().toISOString()
            });
          }
        } catch (dbErr) {
          console.error("Error actualizando DB en cancelOrder:", dbErr);
        }

        return { success: true };
      } catch (error) {
        console.error("Error al cancelar la orden:", error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    /**
     * Anula en BD una venta abierta por id aunque no esté en pestañas (p. ej. enviada a cocina
     * y rechazada allí). Libera stock comprometido y marca la venta como cancelada.
     */
    cancelOpenSaleByIdFromPos: async (orderId) => {
      set({ isLoading: true });
      try {
        if (!orderId) {
          return { success: false, message: 'Se requiere el ID de la orden.' };
        }

        const existing = await db.table(STORES.SALES).get(orderId);
        if (!existing) {
          return { success: false, message: 'La orden no existe.' };
        }
        if (existing.status !== SALE_STATUS.OPEN) {
          return { success: false, message: 'Solo se pueden anular ventas abiertas.' };
        }

        const itemsToRelease = getSellableItems(existing.items);
        if (itemsToRelease.length > 0) {
          try {
            await releaseCommittedStock(itemsToRelease, { db, STORES });
          } catch (stockErr) {
            console.error('Error liberando stock en cancelOpenSaleByIdFromPos:', stockErr);
          }
        }

        const noteLine = 'Sistema: Venta anulada desde modal de mesas (POS).';
        const mergedNotes = existing.notes && String(existing.notes).trim()
          ? `${existing.notes}\n${noteLine}`
          : noteLine;

        await db.table(STORES.SALES).update(orderId, {
          status: SALE_STATUS.CANCELLED,
          fulfillmentStatus: 'cancelled',
          notes: mergedNotes,
          updatedAt: new Date().toISOString()
        });

        const state = get();
        const nextOrders = new Map(state.activeOrders);
        if (nextOrders.has(orderId)) {
          nextOrders.delete(orderId);
          set({ activeOrders: nextOrders });
        }

        if (state.currentOrderId === orderId) {
          useOrderStore.getState().clearSession();
          if (nextOrders.size > 0) {
            get().switchOrder(Array.from(nextOrders.keys())[0]);
          } else {
            set({ currentOrderId: null });
            get().createOrder();
          }
        } else if (useOrderStore.getState().activeOrderId === orderId) {
          useOrderStore.getState().clearSession();
        }

        return { success: true };
      } catch (error) {
        console.error('cancelOpenSaleByIdFromPos:', error);
        return { success: false, message: error?.message || 'No se pudo anular la venta.' };
      } finally {
        set({ isLoading: false });
      }
    },

    /**
     * Guarda orden en BD como "open" y la saca de sesión
     */
    pauseOrder: async (orderId) => {
      set({ isLoading: true });
      try {
        const state = get();
        const order = state.activeOrders.get(orderId);

        if (!order) throw new Error("La orden no existe en sesión.");

        const sellable = getSellableItems(order.items);

        // --- 1. ACTUALIZACIÓN UI INMEDIATA ---
        // Removemos la orden de la sesión para que el usuario tenga feedback instantáneo
        const nextOrders = new Map(state.activeOrders);
        nextOrders.delete(orderId);
        set({ activeOrders: nextOrders });

        // Si era la activa, cambiamos a otra
        if (state.currentOrderId === orderId) {
          useOrderStore.getState().clearSession();
          if (nextOrders.size > 0) {
            const firstAvailable = Array.from(nextOrders.keys())[0];
            get().switchOrder(firstAvailable);
          } else {
            set({ currentOrderId: null });
            get().createOrder();
          }
        }

        // --- 2. OPERACIONES DB (Background) ---
        if (sellable.length === 0) {
          // Si la orden está vacía pero antes estaba guardada en BD, debemos cancelarla
          try {
            const existing = await db.table(STORES.SALES).get(orderId);
            if (existing && existing.status === SALE_STATUS.OPEN) {
              const itemsToRelease = getSellableItems(existing.items);
              if (itemsToRelease.length > 0) {
                try {
                  await releaseCommittedStock(itemsToRelease, { db, STORES });
                } catch (stockErr) {
                  console.error("Error al liberar stock en pauseOrder:", stockErr);
                }
              }
              await db.table(STORES.SALES).update(orderId, {
                status: SALE_STATUS.CANCELLED || 'cancelled',
                fulfillmentStatus: 'cancelled',
                notes: 'Sistema: Orden vaciada y cerrada por el usuario.',
                updatedAt: new Date().toISOString()
              });
            }
          } catch (err) {
            console.error("Error al limpiar orden en DB:", err);
          }
          return;
        }

        // Si es la activa, usamos la función oficial que maneja inventario
        try {
          if (orderId === state.currentOrderId) {
            const result = await useOrderStore.getState().saveOrderAsOpen();
            if (!result.success) console.error("Error en saveOrderAsOpen:", result.message);
          } else {
            const openSaleRecord = {
              id: order.id,
              timestamp: order.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              items: order.items,
              total: order.total,
              status: SALE_STATUS.OPEN || 'open',
              tableData: order.tableData
            };
            await db.table(STORES.SALES).put(openSaleRecord);
          }
        } catch (saveErr) {
          console.error("Error guardando orden en DB al pausar:", saveErr);
        }

      } catch (error) {
        console.error("Error al pausar la orden:", error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    /**
     * Cierra orden en BD como "closed"
     * @param {string} orderId - ID de la orden
     * @param {Object} paymentData - Datos de pago
     */
    closeOrder: async (orderId, paymentData) => {
      set({ isLoading: true });
      try {
        const state = get();
        const order = state.activeOrders.get(orderId);

        if (!order) throw new Error("La orden no existe en sesión.");

        const closedRecord = {
          id: order.id,
          timestamp: order.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items: order.items,
          total: order.total,
          status: SALE_STATUS.CLOSED || 'closed',
          tableData: order.tableData,
          paymentData
        };

        await db.table(STORES.SALES).put(closedRecord);

        const nextOrders = new Map(get().activeOrders);
        nextOrders.delete(orderId);
        set({ activeOrders: nextOrders });

        if (state.currentOrderId === orderId) {
          useOrderStore.getState().clearSession();
          if (nextOrders.size > 0) {
            get().switchOrder(Array.from(nextOrders.keys())[0]);
          } else {
            set({ currentOrderId: null });
          }
        }

      } catch (error) {
        console.error("Error al cerrar la orden:", error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    /**
     * Carga órdenes abiertas desde BD y las inicializa en sesión
     * Se ejecuta al montar PosPageContent
     * 🔧 FIX: Solo carga órdenes que NO han sido enviadas a cocina (fulfillmentStatus !== 'pending')
     */
    loadOrdersFromDB: async () => {
      try {
        const state = get();
        const allOpenSales = await db.table(STORES.SALES)
          .where('status')
          .equals(SALE_STATUS.OPEN)
          .toArray();

        // 🔧 FIX: Filtrar para solo cargar órdenes en edición (no enviadas a cocina)
        // Las órdenes con fulfillmentStatus='pending' ya están en cocina y se manejan desde OrderPage
        const openSales = allOpenSales.filter(sale =>
          !sale.fulfillmentStatus || sale.fulfillmentStatus === 'open'
        );

        if (openSales.length === 0) {
          if (state.activeOrders.size > 0) {
            const persistedCurrentOrderId = state.currentOrderId && state.activeOrders.has(state.currentOrderId)
              ? state.currentOrderId
              : Array.from(state.activeOrders.keys())[0];

            if (persistedCurrentOrderId) {
              get().switchOrder(persistedCurrentOrderId);
              return;
            }
          }

          // Si no hay órdenes abiertas, crear una nueva
          get().createOrder();
          return;
        }

        // Mapear órdenes de BD a estructura interna
        const ordersMap = new Map();
        openSales.forEach(sale => {
          ordersMap.set(sale.id, {
            id: sale.id,
            items: Array.isArray(sale.items) ? sale.items : [],
            customer: sale.customerId ? { id: sale.customerId } : null,
            tableData: normalizeTableData(sale.tableData),
            createdAt: sale.timestamp || new Date().toISOString(),
            total: sale.total || 0,
            isSaved: true
          });
        });

        state.activeOrders.forEach((draftOrder, orderId) => {
          // Ignoramos borradores vacíos si ya estamos cargando órdenes reales de la BD
          const isEmptyDraft = (!draftOrder.items || draftOrder.items.length === 0) && !draftOrder.tableData && !draftOrder.customer;

          // 1. Descartar basura: Ignoramos el borrador temporal SOLO si está completamente vacío,
          // ya hay otras ventas abiertas, y esta orden en particular no existe en la base de datos.
          if (isEmptyDraft && openSales.length > 0 && !ordersMap.has(orderId)) {
            return;
          }

          // 2. Prioridad de hidratación: Extraemos la versión de la base de datos si existe.
          const currentRecord = ordersMap.get(orderId) || {};

          // 3. Fusión de estados: Sobrescribimos el registro de BD (currentRecord) 
          // con el estado en memoria (draftOrder). Esto garantiza que los items agregados 
          // justo antes de recargar no se pierdan.
          ordersMap.set(orderId, {
            ...currentRecord,
            ...draftOrder,
            isSaved: currentRecord.isSaved || draftOrder.isSaved || false,
            tableData: normalizeTableData(draftOrder.tableData ?? currentRecord.tableData ?? null)
          });
        });

        set({ activeOrders: ordersMap });

        const nextCurrentOrderId = state.currentOrderId && ordersMap.has(state.currentOrderId)
          ? state.currentOrderId
          : Array.from(ordersMap.keys())[0];

        if (nextCurrentOrderId) {
          get().switchOrder(nextCurrentOrderId);
        }
      } catch (error) {
        console.error('Error cargando órdenes abiertas de BD:', error);
        // Fallback: crear orden nueva si falla
        const state = get();
        if (state.activeOrders.size > 0) {
          const fallbackOrderId = state.currentOrderId && state.activeOrders.has(state.currentOrderId)
            ? state.currentOrderId
            : Array.from(state.activeOrders.keys())[0];

          if (fallbackOrderId) {
            get().switchOrder(fallbackOrderId);
            return;
          }
        }

        get().createOrder();
      }
    },

    /**
     * Obtiene la orden actual lista para edición
     * Sincroniza automáticamente con useOrderStore
     */
    getCurrentOrderForEditing: () => {
      const state = get();
      const current = state.currentOrder;

      if (!current) return null;

      return {
        id: current.id,
        items: current.items,
        customer: current.customer,
        tableData: current.tableData,
        total: current.total
      };
    }
  }), {
    name: 'lanzo-active-orders-storage',
    storage: createJSONStorage(() => (
      typeof window !== 'undefined' ? window.localStorage : noopStorage
    )),
    partialize: (state) => ({
      activeOrders: Array.from(state.activeOrders.entries()),
      currentOrderId: state.currentOrderId
    }),
    merge: (persistedState, currentState) => {
      const persistedOrders = Array.isArray(persistedState?.activeOrders)
        ? new Map(persistedState.activeOrders)
        : currentState.activeOrders;
      const currentOrderId = persistedState?.currentOrderId ?? currentState.currentOrderId;

      return {
        ...currentState,
        ...persistedState,
        activeOrders: persistedOrders,
        currentOrderId
      };
    }
  })
);

// La suscripción a cambios de useOrderStore ha sido movida
// dentro de useOrderStore.linkWithActiveOrders para gestionar la bidireccionalidad centralmente.
