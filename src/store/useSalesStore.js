// src/store/useSalesStore.js
import { create } from 'zustand';
import { loadData, saveData, deleteData, loadDataPaginated, STORES } from '../services/database';
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
        // 1. Encontrar la venta (en memoria o BD)
        let saleToDelete = get().sales.find(s => s.timestamp === timestamp);
        if (!saleToDelete) {
          const allSales = await loadData(STORES.SALES);
          saleToDelete = allSales.find(s => s.timestamp === timestamp);
        }
        
        if (!saleToDelete) {
            alert("No se encontró la venta para eliminar.");
            return;
        }
  
        // 2. Restaurar Stock (Lógica existente)
        let restoredInventoryValue = 0;
        let saleProfit = 0; // Calcularemos la ganancia para restarla
        let itemsCount = 0;

        for (const item of saleToDelete.items) {
          itemsCount += (item.quantity || 0);
          
          // Calcular utilidad de este item para restar a las estadísticas
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
                batch.isActive = true; // Reactivar lote si estaba en 0
                await saveData(STORES.PRODUCT_BATCHES, batch);
  
                // Sumamos al valor de inventario recuperado
                restoredInventoryValue += (batch.cost * batchInfo.quantity);
              }
            }
          }
        }
  
        // 3. Ajustar Valor de Inventario Global
        await useStatsStore.getState().adjustInventoryValue(restoredInventoryValue);
  
        // 4. CORRECCIÓN: Restar de Estadísticas Diarias (DAILY_STATS)
        const dateKey = new Date(saleToDelete.timestamp).toISOString().split('T')[0];
        const dailyStat = await loadData(STORES.DAILY_STATS, dateKey);

        if (dailyStat) {
            dailyStat.revenue -= saleToDelete.total;
            dailyStat.profit -= saleProfit;
            dailyStat.orders -= 1;
            dailyStat.itemsSold -= itemsCount;

            // Evitar números negativos por errores de redondeo
            if (dailyStat.revenue < 0) dailyStat.revenue = 0;
            if (dailyStat.profit < 0) dailyStat.profit = 0;

            await saveData(STORES.DAILY_STATS, dailyStat);
        }

        // 5. Mover a Papelera y Borrar
        saleToDelete.deletedTimestamp = new Date().toISOString();
        await saveData(STORES.DELETED_SALES, saleToDelete);
        await deleteData(STORES.SALES, timestamp);
        
        // 6. Recargar datos en la UI
        get().loadRecentSales();
        // Forzamos actualización del dashboard también
        useStatsStore.getState().loadStats(); 

        alert("✅ Venta eliminada, stock restaurado y estadísticas actualizadas.");

      } catch (error) { 
          console.error("Error eliminar venta:", error); 
          alert("Ocurrió un error al intentar eliminar la venta.");
      }
    }
}));