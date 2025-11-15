// src/store/useDashboardStore.js
import { create } from 'zustand';
import { loadData, saveData, deleteData, STORES } from '../services/database';

// Esta función es de tu app.js original, la traemos aquí
function normalizeProducts(products) {
  if (!Array.isArray(products)) return [];
  return products.map(item => ({
    ...item,
    trackStock: item.trackStock !== undefined ? item.trackStock : (typeof item.stock === 'number' && item.stock > 0),
  }));
}

export const useDashboardStore = create((set, get) => ({
  // 1. ESTADO
  isLoading: true,
  sales: [],
  menu: [],
  deletedItems: [],

  // 2. ACCIONES
  
  /**
   * Carga todos los datos de la base de datos y actualiza el store
   */
  loadAllData: async () => {
    set({ isLoading: true });
    try {
      // Cargamos todo en paralelo
      const [salesData, menuData, deletedMenu, deletedCustomers, deletedSales] = await Promise.all([
        loadData(STORES.SALES),
        loadData(STORES.MENU).then(normalizeProducts),
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES)
      ]);

      // Combinamos la papelera (lógica de 'renderMovementHistory')
      const allMovements = [
        ...deletedMenu.map(p => ({ ...p, type: 'Producto', uniqueId: p.id, name: p.name })),
        ...deletedCustomers.map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, name: c.name })),
        ...deletedSales.map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, name: `Pedido por $${s.total.toFixed(2)}` }))
      ];
      allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));

      // Actualizamos el estado centralizado
      set({
        sales: salesData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
        menu: menuData,
        deletedItems: allMovements,
        isLoading: false
      });

    } catch (error) {
      console.error("Error cargando datos del dashboard:", error);
      set({ isLoading: false });
    }
  },

  /**
   * Elimina una venta (la mueve a la papelera)
   */
  deleteSale: async (timestamp) => {
    if (!window.confirm('¿Seguro? Se restaurará el stock y el pedido irá a la papelera.')) return;

    try {
      const saleToDelete = get().sales.find(s => s.timestamp === timestamp);
      if (!saleToDelete) throw new Error('Venta no encontrada');

      // Restaurar stock
      for (const item of saleToDelete.items) {
        if (item.trackStock) {
          const product = await loadData(STORES.MENU, item.id);
          if (product) {
            product.stock += item.stockDeducted !== undefined ? item.stockDeducted : item.quantity;
            await saveData(STORES.MENU, product);
          }
        }
      }

      // Mover a papelera
      saleToDelete.deletedTimestamp = new Date().toISOString();
      await saveData(STORES.DELETED_SALES, saleToDelete);
      await deleteData(STORES.SALES, timestamp);

      // Recargar datos en el store
      get().loadAllData();
    } catch (error) {
      console.error("Error al eliminar venta:", error);
    }
  },

  /**
   * Restaura un item desde la papelera
   */
  restoreItem: async (item) => {
    try {
      if (item.type === 'Producto') {
        delete item.deletedTimestamp;
        await saveData(STORES.MENU, item);
        await deleteData(STORES.DELETED_MENU, item.id);
      }
      else if (item.type === 'Cliente') {
        delete item.deletedTimestamp;
        await saveData(STORES.CUSTOMERS, item);
        await deleteData(STORES.DELETED_CUSTOMERS, item.id);
      }
      else if (item.type === 'Pedido') {
        // ... (Lógica de restauración de pedido y descuento de stock) ...
        for (const saleItem of item.items) {
          const stockToAdjust = saleItem.stockDeducted !== undefined
            ? saleItem.stockDeducted
            : saleItem.quantity;

          if (saleItem.trackStock && stockToAdjust > 0) {
            const product = await loadData(STORES.MENU, saleItem.id);
            if (product) {
              product.stock = Math.max(0, product.stock - stockToAdjust);
              await saveData(STORES.MENU, product);
            }
          }
        }
        delete item.deletedTimestamp;
        await saveData(STORES.SALES, item);
        await deleteData(STORES.DELETED_SALES, item.timestamp);
      }

      get().loadAllData(); // Recargar todo
    } catch (error) {
      console.error("Error al restaurar item:", error);
    }
  },
}));