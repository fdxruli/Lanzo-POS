// src/hooks/usePosSearch.js
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from '../useDebounce';
import { useProductStore } from '../../store/useProductStore';
import { searchProductsInDB } from '../../services/database';
import { getAvailableStock } from '../../services/db/utils';
import Logger from '../../services/Logger';

/**
 * Hook para manejar la búsqueda de productos en el POS.
 * Encapsula el debounce, el estado visual (menuVisual) y la sincronización de búsqueda.
 * 
 * @param {Object} options - Opciones del hook
 * @param {number} options.debounceMs - Milisegundos de debounce (default: 300)
 * @returns {{
 *   searchTerm: string,
 *   setSearchTerm: (term: string) => void,
 *   menuVisual: Array,
 *   categories: Array,
 *   activeCategoryId: string|null,
 *   handleSelectCategory: (categoryId: string|null) => void,
 *   hasOutOfStockItems: boolean,
 *   refreshOutOfStock: () => Promise<void>
 * }}
 */
export function usePosSearch({ debounceMs = 300 } = {}) {
    // ── Store de productos ─────────────────────────────────────────
    const menu = useProductStore((state) => state.menu);
    const categories = useProductStore((state) => state.categories);
    const activeFilters = useProductStore((state) => state.filters);
    const setFilters = useProductStore((state) => state.setFilters);
    const refreshData = useProductStore((state) => state.loadInitialProducts);
    const checkHasOutOfStockProducts = useProductStore((state) => state.checkHasOutOfStockProducts);

    // ── Estado local ───────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, debounceMs);
    const [menuVisual, setMenuVisual] = useState([]);
    const [hasOutOfStockItems, setHasOutOfStockItems] = useState(false);

    // ── Filtro de productos ────────────────────────────────────────
    const applyActiveFilters = useCallback((items = []) =>
        items.filter((item) => {
            // 1. Descartar inactivos
            if (item?.isActive === false) return false;

            // 2. Descartar ingredientes
            if (item?.productType === 'ingredient') return false;

            const matchesCategory =
                (activeFilters.categoryId === null || activeFilters.categoryId === undefined) ||
                item.categoryId === activeFilters.categoryId;

            // Determinar si el producto está realmente agotado
            const isOutOfStock =
                (item.trackStock || item.batchManagement?.enabled) && getAvailableStock(item) <= 0;

            // Lógica excluyente:
            if (activeFilters.outOfStockOnly) {
                return matchesCategory && isOutOfStock;
            } else {
                return matchesCategory && !isOutOfStock;
            }
        }), [activeFilters.categoryId, activeFilters.outOfStockOnly]);

    // ── Sincronización del menú visual ─────────────────────────────
    useEffect(() => {
        let isActive = true;

        const syncMenuVisual = async () => {
            const term = debouncedSearchTerm.trim();

            if (!term) {
                if (isActive) {
                    setMenuVisual(applyActiveFilters(menu));
                }
                return;
            }

            try {
                const results = await searchProductsInDB(term);
                if (isActive) {
                    setMenuVisual(applyActiveFilters(results));
                }
            } catch (error) {
                Logger.error('Error buscando en POS:', error);
                if (isActive) {
                    setMenuVisual([]);
                }
            }
        };

        syncMenuVisual();

        return () => {
            isActive = false;
        };
    }, [
        debouncedSearchTerm,
        menu,
        applyActiveFilters
    ]);

    // ── Carga inicial de productos agotados ────────────────────────
    useEffect(() => {
        const initialize = async () => {
            const hasAgotados = await checkHasOutOfStockProducts();
            setHasOutOfStockItems(hasAgotados);
        };
        initialize();
    }, [checkHasOutOfStockProducts]);

    // ── Handlers ───────────────────────────────────────────────────
    const handleSelectCategory = useCallback((categoryId) => {
        setFilters({ categoryId });
    }, [setFilters]);

    // Derivamos el categoryId activo para que ProductMenu pueda marcar
    // visualmente la categoría seleccionada en el sidebar.
    const activeCategoryId = activeFilters.outOfStockOnly
        ? 'CAT_DYNAMIC_AGOTADOS'
        : activeFilters.categoryId;

    // ── Refresh de agotados (para llamar después de una venta) ─────
    const refreshOutOfStock = useCallback(async () => {
        await refreshData();
        const hasAgotados = await checkHasOutOfStockProducts();
        setHasOutOfStockItems(hasAgotados);
    }, [refreshData, checkHasOutOfStockProducts]);

    return {
        searchTerm,
        setSearchTerm,
        menuVisual,
        categories,
        activeCategoryId,
        handleSelectCategory,
        hasOutOfStockItems,
        refreshOutOfStock,
        // Exponemos refreshData para que el padre pueda recargar todo si es necesario
        refreshData
    };
}
