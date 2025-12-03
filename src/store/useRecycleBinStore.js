import { create } from 'zustand';
import { 
  loadData, 
  saveDataSafe, 
  deleteDataSafe, 
  executeSaleTransactionSafe, 
  STORES 
} from '../services/database';

export const useRecycleBinStore = create((set, get) => ({
  deletedItems: [],
  isLoading: false,

  loadRecycleBin: async () => {
    set({ isLoading: true });
    try {
      const [delMenu, delCust, delSales, delCats] = await Promise.all([
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES),
        loadData(STORES.DELETED_CATEGORIES)
      ]);
      const allMovements = [
        ...delMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, mainLabel: p.name })),
        ...delCust.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...delSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido $${s.total}` })),
        ...(delCats || []).map(c => ({ ...c, type: 'Categoría', uniqueId: c.id, mainLabel: c.name }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));
      set({ deletedItems: allMovements, isLoading: false });
    } catch (e) { set({ isLoading: false }); }
  },

  restoreItem: async (item) => {
    try {
      // === CASO ESPECIAL: RESTAURAR VENTA (PEDIDO) ===
      if (item.type === 'Pedido') {
        const sale = item;
        const batchesToDeduct = [];

        // A) Reconstruir lotes (Lógica existente...)
        if (sale.items) {
          for (const prod of sale.items) {
            if (prod.batchesUsed) {
              for (const batchRecord of prod.batchesUsed) {
                let existingBatch = await loadData(STORES.PRODUCT_BATCHES, batchRecord.batchId);

                if (!existingBatch) {
                  console.warn(`Resucitando lote eliminado: ${batchRecord.batchId}`);
                  existingBatch = {
                    id: batchRecord.batchId,
                    productId: prod.parentId || prod.id,
                    stock: batchRecord.quantity,
                    cost: batchRecord.cost,
                    price: prod.price,
                    createdAt: new Date().toISOString(),
                    isActive: true,
                    notes: "Lote restaurado automáticamente desde Papelera"
                  };
                  // REFACTORIZADO: Guardado seguro del lote resucitado
                  await saveDataSafe(STORES.PRODUCT_BATCHES, existingBatch);
                }

                batchesToDeduct.push({
                  batchId: batchRecord.batchId,
                  quantity: batchRecord.quantity
                });
              }
            }
          }
        }

        const { type, uniqueId, mainLabel, subLabel, deletedTimestamp, ...cleanSale } = sale;

        // C) Ejecutar Transacción Atómica SAFE
        // Ya no usamos try/catch para la transacción, evaluamos el .success
        const txResult = await executeSaleTransactionSafe(cleanSale, batchesToDeduct);

        if (txResult.success) {
            // Si la venta se restauró, borramos de la papelera de forma segura
            await deleteDataSafe(STORES.DELETED_SALES, sale.timestamp);
            alert("✅ Pedido restaurado y stock descontado nuevamente.");
        } else {
            // Manejo de error controlado
            console.error(txResult.error);
            const msg = txResult.error?.message || "Error desconocido en transacción";
            alert(`⚠️ No se pudo restaurar: ${msg}`);
            return;
        }

      }
      // === CASO ESTÁNDAR (Clientes, Productos, Categorías) ===
      else {
        const itemToRestore = { ...item };
        delete itemToRestore.deletedTimestamp;
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = itemToRestore;

        let saveResult = { success: false };
        let deleteResult = { success: false };

        if (item.type === 'Producto') {
          saveResult = await saveDataSafe(STORES.MENU, cleanItem);
          if(saveResult.success) deleteResult = await deleteDataSafe(STORES.DELETED_MENU, item.id);
        } else if (item.type === 'Cliente') {
          saveResult = await saveDataSafe(STORES.CUSTOMERS, cleanItem);
          if(saveResult.success) deleteResult = await deleteDataSafe(STORES.DELETED_CUSTOMERS, item.id);
        } else if (item.type === 'Categoría') {
          saveResult = await saveDataSafe(STORES.CATEGORIES, cleanItem);
          if(saveResult.success) deleteResult = await deleteDataSafe(STORES.DELETED_CATEGORIES, item.id);
        }

        if (!saveResult.success) {
            alert(`Error al restaurar: ${saveResult.error?.message}`);
        }
      }

      await get().loadRecycleBin();

    } catch (error) {
      console.error("Error crítico al restaurar:", error);
      alert("Error inesperado al intentar restaurar el elemento.");
    }
  }
}));