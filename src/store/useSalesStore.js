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

        // Guardaremos los IDs de los productos con lotes para recalcular su total visual al final
        const affectedParentIds = new Set();

        for (const item of saleFound.items) {

          // -------------------------------------------------------------
          // CASO A: El producto usó LOTES (de sí mismo o de ingredientes)
          // -------------------------------------------------------------
          if (item.batchesUsed && item.batchesUsed.length > 0) {
            for (const batchUsage of item.batchesUsed) {
              try {
                const batch = await loadData(STORES.PRODUCT_BATCHES, batchUsage.batchId);
                if (batch) {
                  batch.stock = (Number(batch.stock) || 0) + Number(batchUsage.quantity);
                  if (batch.stock > 0) batch.isActive = true;
                  batch.updatedAt = new Date().toISOString();

                  await saveDataSafe(STORES.PRODUCT_BATCHES, batch);

                  // Anotar el producto para sincronizar el catálogo principal después
                  const parentIdToSync = batchUsage.ingredientId || batch.productId;
                  if (parentIdToSync) affectedParentIds.add(parentIdToSync);

                }
              } catch (err) {
                Logger.error(`Error restaurando el lote ${batchUsage.batchId}:`, err);
              }
            }
          }

          // -------------------------------------------------------------
          // CASO B: Producto SIMPLE (Ej. Coca Cola sin lotes)
          // -------------------------------------------------------------
          else {
            try {
              const realProductId = item.parentId || item.id;
              const parentProduct = await loadData(STORES.MENU, realProductId);

              // Solo devolvemos si realmente lleva control de inventario
              if (parentProduct && parentProduct.trackStock !== false) {
                // Usamos stockDeducted (si lo guardó la venta) o la cantidad pedida
                const qtyToReturn = Number(item.stockDeducted ?? item.quantity);

                parentProduct.stock = (Number(parentProduct.stock) || 0) + qtyToReturn;
                parentProduct.updatedAt = new Date().toISOString();

                await saveDataSafe(STORES.MENU, parentProduct);
                Logger.log(`Stock directo restaurado: ${parentProduct.name} +${qtyToReturn}`);
              }
            } catch (err) {
              Logger.error(`Error restaurando producto simple ${item.id}:`, err);
            }
          }
        }

        // -------------------------------------------------------------
        // FASE 3.1: Sincronizar catálogo principal para productos con lotes
        // -------------------------------------------------------------
        // Si no hacemos esto, Dexie actualiza los lotes pero el catálogo mostrará el número viejo.
        if (affectedParentIds.size > 0) {
          const { db } = await import('../services/database'); // Importamos la instancia Dexie
          for (const productId of affectedParentIds) {
            try {
              const parentProduct = await loadData(STORES.MENU, productId);
              if (parentProduct) {
                // Sumamos la verdad absoluta: todos los lotes activos de este producto
                const allBatches = await db.table(STORES.PRODUCT_BATCHES)
                  .where('productId').equals(productId)
                  .toArray();

                const totalStock = allBatches
                  .filter(b => b.isActive && Number(b.stock) > 0)
                  .reduce((sum, b) => sum + Number(b.stock), 0);

                parentProduct.stock = totalStock;
                parentProduct.updatedAt = new Date().toISOString();
                await saveDataSafe(STORES.MENU, parentProduct);
              }
            } catch (err) {
              Logger.error(`Error sincronizando visualmente padre ${productId}:`, err);
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