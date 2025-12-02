import { create } from 'zustand';
import { loadData, saveData, deleteData, STORES } from '../services/database';

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

        // A) Reconstruir la lista de deducciones y verificar lotes "fantasmas"
        if (sale.items) {
          for (const prod of sale.items) {
            if (prod.batchesUsed) {
              for (const batchRecord of prod.batchesUsed) {
                // Verificar si el lote original aún existe
                let existingBatch = await loadData(STORES.PRODUCT_BATCHES, batchRecord.batchId);

                // Si el lote fue eliminado físicamente, lo "resucitamos" para mantener la integridad
                if (!existingBatch) {
                  console.warn(`Resucitando lote eliminado: ${batchRecord.batchId}`);
                  existingBatch = {
                    id: batchRecord.batchId,
                    productId: prod.parentId || prod.id,
                    // IMPORTANTE: Le damos el stock exacto que se va a consumir para que la transacción pase
                    stock: batchRecord.quantity,
                    cost: batchRecord.cost,
                    price: prod.price,
                    createdAt: new Date().toISOString(),
                    isActive: true,
                    notes: "Lote restaurado automáticamente desde Papelera"
                  };
                  // Guardamos el lote resucitado antes de procesar la venta
                  await saveData(STORES.PRODUCT_BATCHES, existingBatch);
                }

                batchesToDeduct.push({
                  batchId: batchRecord.batchId,
                  quantity: batchRecord.quantity
                });
              }
            }
          }
        }

        // B) Limpiar propiedades de la papelera
        // Eliminamos campos que agrega la UI de la papelera para no ensuciar la BD
        const { type, uniqueId, mainLabel, subLabel, deletedTimestamp, ...cleanSale } = sale;

        // C) Ejecutar Transacción Atómica (Guardar Venta + Descontar Stock)
        try {
          // Usamos la misma lógica que en el cobro para asegurar que el stock cuadre
          await executeSaleTransaction(cleanSale, batchesToDeduct);

          // Si todo salió bien, eliminamos definitivamente de la papelera
          await deleteData(STORES.DELETED_SALES, sale.timestamp);

          alert("✅ Pedido restaurado y stock descontado nuevamente.");
        } catch (err) {
          console.error(err);
          alert(`⚠️ No se pudo restaurar: ${err.message}. Probablemente no hay stock suficiente en los lotes originales.`);
          return;
        }

      }
      // === CASO ESTÁNDAR (Clientes, Productos, Categorías) ===
      else {
        // Limpiamos la marca de tiempo de borrado
        const itemToRestore = { ...item };
        delete itemToRestore.deletedTimestamp;

        // Limpiamos las propiedades visuales de la papelera
        const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = itemToRestore;

        if (item.type === 'Producto') {
          await saveData(STORES.MENU, cleanItem);
          await deleteData(STORES.DELETED_MENU, item.id);
        } else if (item.type === 'Cliente') {
          await saveData(STORES.CUSTOMERS, cleanItem);
          await deleteData(STORES.DELETED_CUSTOMERS, item.id);
        } else if (item.type === 'Categoría') {
          await saveData(STORES.CATEGORIES, cleanItem);
          await deleteData(STORES.DELETED_CATEGORIES, item.id);
        }
      }

      // Actualizar la lista de la papelera
      await get().loadRecycleBin();

      // Opcional: Recargar la página si necesitas refrescar otros stores
      // window.location.reload(); 

    } catch (error) {
      console.error("Error crítico al restaurar:", error);
      alert("Error al intentar restaurar el elemento.");
    }
  }
}));