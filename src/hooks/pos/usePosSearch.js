import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from '../useDebounce';
import { useCatalogReconnect } from '../useCatalogReconnect';
import { usePosCatalogStore } from '../../store/usePosCatalogStore';
import { db, searchProductsInDB, STORES } from '../../services/database';
import { normalizeProductSearchValue } from '../../services/db/productSearchIndex';
import {
    EMPTY_PHARMACY_SEARCH_FILTERS,
    hasPharmacySearchFilters
} from '../../services/pharmacy/pharmacyProductSearch';
import { isPosCatalogEligible } from '../../services/products/productCatalogQueryService';
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

const EMPTY_PRODUCTS = [];

/** Mantiene el catálogo paginado y la consulta activa del POS. */
export function usePosSearch({ debounceMs = 300, pharmacySearchEnabled = false } = {}) {
    const menu = usePosCatalogStore((state) => state.items);
    const categories = usePosCatalogStore((state) => state.categories);
    const categoryId = usePosCatalogStore((state) => state.categoryId);
    const outOfStockOnly = usePosCatalogStore((state) => state.outOfStockOnly);
    const expiredOnly = usePosCatalogStore((state) => state.expiredOnly);
    const hasMore = usePosCatalogStore((state) => state.hasMore);
    const isLoadingInitial = usePosCatalogStore((state) => state.isLoadingInitial);
    const isLoadingNextPage = usePosCatalogStore((state) => state.isLoadingNextPage);
    const activeViewKey = usePosCatalogStore((state) => state.viewKey);
    const sessionIdentity = usePosCatalogStore((state) => state.sessionIdentity);
    const loadFirstPage = usePosCatalogStore((state) => state.loadFirstPage);
    const { reconnect, catalogLoading, catalogUnavailable } = useCatalogReconnect(loadFirstPage, activeViewKey);
    const catalogBlocked = catalogLoading || catalogUnavailable;
    const savedScrollPosition = usePosCatalogStore((state) => state.scrollPosition);
    const setFilters = usePosCatalogStore((state) => state.setFilters);
    const loadNextPage = usePosCatalogStore((state) => state.loadNextPage);
    const saveScrollPosition = usePosCatalogStore((state) => state.saveScrollPosition);
    const refreshData = usePosCatalogStore((state) => state.refreshCatalog);
    const checkHasOutOfStockProducts = usePosCatalogStore((state) => state.checkHasOutOfStockProducts);
    const checkHasExpiredProducts = usePosCatalogStore((state) => state.checkHasExpiredProducts);

    const [searchTerm, setSearchTerm] = useState('');
    const [pharmacyFilters, setPharmacyFilters] = useState(EMPTY_PHARMACY_SEARCH_FILTERS);
    const term = normalizeProductSearchValue(searchTerm);
    const debouncedTerm = useDebounce(term, debounceMs);
    const [searchResult, setSearchResult] = useState(null);
    const [hasOutOfStockItems, setHasOutOfStockItems] = useState(false);
    const [hasExpiredItems, setHasExpiredItems] = useState(false);
    const [assignedCategoryIds, setAssignedCategoryIds] = useState(null);

    // Catalog updates invalidate the scoped search, including product reconciliation.
    const hasSearchFilters = pharmacySearchEnabled && hasPharmacySearchFilters(pharmacyFilters);
    const isSearchActive = Boolean(term) || hasSearchFilters;
    const canSearch = isSearchActive && term === debouncedTerm && !catalogBlocked && !isLoadingInitial;
    const request = useMemo(() => canSearch ? {
        term, categoryId, expiredOnly, outOfStockOnly, menu, reconnect, sessionIdentity,
        pharmacySearchEnabled, pharmacyFilters
    } : null, [canSearch, term, categoryId, expiredOnly, outOfStockOnly, menu, reconnect, sessionIdentity, pharmacySearchEnabled, pharmacyFilters]);
    const currentSearch = searchResult?.request === request ? searchResult : null;

    useEffect(() => {
        if (!request) return;
        let active = true;
        const { term, categoryId = null, expiredOnly, outOfStockOnly } = request;

        const search = async () => {
            try {
                const items = await searchProductsInDB(term, 'active', categoryId, {
                    ...(pharmacySearchEnabled ? { pharmacySearch: true, pharmacyFilters } : {}),
                    eligible: (item) => {
                        if (!isPosCatalogEligible(item)) return false;
                        const itemCategoryId = item.categoryId ?? item.category_id ?? null;
                        if (categoryId !== null && itemCategoryId !== categoryId) return false;
                        return isOutOfStockForPosMenu(item) === outOfStockOnly;
                    },
                    filterBatch: async (items) => {
                        if (outOfStockOnly) return items;
                        const expiredIds = await resolveExpiredProductIdsForPosMenu(items, { db, STORES });
                        return items.filter((item) => (
                            (expiredIds.has(item.id) || isExpiredForPosMenu(item)) === expiredOnly
                        ));
                    }
                });
                if (active) setSearchResult({ request, items });
            } catch (error) {
                if (!active) return;
                Logger.error('Error buscando en POS:', error);
                setSearchResult({ request, failed: true });
            }
        };

        void search();
        return () => { active = false; };
    }, [request, pharmacySearchEnabled, pharmacyFilters]);

    useEffect(() => {
        if (catalogBlocked) return;
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
    }, [catalogBlocked, categories, menu]);

    const visibleCategories = useMemo(() => {
        if (!assignedCategoryIds) return categories;
        return categories.filter((category) => assignedCategoryIds.has(String(category?.id || '').trim()));
    }, [assignedCategoryIds, categories]);

    useEffect(() => {
        const selectedCategoryId = categoryId;
        if (catalogBlocked || !assignedCategoryIds || !selectedCategoryId || isDynamicPosCategory(selectedCategoryId)) return;

        if (!assignedCategoryIds.has(String(selectedCategoryId).trim())) {
            setFilters({ categoryId: null });
        }
    }, [catalogBlocked, categoryId, assignedCategoryIds, setFilters]);

    useEffect(() => {
        if (catalogBlocked) return;
        const initialize = async () => {
            const [hasAgotados, hasCaducados] = await Promise.all([
                checkHasOutOfStockProducts(),
                checkHasExpiredProducts()
            ]);
            setHasOutOfStockItems(hasAgotados);
            setHasExpiredItems(hasCaducados);
        };
        initialize();
    }, [catalogBlocked, checkHasOutOfStockProducts, checkHasExpiredProducts]);

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

    const menuVisual = catalogBlocked ? EMPTY_PRODUCTS : isSearchActive ? currentSearch?.items ?? EMPTY_PRODUCTS : menu;

    return {
        searchTerm,
        setSearchTerm,
        pharmacyFilters,
        setPharmacyFilters,
        isSearchActive,
        menuVisual,
        searchFailed: currentSearch?.failed === true,
        categories: visibleCategories,
        activeCategoryId,
        handleSelectCategory,
        hasOutOfStockItems,
        hasExpiredItems,
        hasMore: !term && !catalogBlocked && hasMore,
        isLoadingInitial: isLoadingInitial || catalogLoading || (!catalogBlocked && isSearchActive && !currentSearch),
        catalogUnavailable,
        isLoadingNextPage,
        loadNextPage,
        activeViewKey,
        savedScrollPosition,
        saveScrollPosition,
        refreshOutOfStock,
        refreshData
    };
}
