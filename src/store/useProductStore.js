// src/store/useProductStore.js
import { create } from 'zustand';
import {
    recycleData,
    loadDataPaginated,
    STORES
} from '../services/database';
import Logger from '../services/Logger';
import { categoriesRepository } from '../services/db/general';

/**
 * Store de productos con paginación correcta delegada a Dexie.
 *
 * FUENTE DE VERDAD ÚNICA:
 * Este store conserva el caché paginado del catálogo y filtros globales
 * de categoría/agotados. La búsqueda por texto se maneja localmente en UI.
 *
 * CATEGORÍA ESPECIAL 'CAT_DYNAMIC_AGOTADOS':
 * No es un ID de categoría real en la BD. Cuando setFilters recibe este
 * valor en categoryId, lo intercepta y lo convierte en el flag outOfStockOnly.
 * De esta forma, loadDataPaginated recibe siempre filtros semánticamente
 * correctos y nunca busca en la BD por el ID literal 'CAT_DYNAMIC_AGOTADOS'.
 */
export const useProductStore = create((set, get) => ({
    menu: [],
    categories: [],
    isLoading: false,

    // ── Motor de cursores ──────────────────────────────────────────
    cursorStack: [null],
    currentPageIndex: 0,
    hasMore: true,

    /**
     * Filtros que se envían directamente a loadDataPaginated.
     *
     * - categoryId    : ID real de categoría, o null para "todas"
     * - outOfStockOnly: true cuando el usuario selecciona la categoría virtual
     *                   'CAT_DYNAMIC_AGOTADOS'
     */
    filters: {
        categoryId: null,
        outOfStockOnly: false,
    },

    /**
     * Actualiza los filtros activos y reinicia la paginación desde el inicio.
     *
     * Intercepta la categoría virtual 'CAT_DYNAMIC_AGOTADOS' y la transforma
     * en el flag outOfStockOnly antes de enviarla a la BD.
     *
     * @param {object} newFilters - Objeto parcial con los filtros a actualizar.
     *   Puede contener: { categoryId?, outOfStockOnly? }
     */
    setFilters: (newFilters = {}) => {
        const { searchTerm, ...safeFilters } = newFilters;
        void searchTerm;
        if (Object.keys(safeFilters).length === 0) return;

        const currentFilters = get().filters;

        // Construcción del objeto de filtros resultante
        let resolvedFilters = { ...currentFilters, ...safeFilters };

        // Interceptar la categoría virtual de agotados
        if (safeFilters.categoryId === 'CAT_DYNAMIC_AGOTADOS') {
            resolvedFilters = {
                ...resolvedFilters,
                categoryId: null,        // No existe en BD, no debe pasarse a Dexie
                outOfStockOnly: true,    // El filtro semánticamente correcto
            };
        } else if ('categoryId' in safeFilters) {
            // Cambio a una categoría real (o null = todas): limpiar el flag de agotados
            resolvedFilters = {
                ...resolvedFilters,
                outOfStockOnly: false,
            };
        }

        const filtersChanged =
            resolvedFilters.categoryId !== currentFilters.categoryId ||
            resolvedFilters.outOfStockOnly !== currentFilters.outOfStockOnly;

        if (!filtersChanged) return;

        set({
            filters: resolvedFilters,
            // Reiniciar paginación al cambiar cualquier filtro
            cursorStack: [null],
            currentPageIndex: 0,
            menu: [],
            hasMore: true,
        });

        // Cargar la primera página con los nuevos filtros
        get().fetchPage('current');
    },

    /**
     * Motor de paginación por cursores.
     * Solicita a loadDataPaginated los datos ya filtrados en la BD.
     *
     * @param {'current'|'next'|'prev'} direction
     */
    fetchPage: async (direction = 'current') => {
        const state = get();
        if (state.isLoading) return;

        let targetPageIndex = state.currentPageIndex;

        if (direction === 'next' && state.hasMore) {
            targetPageIndex += 1;
        } else if (direction === 'prev') {
            targetPageIndex = Math.max(0, state.currentPageIndex - 1);
        }

        const targetCursor = state.cursorStack[targetPageIndex] ?? null;
        set({ isLoading: true });

        try {
            // Todos los filtros se pasan a la BD. El cliente no filtra nada.
            const { data, nextCursor } = await loadDataPaginated(STORES.MENU, {
                limit: 50,
                cursor: targetCursor,
                categoryId: state.filters.categoryId,
                outOfStockOnly: state.filters.outOfStockOnly,
                timeIndex: 'createdAt',
            });

            const newCursorStack = [...state.cursorStack];
            if (nextCursor) {
                newCursorStack[targetPageIndex + 1] = nextCursor;
            }

            set({
                menu: data,
                cursorStack: newCursorStack,
                currentPageIndex: targetPageIndex,
                hasMore: !!nextCursor,
                isLoading: false,
            });
        } catch (error) {
            Logger.error('Error en fetchPage:', error);
            set({ isLoading: false });
        }
    },

    /**
     * Carga inicial: categorías + primera página de productos.
     * Se llama una sola vez al montar PosPage.
     *
     * No llama fetchPage directamente para evitar colisión con el flag isLoading.
     * En su lugar, carga las categorías y luego delega a fetchPage respetando
     * el estado actual del store.
     */
    loadInitialProducts: async () => {
        // Si ya hay una carga en vuelo, no hacemos nada.
        // Esto previene la doble ejecución si el componente monta dos veces
        // en StrictMode o si se llama desde dos lugares simultáneamente.
        if (get().isLoading) return;

        set({ isLoading: true });
        try {
            const categories = await categoriesRepository.getActiveCategories();
            set({ categories: categories || [], isLoading: false });
            // fetchPage leerá isLoading: false y podrá ejecutarse
            get().fetchPage('current');
        } catch (error) {
            Logger.error('Error loading initial data:', error);
            set({ isLoading: false });
        }
    },

    /**
     * Comprueba si existen productos agotados en el catálogo completo
     * para decidir si mostrar la categoría virtual 'CAT_DYNAMIC_AGOTADOS'.
     *
     * Se ejecuta una única vez al cargar el catálogo. No hace full-scan:
     * aprovecha el índice de la tabla y detiene el cursor al primer resultado.
     *
     * @returns {Promise<boolean>}
     */
    checkHasOutOfStockProducts: async () => {
        try {
            // Usamos Dexie directamente para una consulta puntual.
            // No importamos db aquí para evitar acoplamiento circular;
            // delegamos al método que ya existe en loadDataPaginated.
            const { data } = await loadDataPaginated(STORES.MENU, {
                limit: 1,              // Solo necesitamos saber si existe al menos uno
                cursor: null,
                categoryId: null,
                outOfStockOnly: true,
                timeIndex: 'createdAt',
            });

            return data.length > 0;
        } catch (error) {
            Logger.error('Error chequeando productos agotados:', error);
            return false;
        }
    },

    deleteProduct: async (productId) => {
        if (!window.confirm('¿Estas seguro de mover este producto a la Papelera?')) return;

        set({ isLoading: true });
        try {
            const result = await recycleData(
                STORES.MENU,
                STORES.DELETED_MENU,
                productId,
                'Eliminado desde Catalogo'
            );

            if (result.success) {
                set((state) => ({
                    menu: state.menu.filter((product) => product.id !== productId),
                    isLoading: false,
                }));

                // Si la página quedó vacía, retrocedemos
                const { menu, currentPageIndex } = get();
                if (menu.length === 0 && currentPageIndex > 0) {
                    get().fetchPage('prev');
                }
            } else {
                alert(`Error al eliminar: ${result.message || 'No encontrado'}`);
                set({ isLoading: false });
            }
        } catch (error) {
            Logger.error('Error eliminando producto:', error);
            set({ isLoading: false });
        }
    },

    refreshCategories: async () => {
        const categories = await categoriesRepository.getActiveCategories();
        set({ categories: categories || [] });
    },

    deleteCategory: async (categoryId) => {
        if (!window.confirm('¿Seguro que deseas eliminar esta categoría?')) return;

        set({ isLoading: true });
        try {
            const result = await categoriesRepository.softDeleteCategory(categoryId);

            if (result.success) {
                set((state) => ({
                    categories: state.categories.filter((cat) => cat.id !== categoryId),
                    isLoading: false,
                }));

                // Si la categoría eliminada era el filtro activo, limpiamos
                if (get().filters.categoryId === categoryId) {
                    get().setFilters({ categoryId: null });
                }
            } else {
                alert(result.message);
                set({ isLoading: false });
            }
        } catch (error) {
            Logger.error('Error eliminando categoría:', error);
            set({ isLoading: false });
        }
    },
}));
