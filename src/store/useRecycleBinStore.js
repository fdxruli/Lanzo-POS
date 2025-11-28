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
        if (item.type === 'Producto') {
          delete item.deletedTimestamp;
          const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
          await saveData(STORES.MENU, cleanItem);
          await deleteData(STORES.DELETED_MENU, item.id);
        } else if (item.type === 'Cliente') {
          delete item.deletedTimestamp;
          const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
          await saveData(STORES.CUSTOMERS, cleanItem);
          await deleteData(STORES.DELETED_CUSTOMERS, item.id);
        } else if (item.type === 'Pedido') {
          delete item.deletedTimestamp;
          const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
          await saveData(STORES.SALES, cleanItem);
          await deleteData(STORES.DELETED_SALES, item.timestamp);
        } else if (item.type === 'Categoría') {
          delete item.deletedTimestamp;
          const { type, uniqueId, mainLabel, subLabel, ...cleanItem } = item;
          await saveData(STORES.CATEGORIES, cleanItem);
          await deleteData(STORES.DELETED_CATEGORIES, item.id);
        }
        await get().loadRecycleBin();
        get().loadAllData(true);
      } catch (error) { console.error("Error restaurar:", error); }
    }
}));