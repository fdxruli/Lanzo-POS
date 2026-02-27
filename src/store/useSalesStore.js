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
    // 1. Confirmación de eliminación de la venta
    if (!window.confirm('¿Mover esta venta a la Papelera?')) return;

    const currentSales = get().sales;
    const saleFound = currentSales.find(s => s.timestamp === timestamp);

    if (!saleFound) {
      alert("⚠️ No se encontró la venta. Intenta recargar la página.");
      return;
    }

    // 2. Decisión de Negocio: ¿Qué pasa con la mercancía?
    const confirmRestoreStock = window.confirm(
      '¿Deseas DEVOLVER los productos de esta venta al inventario físico?\n\n' +
      '• [Aceptar]: Sí, hubo un error de cobro y el producto sigue en mostrador.\n' +
      '• [Cancelar]: No, el producto es merma/pérdida (no regresará al stock).'
    );

    set({ isLoading: true });

    try {
      // 3. Reversión de Inventario (Solo si el usuario aceptó)
      if (confirmRestoreStock && saleFound.items) {
        Logger.log('Iniciando devolución de inventario para la venta:', saleFound.id);

        for (const item of saleFound.items) {
          // Revisamos si el item guardó el registro de qué lotes descontó
          if (item.batchesUsed && Array.isArray(item.batchesUsed)) {
            for (const batchUsage of item.batchesUsed) {
              try {
                // Cargar el lote original afectado
                const batch = await loadData(STORES.PRODUCT_BATCHES, batchUsage.batchId);

                if (batch) {
                  // Restaurar la cantidad exacta que se le descontó
                  batch.stock = (Number(batch.stock) || 0) + Number(batchUsage.quantity);

                  // Caso límite: Si el lote había llegado a 0 y se auto-desactivó, lo revivimos
                  if (batch.stock > 0) {
                    batch.isActive = true;
                  }

                  batch.updatedAt = new Date().toISOString();
                  await saveData(STORES.PRODUCT_BATCHES, batch);
                  Logger.log(`Stock restaurado: Lote ${batch.id}, Cantidad: +${batchUsage.quantity}`);
                } else {
                  Logger.warn(`Lote huérfano: No se encontró el lote ${batchUsage.batchId} en BD.`);
                }
              } catch (batchError) {
                Logger.error(`Error crítico restaurando el lote ${batchUsage.batchId}:`, batchError);
              }
            }
          }
        }
      }

      // 4. Mover a la papelera dejando rastro del motivo en el campo "reason"
      const auditReason = confirmRestoreStock
        ? "Eliminado manualmente - Inventario Devuelto"
        : "Eliminado manualmente - Inventario NO Devuelto (Merma)";

      const result = await recycleData(
        STORES.SALES,
        STORES.DELETED_SALES,
        saleFound.id,
        auditReason
      );

      if (result.success) {
        // 5. Actualizar la UI
        const updatedSales = currentSales.filter(s => s.timestamp !== timestamp);

        set({
          sales: updatedSales,
          isLoading: false
        });

        alert(confirmRestoreStock
          ? "✅ Venta cancelada y productos devueltos al stock."
          : "✅ Venta cancelada. Los productos se registraron como salida definitiva.");
      } else {
        alert("Fallo crítico: No se pudo mover a la papelera. Revisa la consola.");
        set({ isLoading: false });
      }

    } catch (error) {
      Logger.error("Error inesperado al cancelar venta:", error);
      alert("Ocurrió un error al procesar la cancelación.");
      set({ isLoading: false });
    }
  }
}));