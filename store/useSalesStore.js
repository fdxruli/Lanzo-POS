// src/store/useSalesStore.js
import { create } from 'zustand';
import {
  loadData,
  saveDataSafe,
  deleteDataSafe,
  loadDataPaginated,
  STORES
} from '../services/database';
import { useStatsStore } from './useStatsStore';

export const useSalesStore = create((set, get) => ({
  sales: [],
  wasteLogs: [],
  isLoading: false,

  loadRecentSales: async () => {
    set({ isLoading: true });
    try {
      const [recentSales, wasteData] = await Promise.all([
        loadDataPaginated(STORES.SALES, { limit: 50, direction: 'prev' }),
        loadData(STORES.WASTE)
      ]);

      const sortedWaste = (wasteData || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      set({ sales: recentSales, wasteLogs: sortedWaste, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
    }
  },

  deleteSale: async (timestamp) => {
    if (!window.confirm('¿Restaurar stock y eliminar venta de forma permanente?')) return;

    try {
      // 1. Encontrar la venta
      let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) {
        const allSales = await loadData(STORES.SALES);
        saleToDelete = allSales.find(s => s.timestamp === timestamp);
      }

      if (!saleToDelete) {
        alert("No se encontró la venta para eliminar.");
        return;
      }

      // 2. Restaurar Stock
      let restoredInventoryValue = 0;
      let saleProfit = 0;
      let itemsCount = 0;

      for (const item of saleToDelete.items) {
        itemsCount += (item.quantity || 0);

        const itemCost = item.cost || 0;
        const itemTotal = item.price * item.quantity;
        const itemProfit = itemTotal - (itemCost * item.quantity);
        saleProfit += itemProfit;

        // Restaurar lotes
        if (item.batchesUsed) {
          for (const batchInfo of item.batchesUsed) {
            const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
            if (batch) {
              batch.stock += batchInfo.quantity;
              batch.isActive = true;
              // CAMBIO: saveDataSafe
              await saveDataSafe(STORES.PRODUCT_BATCHES, batch);

              restoredInventoryValue += (batch.cost * batchInfo.quantity);
            }
          }
        }
      }

      // 3. Ajustar Valor de Inventario
      await useStatsStore.getState().adjustInventoryValue(restoredInventoryValue);

      // 4. Restar de Estadísticas Diarias
      const dateKey = new Date(saleToDelete.timestamp).toISOString().split('T')[0];
      const dailyStat = await loadData(STORES.DAILY_STATS, dateKey);

      if (dailyStat) {
        dailyStat.revenue -= saleToDelete.total;
        dailyStat.profit -= saleProfit;
        dailyStat.orders -= 1;
        dailyStat.itemsSold -= itemsCount;

        if (dailyStat.revenue < 0) dailyStat.revenue = 0;
        if (dailyStat.profit < 0) dailyStat.profit = 0;

        // CAMBIO: saveDataSafe
        await saveDataSafe(STORES.DAILY_STATS, dailyStat);
      }

      // 5. Mover a Papelera y Borrar
      saleToDelete.deletedTimestamp = new Date().toISOString();
      // CAMBIO: saveDataSafe
      await saveDataSafe(STORES.DELETED_SALES, saleToDelete);

      // CAMBIO: deleteDataSafe
      const deleteResult = await deleteDataSafe(STORES.SALES, timestamp);

      if (deleteResult.success) {
        // 6. Recargar UI solo si hubo éxito
        get().loadRecentSales();
        useStatsStore.getState().loadStats();
        alert("✅ Venta eliminada, stock restaurado y estadísticas actualizadas.");
      } else {
        alert(`Error al eliminar: ${deleteResult.error?.message}`);
      }

    } catch (error) {
      console.error("Error eliminar venta:", error);
      alert("Ocurrió un error al intentar eliminar la venta.");
    }
  }
}));