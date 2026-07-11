import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useAppStore } from '../../store/useAppStore';
import { createOrderActions } from '../../store/orderActions';
import { generateID } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { Money } from '../../utils/moneyMath';
import { releaseCommittedStock } from '../../services/sales/inventoryFlow';
import { normalizeCartItems } from '../../utils/cartLineIdentity';
import { releaseEcommerceOrderPosDraft } from '../../services/ecommerce/ecommerceOrderService';
import {
  getOrderDeviceId,
  getNextPersistedOrderVersion,
  normalizeOrderRevision,
  selectNewestOrder,
  touchOrderVersion
} from '../../services/orders/orderVersioning';

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

const EMPTY_ORDER_ITEMS = Object.freeze([]);

export const selectCurrentOrder = (state) => (
  state.currentOrderId ? state.activeOrders.get(state.currentOrderId) || null : null
);

export const selectCurrentOrderItems = (state) => (
  selectCurrentOrder(state)?.items || EMPTY_ORDER_ITEMS
);

export const selectCurrentOrderCustomer = (state) => (
  selectCurrentOrder(state)?.customer || null
);

export const selectCurrentOrderTableData = (state) => (
  selectCurrentOrder(state)?.tableData || null
);

/**
 * Hook para gestionar múltiples órdenes simultáneas en el POS.
 */
