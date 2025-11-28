import { create } from 'zustand';
import { loadData, saveData, deleteData, loadDataPaginated, STORES } from '../services/database';
import { useStatsStore } from './useStatsStore'; // Importamos el otro store para comunicación

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
      if (!window.confirm('¿Restaurar stock y eliminar venta?')) return;
      try {
        let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
        if (!saleToDelete) {
          const allSales = await loadData(STORES.SALES);
          saleToDelete = allSales.find(s => s.timestamp === timestamp);
        }
        if (!saleToDelete) return;
  
        let restoredInventoryValue = 0;
  
        for (const item of saleToDelete.items) {
          if (item.batchesUsed) {
            for (const batchInfo of item.batchesUsed) {
              const batch = await loadData(STORES.PRODUCT_BATCHES, batchInfo.batchId);
              if (batch) {
                batch.stock += batchInfo.quantity;
                batch.isActive = true;
                await saveData(STORES.PRODUCT_BATCHES, batch);
  
                // Sumamos al valor recuperado
                restoredInventoryValue += (batch.cost * batchInfo.quantity);
              }
            }
          }
        }
  
        // Restauramos el valor del inventario
        await get().adjustInventoryValue(restoredInventoryValue);
  
        saleToDelete.deletedTimestamp = new Date().toISOString();
        await saveData(STORES.DELETED_SALES, saleToDelete);
        await deleteData(STORES.SALES, timestamp);
        get().loadAllData(true);
      } catch (error) { console.error("Error eliminar venta:", error); }
    }
}));