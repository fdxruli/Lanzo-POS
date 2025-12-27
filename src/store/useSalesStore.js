// src/store/useSalesStore.js
import { create } from 'zustand';
import {
  loadData,
  saveDataSafe,
  deleteDataSafe,
  loadDataPaginated,
  STORES,
  recycleData
} from '../services/database';
import { useStatsStore } from './useStatsStore';
import Logger from '../services/Logger';

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
    
    // 1. Confirmación honesta (Auditoría)
    const confirmMessage = '¿Mover esta venta a la Papelera?\n\nNOTA: Esto solo la elimina del historial visible. NO devuelve los productos al inventario.';
    if (!window.confirm(confirmMessage)) return;

    set({ isLoading: true });

    try {
      // 2. BUSCAR LA VENTA PRIMERO
      // Necesitamos el objeto completo para obtener su 'id' real (Key de la BD)
      // y también para asegurarnos de que existe antes de intentar moverla.
      const currentSales = get().sales;
      const saleFound = currentSales.find(s => s.timestamp === timestamp);

      if (!saleFound) {
        alert("⚠️ No se encontró la venta. Intenta recargar la página.");
        set({ isLoading: false });
        return;
      }

      // 3. RECICLAR USANDO EL ID
      // Aunque la UI usa timestamp, la base de datos usa 'id'.
      // Usamos saleFound.id para asegurar que le pegamos al registro correcto.
      const result = await recycleData(
        STORES.SALES,          // Origen
        STORES.DELETED_SALES,  // Destino
        saleFound.id,          // <--- AQUI ESTÁ LA CLAVE: Usamos el ID real
        "Eliminado manualmente desde Historial" 
      );

      if (result.success) {
        // 4. ACTUALIZAR UI
        // Filtramos usando timestamp porque es lo que tenemos a mano y es único
        const updatedSales = currentSales.filter(s => s.timestamp !== timestamp);
        
        set({ 
          sales: updatedSales,
          isLoading: false 
        });

        alert("✅ Venta movida a la papelera (Auditoría).");
      } else {
        console.warn("Fallo reciclaje:", result);
        alert("No se pudo mover a la papelera. Revisa la consola.");
        set({ isLoading: false });
      }

    } catch (error) {
      Logger.error("Error crítico al eliminar venta:", error);
      alert("Ocurrió un error inesperado.");
      set({ isLoading: false });
    }
  }
}));