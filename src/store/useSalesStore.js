// src/store/useSalesStore.js
import { create } from 'zustand';
import {
  loadDataPaginated,
  STORES
} from '../services/database';
import Logger from '../services/Logger';
import { cancelSale, moveCancelledSaleToTrash } from '../services/salesService';

export const useSalesStore = create((set, get) => ({
  sales: [],
  wasteLogs: [],
  salesCursorStack: [null],
  currentSalesPageIndex: 0,
  hasMoreSales: true,
  wasteCursorStack: [null],
  currentWastePageIndex: 0,
  hasMoreWaste: true,
  isSalesLoading: false,
  isWasteLoading: false,
  isLoading: false,

  loadRecentSales: async () => {
    set({ isLoading: true });
    try {
      const [recentSales, wastePage] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, timeIndex: 'timestamp' }),
        loadDataPaginated(STORES.WASTE, { limit: 50, timeIndex: 'timestamp' })
      ]);

      const nextSalesCursor = recentSales?.nextCursor || null;
      const nextWasteCursor = wastePage?.nextCursor || null;
      set({
        sales: recentSales?.data || [],
        wasteLogs: wastePage?.data || [],
        salesCursorStack: nextSalesCursor ? [null, nextSalesCursor] : [null],
        currentSalesPageIndex: 0,
        hasMoreSales: !!nextSalesCursor,
        wasteCursorStack: nextWasteCursor ? [null, nextWasteCursor] : [null],
        currentWastePageIndex: 0,
        hasMoreWaste: !!nextWasteCursor,
        isSalesLoading: false,
        isWasteLoading: false,
        isLoading: false
      });
    } catch (error) {
      Logger.error('Error cargando ventas y mermas recientes:', error);
      set({ isLoading: false, isSalesLoading: false, isWasteLoading: false });
    }
  },

  fetchSalesPage: async (direction = 'current') => {
    const state = get();
    if (state.isSalesLoading) return;

    let targetPageIndex = state.currentSalesPageIndex;

    if (direction === 'next') {
      if (!state.hasMoreSales) return;
      targetPageIndex += 1;
    } else if (direction === 'prev') {
      if (state.currentSalesPageIndex === 0) return;
      targetPageIndex = Math.max(0, state.currentSalesPageIndex - 1);
    }

    const targetCursor = state.salesCursorStack[targetPageIndex] ?? null;
    set({ isSalesLoading: true });

    try {
      const { data, nextCursor } = await loadDataPaginated(STORES.SALES, {
        limit: 50,
        cursor: targetCursor,
        timeIndex: 'timestamp'
      });

      const newSalesCursorStack = [...state.salesCursorStack];
      if (nextCursor) {
        newSalesCursorStack[targetPageIndex + 1] = nextCursor;
      } else {
        newSalesCursorStack.length = targetPageIndex + 1;
      }

      set({
        sales: data || [],
        salesCursorStack: newSalesCursorStack,
        currentSalesPageIndex: targetPageIndex,
        hasMoreSales: !!nextCursor,
        isSalesLoading: false
      });
    } catch (error) {
      Logger.error('Error en fetchSalesPage:', error);
      set({ isSalesLoading: false });
    }
  },

  fetchWastePage: async (direction = 'current') => {
    const state = get();
    if (state.isWasteLoading) return;

    let targetPageIndex = state.currentWastePageIndex;

    if (direction === 'next') {
      if (!state.hasMoreWaste) return;
      targetPageIndex += 1;
    } else if (direction === 'prev') {
      if (state.currentWastePageIndex === 0) return;
      targetPageIndex = Math.max(0, state.currentWastePageIndex - 1);
    }

    const targetCursor = state.wasteCursorStack[targetPageIndex] ?? null;
    set({ isWasteLoading: true });

    try {
      const { data, nextCursor } = await loadDataPaginated(STORES.WASTE, {
        limit: 50,
        cursor: targetCursor,
        direction: 'prev',
        timeIndex: 'timestamp'
      });

      const newWasteCursorStack = [...state.wasteCursorStack];
      if (nextCursor) {
        newWasteCursorStack[targetPageIndex + 1] = nextCursor;
      } else {
        newWasteCursorStack.length = targetPageIndex + 1;
      }

      set({
        wasteLogs: data || [],
        wasteCursorStack: newWasteCursorStack,
        currentWastePageIndex: targetPageIndex,
        hasMoreWaste: !!nextCursor,
        isWasteLoading: false
      });
    } catch (error) {
      Logger.error('Error en fetchWastePage:', error);
      set({ isWasteLoading: false });
    }
  },

  registerWasteRecord: async (wasteRecord) => {
    if (!wasteRecord) return;

    const state = get();

    if (state.currentWastePageIndex === 0) {
      const dedupedWasteLogs = [
        wasteRecord,
        ...state.wasteLogs.filter((log) => log.id !== wasteRecord.id)
      ];
      const firstPageWasteLogs = dedupedWasteLogs.slice(0, 50);
      const firstPageNextCursor =
        firstPageWasteLogs.length === 50
          ? firstPageWasteLogs[firstPageWasteLogs.length - 1]?.timestamp || null
          : null;

      set({
        wasteLogs: firstPageWasteLogs,
        wasteCursorStack: firstPageNextCursor ? [null, firstPageNextCursor] : [null],
        currentWastePageIndex: 0,
        hasMoreWaste: !!firstPageNextCursor
      });
      return;
    }

    set({
      wasteLogs: [],
      wasteCursorStack: [null],
      currentWastePageIndex: 0,
      hasMoreWaste: true
    });

    await get().fetchWastePage('current');
  },

  deleteSale: async (
    saleIdentifier,
    {
      restoreStock = false,
      dispositionPlan = null,
      reason = '',
      cancelledBy = 'local-user',
      allowWaste = false
    } = {}
  ) => {
    const normalizedRestoreStock = Boolean(restoreStock);
    set({ isLoading: true });

    try {
      // 1. Recuperar ventas actuales en memoria
      const currentSales = get().sales;

      // 2. Pasar currentSales para respetar la firma original de la función (evita la regresión)
      const saleToCancel = currentSales.find((sale) => (
        sale.id === saleIdentifier || sale.timestamp === saleIdentifier
      ));
      const result = await cancelSale({
        saleId: saleToCancel?.id || saleIdentifier,
        timestamp: saleToCancel?.timestamp || saleIdentifier,
        restoreStock: normalizedRestoreStock,
        currentSales,
        dispositionPlan,
        reason,
        cancelledBy,
        allowWaste
      });

      if (result.success) {
        set(state => ({
          sales: state.sales.map(sale =>
            sale.id === (result.sale?.id || saleToCancel?.id || saleIdentifier)
              || sale.timestamp === (result.sale?.timestamp || saleToCancel?.timestamp || saleIdentifier)
              ? (result.sale || sale)
              : sale
          )
        }));
      }

      return result;
    } catch (error) {
      Logger.error('Error inesperado al cancelar venta:', error);
      return {
        success: false,
        code: 'ERROR',
        restoreStock: normalizedRestoreStock,
        warnings: [],
        message: error?.message || 'Error inesperado al cancelar la venta.'
      };
    } finally {
      set({ isLoading: false });
    }
  },

  archiveCancelledSale: async (saleId) => {
    set({ isLoading: true });
    try {
      const result = await moveCancelledSaleToTrash(saleId);
      if (result.success) {
        set(state => ({
          sales: state.sales.filter((sale) => sale.id !== saleId)
        }));
      }
      return result;
    } catch (error) {
      Logger.error('Error inesperado moviendo venta a papelera:', error);
      return {
        success: false,
        code: 'ERROR',
        message: error?.message || 'No se pudo mover la venta a papelera.'
      };
    } finally {
      set({ isLoading: false });
    }
  }
}));
