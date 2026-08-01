// src/hooks/usePosSearch.js
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from '../useDebounce';
import { usePosCatalogStore } from '../../store/usePosCatalogStore';
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
    const menu = usePosCatalogStore((state) => state.items);
    const categories = usePosCatalogStore((state) => state.categories);
    const categoryId = usePosCatalogStore((state) => state.categoryId);
    const outOfStockOnly = usePosCatalogStore((state) => state.outOfStockOnly);
    const expiredOnly = usePosCatalogStore((state) => state.expiredOnly);
    const hasMore = usePosCatalogStore((state) => state.hasMore);
    const isLoadingInitial = usePosCatalogStore((state) => state.isLoadingInitial);
    const isLoadingNextPage = usePosCatalogStore((state) => state.isLoadingNextPage);
    const activeViewKey = usePosCatalogStore((state) => state.viewKey);
    const savedScrollPosition = usePosCatalogStore((state) => state.scrollPosition);
    const setFilters = usePosCatalogStore((state) => state.setFilters);
    const loadNextPage = usePosCatalogStore((state) => state.loadNextPage);
    const saveScrollPosition = usePosCatalogStore((state) => state.saveScrollPosition);
    const refreshData = usePosCatalogStore((state) => state.refreshCatalog);
    const checkHasOutOfStockProducts = usePosCatalogStore((state) => state.checkHasOutOfStockProducts);
    const checkHasExpiredProducts = usePosCatalogStore((state) => state.checkHasExpiredProducts);

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
                (categoryId === null || categoryId === undefined) ||
                item.categoryId === categoryId;

            const isOutOfStock = isOutOfStockForPosMenu(item);
            const isExpired = expiredProductIds.has(item.id) || isExpiredForPosMenu(item);

            if (outOfStockOnly) {
                return matchesCategory && isOutOfStock;
            }

            if (expiredOnly) {
                return matchesCategory && !isOutOfStock && isExpired;
            }

            return matchesCategory && !isOutOfStock && !isExpired;
        });
    }, [categoryId, outOfStockOnly, expiredOnly]);

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
        const selectedCategoryId = categoryId;
        if (!assignedCategoryIds || !selectedCategoryId || isDynamicPosCategory(selectedCategoryId)) return;

        if (!assignedCategoryIds.has(String(selectedCategoryId).trim())) {
            setFilters({ categoryId: null });
        }
    }, [categoryId, assignedCategoryIds, setFilters]);

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

    const activeCategoryId = outOfStockOnly
        ? CAT_DYNAMIC_OUT_OF_STOCK
        : expiredOnly
            ? CAT_DYNAMIC_EXPIRED
            : categoryId;

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
        hasMore,
        isLoadingInitial,
        isLoadingNextPage,
        loadNextPage,
        activeViewKey,
        savedScrollPosition,
        saveScrollPosition,
        refreshOutOfStock,
        refreshData
    };
}
