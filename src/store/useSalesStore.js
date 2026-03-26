// src/store/useSalesStore.js
import { create } from 'zustand';
import {
  loadDataPaginated,
  STORES
} from '../services/database';
import Logger from '../services/Logger';
import { cancelSale } from '../services/salesService';

export const useSalesStore = create((set, get) => ({
  sales: [],
  wasteLogs: [],
  wasteCursorStack: [null],
  currentWastePageIndex: 0,
  hasMoreWaste: true,
  isWasteLoading: false,
  isLoading: false,

  loadRecentSales: async () => {
    set({ isLoading: true });
    try {
      const [recentSales, wastePage] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev', timeIndex: 'timestamp' }),
        loadDataPaginated(STORES.WASTE, { limit: 50, direction: 'prev', timeIndex: 'timestamp' })
      ]);

      const nextWasteCursor = wastePage?.nextCursor || null;
      set({
        sales: recentSales?.data || [],
        wasteLogs: wastePage?.data || [],
        wasteCursorStack: nextWasteCursor ? [null, nextWasteCursor] : [null],
        currentWastePageIndex: 0,
        hasMoreWaste: !!nextWasteCursor,
        isWasteLoading: false,
        isLoading: false
      });
    } catch (error) {
      Logger.error('Error cargando ventas y mermas recientes:', error);
      set({ isLoading: false, isWasteLoading: false });
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

  deleteSale: async (timestamp, { restoreStock = false } = {}) => {
    const normalizedRestoreStock = Boolean(restoreStock);
    set({ isLoading: true });

    try {
      // 1. Recuperar ventas actuales en memoria
      const currentSales = get().sales;

      // 2. Pasar currentSales para respetar la firma original de la función (evita la regresión)
      const result = await cancelSale({
        timestamp,
        restoreStock: normalizedRestoreStock,
        currentSales
      });

      if (result.success) {
        // 3. Determinar la profundidad de la vista actual del usuario.
        // Si hay más de 50 elementos cargados, respetamos ese tamaño para no perder el contexto.
        const targetLimit = Math.max(50, currentSales.length);

        // 4. Recargar desde la BD con el límite ajustado.
        // Al traer la misma cantidad de elementos (pero con uno borrado de la BD), 
        // automáticamente el siguiente registro más antiguo "sube" para rellenar el hueco.
        const { data: recentSales } = await loadDataPaginated(STORES.SALES, {
          limit: targetLimit,
          direction: 'prev',
          timeIndex: 'timestamp'
        });

        set({ sales: recentSales || [] });
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
  }
}));
