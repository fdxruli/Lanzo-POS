import { create } from 'zustand';
import { 
  loadData, 
  saveDataSafe, 
  deleteDataSafe, 
  STORES 
} from '../services/database';
import Logger from '../services/Logger';

export const useRecycleBinStore = create((set, get) => ({
  deletedItems: [],
  isLoading: false,

  // --- CARGAR DATOS ---
  loadRecycleBin: async () => {
    set({ isLoading: true });
    try {
      // Cargamos todo desde las tiendas de "papelera"
      const [delMenu, delCust, delSales, delCats] = await Promise.all([
        loadData(STORES.DELETED_MENU),
        loadData(STORES.DELETED_CUSTOMERS),
        loadData(STORES.DELETED_SALES),
        loadData(STORES.DELETED_CATEGORIES)
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
      let key = item.id;

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
          break;
        case 'Pedido':
          targetStore = STORES.SALES;
          trashStore = STORES.DELETED_SALES;
          key = item.id || item.timestamp;
          itemToRestore.restoredFromTrash = true;
          itemToRestore.restoredDate = new Date().toISOString();
          break;
        default:
            throw new Error("Tipo desconocido para restaurar");
      }

      // 1. Guardar en tienda original
      const saveResult = await saveDataSafe(targetStore, itemToRestore);
      
      if (saveResult.success) {
        // 2. Si tuvo éxito, borrar de la papelera
        await deleteDataSafe(trashStore, key);
        
        // 3. Recargar papelera
        await get().loadRecycleBin();
        
        if(item.type === 'Pedido') {
            alert("✅ Pedido devuelto al historial.");
        }
      } else {
        alert(`Error al restaurar: ${saveResult.error?.message}`);
      }

    } catch (error) {
      Logger.error("Error restaurando:", error);
      alert("Error inesperado al restaurar.");
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

        // Creamos una lista de promesas para borrar todo en paralelo
        const deletePromises = deletedItems.map(item => {
            let trashStore = '';
            let key = item.id;

            switch (item.type) {
                case 'Producto': trashStore = STORES.DELETED_MENU; break;
                case 'Cliente': trashStore = STORES.DELETED_CUSTOMERS; break;
                case 'Categoría': trashStore = STORES.DELETED_CATEGORIES; break;
                case 'Pedido': 
                    trashStore = STORES.DELETED_SALES; 
                    key = item.id || item.timestamp;
                    break;
                default: return Promise.resolve(); // Ignorar desconocidos
            }

            return deleteDataSafe(trashStore, key);
        });

        // Ejecutar todas las eliminaciones
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