export const useActiveOrders = create(
  persist((set, get) => ({
    activeOrders: new Map(),
    currentOrderId: null,
    isLoading: false,
    pendingInventoryResolutions: new Map(),
    ...createOrderActions(set, get),
    /** Flag local: true mientras la orden activa está en proceso de cobro */
    isCurrentOrderLocked: false,

    /**
     * @returns {Object|null} La orden activa siendo editada
     */

    /**
     * @returns {number} Cantidad de órdenes en sesión
     */

    /**
     * @returns {boolean} True si hay más de una orden
     */

    /**
     * @returns {Array<Object>} Lista de todas las órdenes
     */

    /**
     * Crea nueva orden vacía y la activa
     * @param {string} [customerId] - ID del cliente opcional
     * @param {string} [tableData] - Referencia o datos de mesa opcional
     * @returns {string} El ID de la orden creada
     */
    createOrder: (customerId = null, tableData = null) => {
      const state = get();
      const now = new Date().toISOString();

      // Ya no se bloquea la creación de nuevas órdenes vacías
      // para permitir abrir pestañas a clientes que se atrasan.

      const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
      if (!enableMultipleOrders && state.activeOrders.size >= 1) {
        return null; // Block creation if multiple orders are disabled and there's already one
      }

      if (state.activeOrders.size >= 10) {
        throw new Error("Límite máximo de 10 órdenes simultáneas alcanzado.");
      }

      const id = generateID('sal');
      const newOrder = {
        id,
        items: [],
        customer: customerId ? { id: customerId } : null,
        tableData: normalizeTableData(tableData),
        createdAt: now,
        updatedAt: now,
        revision: 0,
        deviceId: getOrderDeviceId(),
        total: 0,
        folio: null
      };

      const nextOrders = new Map(state.activeOrders);
      nextOrders.set(id, newOrder);

      set({ activeOrders: nextOrders });
      get().switchOrder(id);

      return id;
    },

    upsertEcommerceDraft: (draft) => {
      const state = get();
      const draftId = typeof draft?.id === 'string' ? draft.id.trim() : '';
      const licenseIdentity = typeof draft?.ecommerceLicenseIdentity === 'string'
        ? draft.ecommerceLicenseIdentity.trim()
        : '';

      if (!draftId.startsWith('ecom-') || !licenseIdentity || !Array.isArray(draft?.items)) {
        return { success: false, code: 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED' };
      }

      const existing = state.activeOrders.get(draftId);
      if (existing) {
        if (existing.origin !== 'ecommerce' || existing.ecommerceLicenseIdentity !== licenseIdentity) {
          return { success: false, code: 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED' };
        }
        set({ currentOrderId: draftId, isCurrentOrderLocked: false });
        return { success: true, created: false, order: existing };
      }

      if (state.activeOrders.size >= 10) {
        return { success: false, code: 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED', message: 'Cierra una orden activa antes de preparar este pedido.' };
      }

      const nowIso = new Date().toISOString();
      const items = normalizeCartItems(draft.items);
      const nextOrder = {
        id: draftId,
        items,
        customer: null,
        tableData: null,
        createdAt: draft.createdAt || nowIso,
        updatedAt: nowIso,
        revision: 0,
        deviceId: getOrderDeviceId(),
        total: calculateOrderTotalExact(items),
        folio: null,
        isSaved: false,
        origin: 'ecommerce',
        ecommerceOrderId: draft.ecommerceOrderId,
        ecommerceOrderCode: draft.ecommerceOrderCode,
        ecommerceLicenseIdentity: licenseIdentity,
        ecommerceDraftStatus: draft.ecommerceDraftStatus || 'claimed',
        ecommerceClaimToken: draft.ecommerceClaimToken || null,
        fulfillmentMethod: draft.fulfillmentMethod || 'pickup',
        expectedSubtotal: Number(draft.expectedSubtotal) || 0,
        expectedDeliveryFee: Number(draft.expectedDeliveryFee) || 0,
        expectedDiscountTotal: Number(draft.expectedDiscountTotal) || 0,
        expectedTaxTotal: Number(draft.expectedTaxTotal) || 0,
        expectedTotal: Number(draft.expectedTotal) || 0,
        currency: draft.currency || 'MXN'
      };

      const nextOrders = new Map(state.activeOrders);
      nextOrders.set(draftId, nextOrder);
      set({ activeOrders: nextOrders, currentOrderId: draftId, isCurrentOrderLocked: false });
      return { success: true, created: true, order: nextOrder };
    },

    updateEcommerceDraftStatus: (orderId, ecommerceDraftStatus) => {
      const order = get().activeOrders.get(orderId);
      if (!order || order.origin !== 'ecommerce') return false;
      get().updateOrder(orderId, { ecommerceDraftStatus });
      return true;
    },

    removeEcommerceDraftLocal: (orderId) => {
      const state = get();
      const order = state.activeOrders.get(orderId);
      if (!order || order.origin !== 'ecommerce') return { success: false };

      const nextOrders = new Map(state.activeOrders);
      nextOrders.delete(orderId);
      let nextCurrentOrderId = state.currentOrderId;
      if (nextCurrentOrderId === orderId) {
        nextCurrentOrderId = nextOrders.keys().next().value || null;
      }
      set({ activeOrders: nextOrders, currentOrderId: nextCurrentOrderId, isCurrentOrderLocked: false });
      if (!nextCurrentOrderId) get().createOrder();
      return { success: true };
    },

    releaseEcommerceDraft: async (orderId, reason = 'abandoned') => {
      const order = get().activeOrders.get(orderId);
      if (!order || order.origin !== 'ecommerce') {
        return { success: false, code: 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED' };
      }

      const result = await releaseEcommerceOrderPosDraft({
        licenseDetails: useAppStore.getState().licenseDetails,
        orderId: order.ecommerceOrderId,
        claimToken: order.ecommerceClaimToken,
        reason
      });

      if (result.success === false) return result;
      get().removeEcommerceDraftLocal(orderId);
      return result;
    },

    pruneEcommerceDraftsForContext: ({ licenseIdentity, canPrepare }) => {
      const state = get();
      const nextOrders = new Map(state.activeOrders);
      let changed = false;

      state.activeOrders.forEach((order, orderId) => {
        if (order?.origin !== 'ecommerce') return;
        if (!canPrepare || !licenseIdentity || order.ecommerceLicenseIdentity !== licenseIdentity) {
          nextOrders.delete(orderId);
          changed = true;
        }
      });

      if (!changed) return false;
      const nextCurrentOrderId = nextOrders.has(state.currentOrderId)
        ? state.currentOrderId
        : (nextOrders.keys().next().value || null);
      set({ activeOrders: nextOrders, currentOrderId: nextCurrentOrderId, isCurrentOrderLocked: false });
      if (!nextCurrentOrderId) get().createOrder();
      return true;
    },

    /**
     * Cambia currentOrderId (no guarda a BD)
     * @param {string} orderId - ID de la orden a activar
     */
    switchOrder: (orderId) => {
      const state = get();
      const order = state.activeOrders.get(orderId);
      if (!order) return;

      set({
        currentOrderId: orderId,
        isCurrentOrderLocked: Boolean(order.isLockedForCheckout)
      });
    },

    loadOpenOrder: async (orderId) => {
      try {
        const sale = await db.table(STORES.SALES).get(orderId);
        if (!sale || sale.status !== SALE_STATUS.OPEN) {
          return { success: false, message: 'La orden abierta ya no existe.' };
        }

        const order = {
          id: sale.id,
          items: normalizeCartItems(sale.items),
          customer: sale.customerId ? { id: sale.customerId } : null,
          tableData: normalizeTableData(sale.tableData),
          createdAt: sale.timestamp || new Date().toISOString(),
          total: sale.total || calculateOrderTotalExact(sale.items),
          isSaved: true,
          folio: sale.folio || null,
          fulfillmentStatus: sale.fulfillmentStatus || 'open',
          revision: normalizeOrderRevision(sale.revision),
          updatedAt: sale.updatedAt || sale.timestamp || new Date().toISOString(),
          deviceId: sale.deviceId || null
        };

        const nextOrders = new Map(get().activeOrders);
        nextOrders.set(orderId, order);
        set({
          activeOrders: nextOrders,
          currentOrderId: orderId,
          isCurrentOrderLocked: Boolean(sale.isLockedForCheckout)
        });

        return { success: true };
      } catch (error) {
        return { success: false, message: error?.message || 'No se pudo cargar la orden.' };
      }
    },

    /**
     * Agrega item a una orden específica
     * @param {string} orderId - ID de la orden
     * @param {Object} product - Producto a agregar
     */
    // Elimina una orden ya procesada del gestor local sin tocar su estado final en BD.
    removeOrder: async (orderId) => {
      set({ isLoading: true });
      try {
        const state = get();
        if (!orderId) throw new Error("Se requiere el ID de la orden.");

        if (!state.activeOrders.has(orderId)) {
          return { success: true };
        }

        const nextOrders = new Map(state.activeOrders);
        nextOrders.delete(orderId);

        set({
          activeOrders: nextOrders,
          isCurrentOrderLocked:
            state.currentOrderId === orderId ? false : state.isCurrentOrderLocked
        });

        if (state.currentOrderId === orderId) {

          if (nextOrders.size > 0) {
            get().switchOrder(Array.from(nextOrders.keys())[0]);
          } else {
            set({ currentOrderId: null });
            get().createOrder();
          }
        }

        return { success: true };
      } catch (error) {
        console.error("Error al eliminar la orden de la sesion:", error);
        throw error;
      } finally {
        set({ isLoading: false });
      }
    },

    // Agrega item a una orden especifica.
    addItemToOrder: async (orderId, product) => {
      const state = get();
      if (!state.activeOrders.has(orderId)) return;
      await get().addSmartItem(product, orderId);
    },

    /**
     * Quita item de una orden específica
     * @param {string} orderId - ID de la orden
     * @param {string} lineId - ID de la línea del ticket
     */
    removeItemFromOrder: (orderId, lineId) => {
      const state = get();
      if (!state.activeOrders.has(orderId)) return;

      get().removeItem(lineId, orderId);
    },

    updateOrder: (orderId, updates) => {
      set((state) => {
        if (!orderId || !state.activeOrders.has(orderId)) return state;

        const order = state.activeOrders.get(orderId);
        const resolvedUpdates = typeof updates === 'function' ? updates(order) : updates;
        if (!resolvedUpdates) return state;

        const normalizedUpdates = resolvedUpdates.tableData !== undefined
          ? { ...resolvedUpdates, tableData: normalizeTableData(resolvedUpdates.tableData) }
          : resolvedUpdates;

        const nextOrders = new Map(state.activeOrders);
        nextOrders.set(orderId, {
          ...order,
          ...normalizedUpdates,
          ...touchOrderVersion(order)
        });

        return { activeOrders: nextOrders };
      });
    },

    updateCurrentOrder: (updates) => get().updateOrder(get().currentOrderId, updates),

    /**
     * Actualiza los items de la orden activa y recalcula el total
     * @param {Array|Function} updater - Nueva lista de productos o función
     */
    updateOrderItems: (orderId, updater) => {
      set((state) => {
        if (!orderId || !state.activeOrders.has(orderId)) return state;

        const order = state.activeOrders.get(orderId);

        if (order.isLockedForCheckout) {
          console.warn('[useActiveOrders] Intento de mutación rechazado: Orden en proceso de pago.');
          return state;
        }

        const updatedItems = typeof updater === 'function' ? updater(order.items) : updater;
        const newItems = normalizeCartItems(updatedItems);
        const nextOrders = new Map(state.activeOrders);
        
        nextOrders.set(orderId, {
          ...order,
          items: newItems,
          total: calculateOrderTotalExact(newItems),
          ...touchOrderVersion(order)
        });

        return { activeOrders: nextOrders };
      });
    },

    updateCurrentOrderItems: (updater) => get().updateOrderItems(get().currentOrderId, updater),

    /**
     * Cancela la orden actual completamente (vacía carrito, libera stock, borra pestaña y DB)
     */
    cancelCurrentOrder: async () => {
      const state = get();
      const orderId = state.currentOrderId;
      if (!orderId) return;

      const order = state.activeOrders.get(orderId);
      if (order?.isLockedForCheckout) {
        throw new Error("No se puede cancelar una orden en proceso de pago.");
      }

      set({ isLoading: true });
      try {
        const isSaved = order?.isSaved;
        let existsInDB = false;
        let existing = null;

        if (isSaved) {
          try {
            existing = await db.table(STORES.SALES).get(orderId);
            existsInDB = !!existing;
          } catch (e) {
            console.error("Error al verificar orden en BD:", e);
          }
        }

        if (existsInDB && existing) {
          try {
            const itemsToRelease = getSellableItems(existing.items);
            if (itemsToRelease.length > 0) {
              if (typeof releaseCommittedStock === 'function') {
                await releaseCommittedStock(itemsToRelease, { db, STORES });
              }
            }
          } catch (stockErr) {
            console.error("Error liberando stock en cancelCurrentOrder:", stockErr);
          }

          try {
            const noteLine = "Sistema: Orden cancelada desde POS";
            const mergedNotes = existing.notes && String(existing.notes).trim()
              ? `${existing.notes}\n${noteLine}`
              : noteLine;

            await db.table(STORES.SALES).update(orderId, {
              status: SALE_STATUS.CANCELLED || 'cancelled',
              fulfillmentStatus: 'cancelled',
              notes: mergedNotes,
              updatedAt: new Date().toISOString()
            });
          } catch (dbErr) {
            console.error("Error actualizando DB en cancelCurrentOrder:", dbErr);
          }
        }

        // 1. Eliminar de la sesión activa y UI
        try {
          const nextOrders = new Map(get().activeOrders);
          nextOrders.delete(orderId);

          const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
          if (!enableMultipleOrders) {
            nextOrders.clear();
            set({ activeOrders: nextOrders, currentOrderId: null });

            get().createOrder();
          } else {
            set({ activeOrders: nextOrders });

            if (nextOrders.size > 0) {
              get().switchOrder(Array.from(nextOrders.keys())[0]);
            } else {
              set({ currentOrderId: null });
              get().createOrder();
            }
          }
        } catch (uiErr) {
          console.error("Error actualizando UI en cancelCurrentOrder:", uiErr);
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
      if (!orderId) throw new Error("Se requiere el ID de la orden.");
      const state = get();
      const order = state.activeOrders.get(orderId);
      if (!order) throw new Error("La orden no existe en sesion.");

      if (order.isLockedForCheckout) {
        throw new Error("No se puede cancelar una orden en proceso de pago.");
      }

      set({ isLoading: true });
      try {
        const isSaved = order.isSaved;
        let existsInDB = false;
        let existing = null;

        if (isSaved) {
          try {
            existing = await db.table(STORES.SALES).get(orderId);
            existsInDB = !!existing;
          } catch (e) {
            console.error("Error al verificar orden en BD:", e);
          }
        }

        if (existsInDB && existing) {
          try {
            const itemsToRelease = getSellableItems(existing.items);
            if (itemsToRelease.length > 0) {
              if (typeof releaseCommittedStock === 'function') {
                await releaseCommittedStock(itemsToRelease, { db, STORES });
              }
            }
          } catch (stockErr) {
            console.error("Error liberando stock en cancelOrder:", stockErr);
          }

          try {
            const noteLine = "Sistema: Orden cancelada desde POS";
            const mergedNotes = existing.notes && String(existing.notes).trim()
              ? `${existing.notes}\n${noteLine}`
              : noteLine;

            await db.table(STORES.SALES).update(orderId, {
              status: SALE_STATUS.CANCELLED || 'cancelled',
              fulfillmentStatus: 'cancelled',
              notes: mergedNotes,
              updatedAt: new Date().toISOString()
            });
          } catch (dbErr) {
            console.error("Error actualizando DB en cancelOrder:", dbErr);
          }
        }

        // 1. Actualizar UI inmediatamente
        try {
          const nextOrders = new Map(get().activeOrders);
          nextOrders.delete(orderId);

          const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
          if (!enableMultipleOrders) {
            nextOrders.clear();
            set({ activeOrders: nextOrders, currentOrderId: null });

            get().createOrder();
          } else {
            set({ activeOrders: nextOrders });

            if (state.currentOrderId === orderId) {

              if (nextOrders.size > 0) {
                get().switchOrder(Array.from(nextOrders.keys())[0]);
              } else {
                set({ currentOrderId: null });
                get().createOrder();
              }
            }
          }
        } catch (uiErr) {
          console.error("Error actualizando UI en cancelOrder:", uiErr);
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
        }

        const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
        if (!enableMultipleOrders) {
          nextOrders.clear();
          set({ activeOrders: nextOrders, currentOrderId: null });

          get().createOrder();
        } else {
          set({ activeOrders: nextOrders });

          if (state.currentOrderId === orderId) {

            if (nextOrders.size > 0) {
              get().switchOrder(Array.from(nextOrders.keys())[0]);
            } else {
              set({ currentOrderId: null });
              get().createOrder();
            }
          }
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

        const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
        if (!enableMultipleOrders) {
          nextOrders.clear();
          set({ activeOrders: nextOrders, currentOrderId: null });

          get().createOrder();
        } else {
          set({ activeOrders: nextOrders });

          // Si era la activa, cambiamos a otra
          if (state.currentOrderId === orderId) {

            if (nextOrders.size > 0) {
              const firstAvailable = Array.from(nextOrders.keys())[0];
              get().switchOrder(firstAvailable);
            } else {
              set({ currentOrderId: null });
              get().createOrder();
            }
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
            const result = await get().saveOrderAsOpen(orderId, order);
            if (!result.success) console.error("Error en saveOrderAsOpen:", result.message);
          } else {
            const existingSale = await db.table(STORES.SALES).get(order.id);
            if (existingSale && selectNewestOrder(order, existingSale).source === 'db') {
              console.warn(
                `[pauseOrder] Se preservó la versión más reciente de DB para ${order.id}.`
              );
              return;
            }
            const persistedVersion = getNextPersistedOrderVersion(order, existingSale);
            const openSaleRecord = {
              ...(existingSale || {}),
              id: order.id,
              timestamp: order.createdAt || new Date().toISOString(),
              ...persistedVersion,
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
          ...getNextPersistedOrderVersion(order),
          items: order.items,
          total: order.total,
          status: SALE_STATUS.CLOSED || 'closed',
          tableData: order.tableData,
          paymentData
        };

        await db.table(STORES.SALES).put(closedRecord);

        const nextOrders = new Map(get().activeOrders);
        nextOrders.delete(orderId);

        const enableMultipleOrders = useAppStore.getState().enableMultipleOrders;
        if (!enableMultipleOrders) {
          nextOrders.clear();
          set({ activeOrders: nextOrders, currentOrderId: null });

          get().createOrder();
        } else {
          set({ activeOrders: nextOrders });

          if (state.currentOrderId === orderId) {

            if (nextOrders.size > 0) {
              get().switchOrder(Array.from(nextOrders.keys())[0]);
            } else {
              set({ currentOrderId: null });
              get().createOrder(); // <-- Aseguramos la creación de una orden si el carrito queda vacío
            }
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
     * 🔧 FIX 2: Recupera PRIMERO órdenes del localStorage para evitar pérdidas en recarga rápida
     */
    loadOrdersFromDB: async () => {
      try {
        const state = get();

        // 1️⃣ PASO CRÍTICO: Recuperar órdenes del localStorage que NO fueron guardadas en BD
        // (esto preserva carritos abiertos que no se guardaron explícitamente)
        const persistedOrdersMap = new Map(state.activeOrders);

        // 2️⃣ Luego cargar desde BD para enriquecer/actualizar
        const allOpenSales = await db.table(STORES.SALES)
          .where('status')
          .equals(SALE_STATUS.OPEN)
          .toArray();

        // 🔧 FIX: Filtrar para solo cargar órdenes en edición (no enviadas a cocina)
        // Las órdenes con fulfillmentStatus='pending' ya están en cocina y se manejan desde OrderPage
        const openSales = allOpenSales.filter(sale =>
          !sale.fulfillmentStatus || sale.fulfillmentStatus === 'open'
        );

        // 3️⃣ Crear mapa consolidado: localStorage + BD
        const ordersMap = new Map();

        // Primero agregar órdenes guardadas en BD
        openSales.forEach(sale => {
          ordersMap.set(sale.id, {
            id: sale.id,
            items: normalizeCartItems(sale.items),
            customer: sale.customerId ? { id: sale.customerId } : null,
            tableData: normalizeTableData(sale.tableData),
            createdAt: sale.timestamp || new Date().toISOString(),
            total: sale.total || 0,
            isSaved: true,
            folio: sale.folio || null,
            fulfillmentStatus: sale.fulfillmentStatus || 'open',
            revision: normalizeOrderRevision(sale.revision),
            updatedAt: sale.updatedAt || sale.timestamp || null,
            deviceId: sale.deviceId || null
          });
        });

        // Luego PRESERVAR órdenes que estaban en localStorage pero no en BD
        persistedOrdersMap.forEach((draftOrder, orderId) => {
          const existing = ordersMap.get(orderId);

          if (existing) {
            const newest = selectNewestOrder(draftOrder, existing);
            const selectedOrder = newest.order || existing;
            ordersMap.set(orderId, {
              ...selectedOrder,
              items: normalizeCartItems(selectedOrder.items),
              tableData: normalizeTableData(selectedOrder.tableData ?? null),
              total: selectedOrder.total ?? calculateOrderTotalExact(selectedOrder.items),
              isSaved: true,
              folio: selectedOrder.folio ?? existing.folio ?? null,
              fulfillmentStatus: existing.fulfillmentStatus || 'open',
              revision: normalizeOrderRevision(selectedOrder.revision),
              updatedAt: selectedOrder.updatedAt || existing.updatedAt || existing.createdAt,
              deviceId: selectedOrder.deviceId || existing.deviceId || null
            });
          } else {
            // Orden está en localStorage pero NO en BD: preservarla como borrador
            const draftItems = normalizeCartItems(draftOrder.items);
            // 🔥 FIX: Si la orden es la activa y get() tiene los items (pero el tab no por fallo de guardado),
            const cartState = get();
            const isActiveInCart = cartState.currentOrderId === orderId;
            const currentActiveItems = normalizeCartItems(selectCurrentOrder(cartState)?.items || []);
            const cartHasItems = currentActiveItems.length > 0;
            // 🔧 IMPORTANT: NUNCA descartar órdenes del localStorage, incluso si parecen vacías
            ordersMap.set(orderId, {
              ...draftOrder,
              items: isActiveInCart && cartHasItems && draftItems.length === 0 ? currentActiveItems : draftItems,
              tableData: normalizeTableData(draftOrder.tableData ?? null),
              isSaved: false,
              folio: draftOrder.folio ?? null,
              revision: normalizeOrderRevision(draftOrder.revision),
              updatedAt: draftOrder.updatedAt || draftOrder.createdAt || new Date().toISOString(),
              deviceId: draftOrder.deviceId || getOrderDeviceId()
            });
          }
        });

        // 4️⃣ Si no hay órdenes en total, crear una nueva vacía
        if (ordersMap.size === 0) {
          const newOrderId = generateID('sal');
          const now = new Date().toISOString();
          ordersMap.set(newOrderId, {
            id: newOrderId,
            items: [],
            customer: null,
            tableData: null,
            createdAt: now,
            updatedAt: now,
            revision: 0,
            deviceId: getOrderDeviceId(),
            total: 0,
            isSaved: false,
            folio: null
          });
        }

        set({ activeOrders: ordersMap });

        // 5️⃣ Activar orden: preferir la que estaba activa, o la primera disponible
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
     * Bloquea la orden para el proceso de cobro.
     *
     * Implementa un bloqueo atómico en Dexie usando una transacción de lectura-escritura.
     * Si la orden ya está bloqueada por otra sesión/dispositivo, rechaza inmediatamente.
     * Al persistir `isLockedForCheckout` en la BD, el middleware de sync propagará
     * el estado a otras tablets; éstas deben leer este flag y deshabilitar su UI.
     *
     * @param {string} orderId - ID de la orden a bloquear
     * @returns {Promise<{ success: boolean, reason?: string }>}
     */
    lockOrderForCheckout: async (orderId) => {
      if (!orderId) return { success: false, reason: 'ID de orden requerido.' };

      const state = get();
      const order = state.activeOrders.get(orderId);
      if (!order) return { success: false, reason: 'La orden no existe en sesión.' };

      try {
        let lockAcquired = false;

        // Transacción atómica: read-then-write sin ventana de carrera.
        // Si dos tablets ejecutan esto al mismo tiempo, solo una verá
        // `isLockedForCheckout === false` y podrá escribir el lock.
        await db.transaction('rw', db.table(STORES.SALES), async () => {
          const existing = await db.table(STORES.SALES).get(orderId);

          // La orden puede no estar en DB todavía (borrador en memoria)
          if (existing && existing.isLockedForCheckout === true) {
            // Otro dispositivo ya tomó el lock → abortar
            lockAcquired = false;
            return; // Dexie aborta la transacción si lanzamos, usamos flag en su lugar
          }

          const lockedAt = new Date().toISOString();

          if (existing) {
            await db.table(STORES.SALES).update(orderId, {
              isLockedForCheckout: true,
              lockedAt
            });
          } else {
            // La orden aún no fue persistida: la insertamos con el lock ya puesto.
            await db.table(STORES.SALES).put({
              id: orderId,
              items: normalizeCartItems(order.items),
              total: order.total || 0,
              tableData: order.tableData || null,
              status: 'open',
              timestamp: order.createdAt || lockedAt,
              updatedAt: order.updatedAt || lockedAt,
              revision: normalizeOrderRevision(order.revision),
              deviceId: order.deviceId || getOrderDeviceId(),
              isLockedForCheckout: true,
              lockedAt
            });
          }

          lockAcquired = true;
        });

        if (!lockAcquired) {
          console.warn(
            `[lockOrderForCheckout] Orden ${orderId} ya está bloqueada por otro proceso.`
          );
          return { success: false, reason: 'La orden ya está siendo cobrada desde otro dispositivo.' };
        }

        // Actualizar memoria en memoria (inmutabilidad)
        const lockedAt = new Date().toISOString();
        const nextOrders = new Map(state.activeOrders);
        nextOrders.set(orderId, {
          ...order,
          isLockedForCheckout: true,
          lockedAt
        });

        set({
          activeOrders: nextOrders,
          // Si la orden bloqueada es la activa, activamos el flag de UI
          isCurrentOrderLocked: state.currentOrderId === orderId ? true : state.isCurrentOrderLocked
        });

        return { success: true };
      } catch (error) {
        console.error('[lockOrderForCheckout] Error al adquirir el lock:', error);
        return { success: false, reason: error?.message || 'Error interno al bloquear la orden.' };
      }
    },

    /**
     * Libera el bloqueo de cobro de una orden.
     * Se debe llamar tanto en éxito (después de procesar el pago) como en caso de error
     * (si el usuario cancela el modal de pago) para dejar la orden editable de nuevo.
     *
     * @param {string} orderId - ID de la orden a desbloquear
     * @returns {Promise<{ success: boolean }>}
     */
    unlockOrder: async (orderId) => {
      if (!orderId) return { success: false };

      const state = get();

      try {
        // Liberar en BD
        const existing = await db.table(STORES.SALES).get(orderId);
        if (existing) {
          await db.table(STORES.SALES).update(orderId, {
            isLockedForCheckout: false,
            lockedAt: null
          });
        }

        // Liberar en memoria
        const order = state.activeOrders.get(orderId);
        if (order) {
          const nextOrders = new Map(state.activeOrders);
          nextOrders.set(orderId, {
            ...order,
            isLockedForCheckout: false,
            lockedAt: null
          });

          set({
            activeOrders: nextOrders,
            isCurrentOrderLocked:
              state.currentOrderId === orderId ? false : state.isCurrentOrderLocked
          });
        }

        return { success: true };
      } catch (error) {
        console.error('[unlockOrder] Error al liberar el lock:', error);
        return { success: false };
      }
    },

    /**
     * Obtiene la orden actual lista para edición
     */
    getCurrentOrderForEditing: () => {
      const state = get();
      const current = selectCurrentOrder(state);

      if (!current) return null;

      return {
        id: current.id,
        items: normalizeCartItems(current.items),
        customer: current.customer,
        tableData: current.tableData,
        total: current.total
      };
    }
  }), {
    name: 'lanzo-active-orders-storage',
    storage: createJSONStorage(() => ({
      getItem: (name) => {
        if (typeof window === 'undefined') return null;
        try {
          return window.localStorage.getItem(name);
        } catch (e) {
          console.error(`[safeActiveOrdersStorage] Error reading ${name}`, e);
          return null;
        }
      },
      setItem: (name, value) => {
        if (typeof window === 'undefined') return;
        try {
          window.localStorage.setItem(name, value);
        } catch {
          console.warn(`[safeActiveOrdersStorage] Quota exceeded for ${name}. Cleaning up...`);
          try {
            for (let i = window.localStorage.length - 1; i >= 0; i--) {
              const key = window.localStorage.key(i);
              if (key && key.startsWith('lanzo-') && key !== name && key !== 'lanzo-cart-storage' && key !== 'lanzo-inventory-storage') {
                window.localStorage.removeItem(key);
              }
            }
            window.localStorage.setItem(name, value);
          } catch (cleanupError) {
            console.error(`[safeActiveOrdersStorage] Failed to save ${name} after cleanup`, cleanupError);
          }
        }
      },
      removeItem: (name) => {
        if (typeof window === 'undefined') return;
        try {
          window.localStorage.removeItem(name);
        } catch (e) {
          console.error(`[safeActiveOrdersStorage] Error removing ${name}`, e);
        }
      }
    })),
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
        activeOrders: new Map(Array.from(persistedOrders.entries()).map(([orderId, order]) => [
          orderId,
          {
            ...order,
            items: normalizeCartItems(order?.items)
          }
        ])),
        currentOrderId
      };
    }
  })
);

// --- SUSCRIPCIÓN GLOBAL (Flujo Unidireccional: SSOT -> View) ---
