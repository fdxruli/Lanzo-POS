import { create } from 'zustand';
import {
  loadData,
  saveDataSafe,
  deleteDataSafe,
  bulkDeleteSafe,
  STORES
} from '../services/database';
import Logger from '../services/Logger';
import { restoreDeletedSale } from '../services/salesService';

const RECYCLE_BIN_LIMIT = 50;

export const useRecycleBinStore = create((set, get) => ({
  deletedItems: [],
  isLoading: false,

  // --- CARGAR DATOS ---
  loadRecycleBin: async () => {
    set({ isLoading: true });
    try {
      // Limitamos a 50 registros recientes por tabla
      const [delMenu, delCust, delSales, delCats] = await Promise.all([
        loadData(STORES.DELETED_MENU).then(items => (items || []).slice(-RECYCLE_BIN_LIMIT)),
        loadData(STORES.DELETED_CUSTOMERS).then(items => (items || []).slice(-RECYCLE_BIN_LIMIT)),
        loadData(STORES.DELETED_SALES).then(items => (items || []).slice(-RECYCLE_BIN_LIMIT)),
        loadData(STORES.DELETED_CATEGORIES).then(items => (items || []).slice(-RECYCLE_BIN_LIMIT))
      ]);

      // Mapeamos para la vista unificada
      const allMovements = [
        ...(delMenu || []).map(p => ({ ...p, type: 'Producto', uniqueId: p.id, mainLabel: p.name })),
        ...(delCust || []).map(c => ({ ...c, type: 'Cliente', uniqueId: c.id, mainLabel: c.name })),
        ...(delSales || []).map(s => ({ ...s, type: 'Pedido', uniqueId: s.timestamp, mainLabel: `Pedido $${s.total}` })),
        ...(delCats || []).map(c => ({ ...c, type: 'Categoría', uniqueId: c.id, mainLabel: c.name }))
      ];

      // Ordenar: Más reciente primero
      allMovements.sort((a, b) => new Date(b.deletedTimestamp || 0) - new Date(a.deletedTimestamp || 0));

      set({ deletedItems: allMovements, isLoading: false });
    } catch (e) {
      Logger.error("Error cargando papelera", e);
      set({ isLoading: false });
    }
  },

  // --- RESTAURAR ITEM (Devolver a la vida) ---
  restoreItem: async (item) => {
    set({ isLoading: true });
    try {
      if (item.type === 'Pedido') {
        const result = await restoreDeletedSale(item.id || item.timestamp);
        if (!result.success) {
          throw new Error(result.message || 'No se pudo restaurar la venta.');
        }

        set(state => ({
          deletedItems: state.deletedItems.filter(i =>
            (i.uniqueId !== item.uniqueId) && (i.timestamp !== item.timestamp)
          )
        }));
        return result;
      }

      // Copia profunda y limpieza de metadatos de borrado
      const itemToRestore = structuredClone(item);
      delete itemToRestore.deletedTimestamp;
      delete itemToRestore.deletedReason;
      delete itemToRestore.originalStore;
      delete itemToRestore.type;
      delete itemToRestore.uniqueId;
      delete itemToRestore.mainLabel;

      let targetStore = '';
      let trashStore = '';
      const key = item.id;

      switch (item.type) {
        case 'Producto':
          targetStore = STORES.MENU;
          trashStore = STORES.DELETED_MENU;
          itemToRestore.isActive = true;
          break;
        case 'Cliente':
          targetStore = STORES.CUSTOMERS;
          trashStore = STORES.DELETED_CUSTOMERS;
          break;
        case 'Categoría':
          targetStore = STORES.CATEGORIES;
          trashStore = STORES.DELETED_CATEGORIES;
          itemToRestore.isActive = true;
          break;
        default:
            throw new Error("Tipo desconocido para restaurar");
      }

      // 1. Guardar en tienda original
      const saveResult = await saveDataSafe(targetStore, itemToRestore);

      if (saveResult.success) {
        // 2. Si tuvo éxito, borrar de la papelera
        await deleteDataSafe(trashStore, key);

        // 3. Actualizar estado local (sin recargar toda la papelera)
        set(state => ({
          deletedItems: state.deletedItems.filter(i =>
            (i.uniqueId !== item.uniqueId) && (i.timestamp !== item.timestamp)
          )
        }));
        return { success: true };
      } else {
        throw new Error(saveResult.error?.message || 'No se pudo restaurar el elemento.');
      }

    } catch (error) {
      Logger.error("Error restaurando:", error);
      return { success: false, message: error.message || 'Error inesperado al restaurar.' };
    } finally {
        set({ isLoading: false });
    }
  },

  // --- ELIMINAR PERMANENTEMENTE (Liberar espacio) ---
  permanentlyDelete: async (item) => {
    // Confirmación extra de seguridad debería hacerse en el componente (UI),
    // pero aquí ejecutamos la acción.
    set({ isLoading: true });
    try {
        let trashStore = '';
        let key = item.id;

        // Identificar de qué tienda de basura borrar
        switch (item.type) {
            case 'Producto': trashStore = STORES.DELETED_MENU; break;
            case 'Cliente': trashStore = STORES.DELETED_CUSTOMERS; break;
            case 'Categoría': trashStore = STORES.DELETED_CATEGORIES; break;
            case 'Pedido':
                trashStore = STORES.DELETED_SALES;
                key = item.id || item.timestamp;
                break;
            default: throw new Error("Tipo desconocido para eliminar");
        }

        // Borrar definitivamente de la BD
        await deleteDataSafe(trashStore, key);

        // Actualizar estado local (más rápido que recargar todo)
        set(state => ({
            deletedItems: state.deletedItems.filter(i =>
                // Comparamos por ID o Timestamp según el caso para asegurar unicidad
                (i.id !== item.id) && (i.timestamp !== item.timestamp)
            )
        }));

    } catch (error) {
        Logger.error("Error eliminando permanentemente", error);
        alert("Error al eliminar el archivo permanentemente.");
    } finally {
        set({ isLoading: false });
    }
  },

  // --- VACIAR PAPELERA (Borrar todo) ---
  emptyBin: async () => {
    set({ isLoading: true });
    try {
        const { deletedItems } = get();
        if (deletedItems.length === 0) return;

        // Agrupar IDs por tienda para borrado masivo
        const itemsByStore = {
          [STORES.DELETED_MENU]: [],
          [STORES.DELETED_CUSTOMERS]: [],
          [STORES.DELETED_CATEGORIES]: [],
          [STORES.DELETED_SALES]: []
        };

        deletedItems.forEach(item => {
          switch (item.type) {
            case 'Producto':
              itemsByStore[STORES.DELETED_MENU].push(item.id);
              break;
            case 'Cliente':
              itemsByStore[STORES.DELETED_CUSTOMERS].push(item.id);
              break;
            case 'Categoría':
              itemsByStore[STORES.DELETED_CATEGORIES].push(item.id);
              break;
            case 'Pedido':
              itemsByStore[STORES.DELETED_SALES].push(item.id || item.timestamp);
              break;
            default:
              break;
          }
        });

        // Ejecutar borrado masivo por tienda
        const deletePromises = Object.entries(itemsByStore)
          .filter(([_, keys]) => keys.length > 0)
          .map(([store, keys]) => bulkDeleteSafe(store, keys));

        await Promise.all(deletePromises);

        // Limpiar estado
        set({ deletedItems: [] });

    } catch (error) {
        Logger.error("Error vaciando papelera", error);
        alert("Hubo un problema al intentar vaciar la papelera.");
    } finally {
        set({ isLoading: false });
    }
  }
}));
