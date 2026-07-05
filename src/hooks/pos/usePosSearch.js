// src/hooks/usePosSearch.js
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from '../useDebounce';
import { useProductStore } from '../../store/useProductStore';
import { db, searchProductsInDB, STORES } from '../../services/database';
import {
    CAT_DYNAMIC_EXPIRED,
    CAT_DYNAMIC_OUT_OF_STOCK,
    getAssignedCategoryIdsForPosMenu,
    isExpiredForPosMenu,
    isDynamicPosCategory,
    isOutOfStockForPosMenu,
    resolveExpiredProductIdsForPosMenu
} from '../../services/products/productMenuEligibility';
import Logger from '../../services/Logger';

/**
 * Hook para manejar la busqueda de productos en el POS.
 * Encapsula el debounce, el estado visual (menuVisual) y la sincronizacion de busqueda.
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
 *   hasExpiredItems: boolean,
 *   refreshOutOfStock: () => Promise<void>
 * }}
 */
export function usePosSearch({ debounceMs = 300 } = {}) {
    const menu = useProductStore((state) => state.menu);
    const categories = useProductStore((state) => state.categories);
    const activeFilters = useProductStore((state) => state.filters);
    const setFilters = useProductStore((state) => state.setFilters);
    const refreshData = useProductStore((state) => state.loadInitialProducts);
    const checkHasOutOfStockProducts = useProductStore((state) => state.checkHasOutOfStockProducts);
    const checkHasExpiredProducts = useProductStore((state) => state.checkHasExpiredProducts);

    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, debounceMs);
    const [menuVisual, setMenuVisual] = useState([]);
    const [hasOutOfStockItems, setHasOutOfStockItems] = useState(false);
    const [hasExpiredItems, setHasExpiredItems] = useState(false);
    const [assignedCategoryIds, setAssignedCategoryIds] = useState(null);

    const applyActiveFilters = useCallback(async (items = []) => {
        const expiredProductIds = await resolveExpiredProductIdsForPosMenu(items, { db, STORES });

        return items.filter((item) => {
            if (item?.isActive === false) return false;
            if (item?.productType === 'ingredient') return false;

            const matchesCategory =
                (activeFilters.categoryId === null || activeFilters.categoryId === undefined) ||
                item.categoryId === activeFilters.categoryId;

            const isOutOfStock = isOutOfStockForPosMenu(item);
            const isExpired = expiredProductIds.has(item.id) || isExpiredForPosMenu(item);

            if (activeFilters.outOfStockOnly) {
                return matchesCategory && isOutOfStock;
            }

            if (activeFilters.expiredOnly) {
                return matchesCategory && !isOutOfStock && isExpired;
            }

            return matchesCategory && !isOutOfStock && !isExpired;
        });
    }, [activeFilters.categoryId, activeFilters.outOfStockOnly, activeFilters.expiredOnly]);

    useEffect(() => {
        let isActive = true;

        const syncMenuVisual = async () => {
            const term = debouncedSearchTerm.trim();

            if (!term) {
                const filteredMenu = await applyActiveFilters(menu);
                if (isActive) {
                    setMenuVisual(filteredMenu);
                }
                return;
            }

            try {
                const results = await searchProductsInDB(term);
                const filteredResults = await applyActiveFilters(results);
                if (isActive) {
                    setMenuVisual(filteredResults);
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

    useEffect(() => {
        let isActive = true;

        const syncAssignedCategories = async () => {
            if (!Array.isArray(categories) || categories.length === 0) {
                setAssignedCategoryIds(new Set());
                return;
            }

            try {
                const products = await db.table(STORES.MENU).toArray();
                if (isActive) {
                    setAssignedCategoryIds(getAssignedCategoryIdsForPosMenu(products));
                }
            } catch (error) {
                Logger.error('Error resolviendo categorias con productos en POS:', error);
                if (isActive) {
                    setAssignedCategoryIds(getAssignedCategoryIdsForPosMenu(menu));
                }
            }
        };

        syncAssignedCategories();

        return () => {
            isActive = false;
        };
    }, [categories, menu]);

    const visibleCategories = useMemo(() => {
        if (!assignedCategoryIds) return categories;
        return categories.filter((category) => assignedCategoryIds.has(String(category?.id || '').trim()));
    }, [assignedCategoryIds, categories]);

    useEffect(() => {
        const selectedCategoryId = activeFilters.categoryId;
        if (!assignedCategoryIds || !selectedCategoryId || isDynamicPosCategory(selectedCategoryId)) return;

        if (!assignedCategoryIds.has(String(selectedCategoryId).trim())) {
            setFilters({ categoryId: null });
        }
    }, [activeFilters.categoryId, assignedCategoryIds, setFilters]);

    useEffect(() => {
        const initialize = async () => {
            const [hasAgotados, hasCaducados] = await Promise.all([
                checkHasOutOfStockProducts(),
                checkHasExpiredProducts()
            ]);
            setHasOutOfStockItems(hasAgotados);
            setHasExpiredItems(hasCaducados);
        };
        initialize();
    }, [checkHasOutOfStockProducts, checkHasExpiredProducts]);

    const handleSelectCategory = useCallback((categoryId) => {
        setFilters({ categoryId });
    }, [setFilters]);

    const activeCategoryId = activeFilters.outOfStockOnly
        ? CAT_DYNAMIC_OUT_OF_STOCK
        : activeFilters.expiredOnly
            ? CAT_DYNAMIC_EXPIRED
            : activeFilters.categoryId;

    const refreshOutOfStock = useCallback(async () => {
        await refreshData();
        const [hasAgotados, hasCaducados] = await Promise.all([
            checkHasOutOfStockProducts(),
            checkHasExpiredProducts()
        ]);
        setHasOutOfStockItems(hasAgotados);
        setHasExpiredItems(hasCaducados);
    }, [refreshData, checkHasOutOfStockProducts, checkHasExpiredProducts]);

    return {
        searchTerm,
        setSearchTerm,
        menuVisual,
        categories: visibleCategories,
        activeCategoryId,
        handleSelectCategory,
        hasOutOfStockItems,
        hasExpiredItems,
        refreshOutOfStock,
        refreshData
    };
}
