// src/store/useSalesStore.js
import { create } from 'zustand';
import {
  loadDataPaginated,
  STORES
} from '../services/database';
import Logger from '../services/Logger';
import { cancelSale, moveCancelledSaleToTrash } from '../services/salesService';

const WASTE_PAGE_SIZE = 50;
const WASTE_READ_ERROR = 'No se pudo consultar el historial de mermas de este dispositivo. Intenta nuevamente.';

// Leer solamente una fila adicional para saber si existe otra página.
// No se calcula aquí un total histórico, ni se consulta Cloud.
const readWastePage = async (cursor = null) => {
  const { data } = await loadDataPaginated(STORES.WASTE, {
    limit: WASTE_PAGE_SIZE + 1,
    cursor,
    timeIndex: 'timestamp'
  });
  const rows = Array.isArray(data) ? data : [];
  const visible = rows.slice(0, WASTE_PAGE_SIZE);
  return {
    data: visible,
    nextCursor: rows.length > WASTE_PAGE_SIZE
      ? visible[visible.length - 1]?.timestamp ?? null
      : null
  };
};

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
  wasteLoaded: false,
  wasteError: null,
  wasteContextKey: null,
  wasteRequestId: 0,
  isLoading: false,

  setWasteContext: (contextKey) => {
    const state = get();
    if (state.wasteContextKey === contextKey) return;
    set({
      wasteContextKey: contextKey,
      wasteRequestId: state.wasteRequestId + 1,
      wasteLogs: [],
      wasteCursorStack: [null],
      currentWastePageIndex: 0,
      hasMoreWaste: false,
      isWasteLoading: false,
      wasteLoaded: false,
      wasteError: null
    });
  },

  loadRecentSales: async () => {
    const requestId = get().wasteRequestId + 1;
    set({
      isLoading: true,
      isWasteLoading: true,
      wasteLoaded: false,
      wasteError: null,
      wasteRequestId: requestId
    });

    // Una lectura fallida de mermas no debe ocultar el historial de ventas.
    const [salesResult, wasteResult] = await Promise.allSettled([
      loadDataPaginated(STORES.SALES, { limit: 50, timeIndex: 'timestamp' }),
      readWastePage()
    ]);

    if (salesResult.status === 'rejected') {
      Logger.error('Error cargando ventas recientes:', salesResult.reason);
    }
    if (wasteResult.status === 'rejected') {
      Logger.error('Error cargando historial local de mermas:', wasteResult.reason);
    }

    const salesPatch = salesResult.status === 'fulfilled'
      ? {
        sales: salesResult.value?.data || [],
        salesCursorStack: salesResult.value?.nextCursor
          ? [null, salesResult.value.nextCursor] : [null],
        currentSalesPageIndex: 0,
        hasMoreSales: !!salesResult.value?.nextCursor
      }
      : {};

    const wastePatch = get().wasteRequestId !== requestId
      ? {}
      : wasteResult.status === 'fulfilled'
        ? {
          wasteLogs: wasteResult.value.data,
          wasteCursorStack: wasteResult.value.nextCursor
            ? [null, wasteResult.value.nextCursor] : [null],
          currentWastePageIndex: 0,
          hasMoreWaste: !!wasteResult.value.nextCursor,
          wasteLoaded: true,
          wasteError: null,
          isWasteLoading: false
        }
        : {
          wasteLogs: [],
          wasteCursorStack: [null],
          currentWastePageIndex: 0,
          hasMoreWaste: false,
          wasteLoaded: false,
          wasteError: WASTE_READ_ERROR,
          isWasteLoading: false
        };
    set({ ...salesPatch, ...wastePatch, isSalesLoading: false, isLoading: false });
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
      targetPageIndex = state.currentWastePageIndex - 1;
    }

    const targetCursor = state.wasteCursorStack[targetPageIndex] ?? null;
    const requestId = state.wasteRequestId + 1;
    set({ isWasteLoading: true, wasteError: null, wasteRequestId: requestId });
    try {
      const { data, nextCursor } = await readWastePage(targetCursor);
      if (get().wasteRequestId !== requestId) return;

      const newWasteCursorStack = [...state.wasteCursorStack];
      if (nextCursor) {
        newWasteCursorStack[targetPageIndex + 1] = nextCursor;
      } else {
        newWasteCursorStack.length = targetPageIndex + 1;
      }

      set({
        wasteLogs: data,
        wasteCursorStack: newWasteCursorStack,
        currentWastePageIndex: targetPageIndex,
        hasMoreWaste: !!nextCursor,
        wasteLoaded: true,
        wasteError: null,
        isWasteLoading: false
      });
    } catch (error) {
      Logger.error('Error en fetchWastePage:', error);
      if (get().wasteRequestId !== requestId) return;
      set({
        wasteLogs: [],
        wasteLoaded: false,
        wasteError: WASTE_READ_ERROR,
        isWasteLoading: false
      });
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
        wasteRequestId: state.wasteRequestId + 1,
        isWasteLoading: false,
        wasteLoaded: true,
        wasteError: null,
        wasteLogs: firstPageWasteLogs,
        wasteCursorStack: firstPageNextCursor ? [null, firstPageNextCursor] : [null],
        currentWastePageIndex: 0,
        hasMoreWaste: !!firstPageNextCursor
      });
      return;
    }

    set({
      wasteRequestId: state.wasteRequestId + 1,
      isWasteLoading: false,
      wasteLoaded: false,
      wasteError: null,
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
      allowWaste = false,
      refunds = [],
      saleOverride = null,
      actorHandle = null
    } = {}
  ) => {
    const normalizedRestoreStock = Boolean(restoreStock);
    set({ isLoading: true });

    try {
      const currentSales = saleOverride
        ? [saleOverride, ...get().sales.filter((sale) => sale.id !== saleOverride.id && sale.cloudSaleId !== saleOverride.cloudSaleId)]
        : get().sales;

      const saleToCancel = currentSales.find((sale) => (
        sale.id === saleIdentifier ||
        sale.timestamp === saleIdentifier ||
        sale.cloudSaleId === saleIdentifier ||
        sale.cloud_sale_id === saleIdentifier
      ));

      const result = await cancelSale({
        saleId: saleToCancel?.id || saleToCancel?.cloudSaleId || saleToCancel?.cloud_sale_id || saleIdentifier,
        timestamp: saleToCancel?.timestamp || saleIdentifier,
        restoreStock: normalizedRestoreStock,
        currentSales,
        dispositionPlan,
        reason,
        cancelledBy,
        allowWaste,
        refunds,
        actorHandle
      });

      if (result.success) {
        set(state => ({
          sales: state.sales.map(sale =>
            sale.id === (result.sale?.id || saleToCancel?.id || saleIdentifier)
              || sale.timestamp === (result.sale?.timestamp || saleToCancel?.timestamp || saleIdentifier)
              || sale.cloudSaleId === (result.sale?.cloudSaleId || saleToCancel?.cloudSaleId || saleIdentifier)
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
        code: error?.code || 'ERROR',
        restoreStock: normalizedRestoreStock,
        warnings: [],
        message: error?.message || 'Error inesperado al cancelar la venta.'
      };
    } finally {
      set({ isLoading: false });
    }
  },

  archiveCancelledSale: async (saleId, { actorHandle = null } = {}) => {
    set({ isLoading: true });
    try {
      const result = await moveCancelledSaleToTrash(saleId, { actorHandle });
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
        code: error?.code || 'ERROR',
        message: error?.message || 'No se pudo mover la venta a papelera.'
      };
    } finally {
      set({ isLoading: false });
    }
  }
}));
