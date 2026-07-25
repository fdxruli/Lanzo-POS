// src/store/useProductStore.js
import { create } from 'zustand';
import {
    db,
    loadDataPaginated,
    STORES,
    softDeleteWithCascadeSafe
} from '../services/database';
import Logger from '../services/Logger';
import { categoriesRepository } from '../services/db/general';
import {
    classifyDatabaseError,
    isDatabaseRecoveryPending,
    reportStructuralDatabaseErrorOnce
} from '../services/db/databaseRecoveryState';
import { showConfirmModal, showMessageModal } from '../services/utils';
import {
    CAT_DYNAMIC_EXPIRED,
    CAT_DYNAMIC_OUT_OF_STOCK,
    checkHasExpiredProductsForPosMenu,
    isDynamicPosCategory
} from '../services/products/productMenuEligibility';

let broadcastChannel = null;
let visibilityListener = null;
let focusListener = null;
let blurListener = null;
let pageshowListener = null;
let productsSyncListener = null;
let listenersInitialized = false;
let lastInvalidationTime = 0;
let pendingInvalidation = false;

const BURST_DEDUPE_MS = 300;
const DEEP_SLEEP_THRESHOLD_MS = 60_000;
const AWAY_THRESHOLD_MS = 30_000;

const resetInvalidationState = (set) => {
    pendingInvalidation = false;
    set({ isInvalidating: false, isLoading: false });
};

const handleStructuralProductError = (error, set, context) => {
    const classification = classifyDatabaseError(error);
    if (!classification.structural) return false;

    resetInvalidationState(set);
    reportStructuralDatabaseErrorOnce(error, context);
    return true;
};

const recoveryBlocksProductReads = () => isDatabaseRecoveryPending();

function setupReactiveListeners(get, set) {
    if (listenersInitialized) return () => {};
    listenersInitialized = true;

    if (typeof window === 'undefined') return () => {};

    const invalidateFromEvent = (source, metadata = null) => {
        if (recoveryBlocksProductReads()) {
            resetInvalidationState(set);
            Logger.debug(`[ProductStore] ${source} omitido: recuperación local pendiente.`, metadata);
            return;
        }
        get().invalidateAndReset();
    };

    productsSyncListener = (event) => {
        invalidateFromEvent('lanzo:products-sync-updated', event.detail);
    };
    window.addEventListener('lanzo:products-sync-updated', productsSyncListener);

    try {
        broadcastChannel = new BroadcastChannel('product-store-invalidation');
        broadcastChannel.addEventListener('message', (event) => {
            if (event.data?.type === 'db-changed') {
                invalidateFromEvent('BroadcastChannel:db-changed', event.data);
            }
        });
    } catch (error) {
        Logger.warn('BroadcastChannel no soportado en este navegador:', error);
    }

    let lastAwayAt = 0;
    const markAsAway = () => {
        if (!lastAwayAt) lastAwayAt = Date.now();
    };

    const handleWakeUp = (source, force = false) => {
        if (recoveryBlocksProductReads()) {
            lastAwayAt = 0;
            resetInvalidationState(set);
            Logger.debug(`[ProductStore] Wake-up omitido (${source}): recuperación local pendiente.`);
            return;
        }

        const timeAway = lastAwayAt ? Date.now() - lastAwayAt : 0;
        lastAwayAt = 0;
        if (!force && timeAway > 0 && timeAway < AWAY_THRESHOLD_MS) {
            Logger.debug(`[ProductStore] Wake-up ignorado (${source}) - Fuera solo ${timeAway}ms`);
            return;
        }
        Logger.debug(`[ProductStore] Wake-up detectado desde: ${source}`);
        get().invalidateAndReset();
    };

    visibilityListener = () => {
        if (document.visibilityState === 'hidden') markAsAway();
        else if (document.visibilityState === 'visible') handleWakeUp('visibilitychange');
    };
    blurListener = markAsAway;
    focusListener = () => {
        if (document.visibilityState === 'visible') handleWakeUp('focus');
    };
    pageshowListener = (event) => {
        if (event.persisted) {
            handleWakeUp('pageshow(persisted)', true);
            return;
        }
        if (Date.now() - lastInvalidationTime > DEEP_SLEEP_THRESHOLD_MS) {
            handleWakeUp('pageshow(deep-sleep)', true);
        }
    };

    document.addEventListener('visibilitychange', visibilityListener);
    window.addEventListener('blur', blurListener);
    window.addEventListener('focus', focusListener);
    window.addEventListener('pageshow', pageshowListener);

    return () => {
        listenersInitialized = false;
        broadcastChannel?.close();
        broadcastChannel = null;
        if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
        if (blurListener) window.removeEventListener('blur', blurListener);
        if (focusListener) window.removeEventListener('focus', focusListener);
        if (pageshowListener) window.removeEventListener('pageshow', pageshowListener);
        if (productsSyncListener) window.removeEventListener('lanzo:products-sync-updated', productsSyncListener);
        visibilityListener = null;
        blurListener = null;
        focusListener = null;
        pageshowListener = null;
        productsSyncListener = null;
    };
}

export function broadcastDBChange(metadata = {}) {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

    const payload = { type: 'db-changed', timestamp: Date.now(), metadata };
    try {
        if (broadcastChannel) {
            broadcastChannel.postMessage(payload);
            return;
        }
        const tempChannel = new BroadcastChannel('product-store-invalidation');
        tempChannel.postMessage(payload);
        setTimeout(() => tempChannel.close(), 0);
    } catch (error) {
        Logger.warn('[ProductStore] No se pudo emitir broadcast de cambio:', error);
    }
}

export const useProductStore = create((set, get) => ({
    menu: [],
    categories: [],
    isLoading: false,
    isInvalidating: false,
    cursorStack: [null],
    currentPageIndex: 0,
    hasMore: true,
    filters: {
        categoryId: null,
        outOfStockOnly: false,
        expiredOnly: false,
        status: 'active',
    },

    initialize: () => setupReactiveListeners(get, set),

    invalidateAndReset: () => {
        const state = get();
        const now = Date.now();

        if (recoveryBlocksProductReads()) {
            resetInvalidationState(set);
            Logger.debug('[ProductStore] Invalidation omitida: recuperación local pendiente.');
            return Promise.resolve(false);
        }

        if (now - lastInvalidationTime < BURST_DEDUPE_MS) {
            Logger.debug('[ProductStore] Invalidation burst deduplicated');
            return Promise.resolve(false);
        }

        if (state.isInvalidating) {
            pendingInvalidation = true;
            Logger.debug('[ProductStore] Invalidation in progress – scheduling retry');
            return Promise.resolve(false);
        }

        lastInvalidationTime = now;
        set({
            isInvalidating: true,
            menu: [],
            cursorStack: [null],
            currentPageIndex: 0,
            hasMore: true,
        });
        Logger.info('[ProductStore] Executing hard invalidation + reset');

        let structuralFailure = false;
        const operation = get()
            .refreshCategories()
            .then(() => {
                if (recoveryBlocksProductReads()) return false;
                const { categories, filters } = get();
                const hasDeletedSelectedCategory = filters.categoryId
                    && !isDynamicPosCategory(filters.categoryId)
                    && !categories.some((category) => category.id === filters.categoryId);

                if (hasDeletedSelectedCategory) {
                    set({
                        filters: {
                            ...filters,
                            categoryId: null,
                            outOfStockOnly: false,
                            expiredOnly: false,
                        },
                        cursorStack: [null],
                        currentPageIndex: 0,
                        hasMore: true,
                    });
                }
                return get().fetchPage('current');
            })
            .catch((error) => {
                structuralFailure = handleStructuralProductError(
                    error,
                    set,
                    'product-store-invalidation'
                );
                if (!structuralFailure) {
                    Logger.error('[ProductStore] Error during invalidation re-fetch:', error);
                }
                return false;
            })
            .finally(() => {
                if (structuralFailure || recoveryBlocksProductReads()) {
                    resetInvalidationState(set);
                    return;
                }

                set({ isInvalidating: false });
                Logger.debug('[ProductStore] Invalidation complete');
                if (pendingInvalidation) {
                    pendingInvalidation = false;
                    lastInvalidationTime = 0;
                    Logger.info('[ProductStore] Executing pending invalidation after mutex release');
                    get().invalidateAndReset();
                }
            });

        return operation;
    },

    setFilters: (newFilters = {}) => {
        const { searchTerm, ...safeFilters } = newFilters;
        void searchTerm;
        if (Object.keys(safeFilters).length === 0) return;

        const currentFilters = get().filters;
        let resolvedFilters = { ...currentFilters, ...safeFilters };
        if (safeFilters.categoryId === CAT_DYNAMIC_OUT_OF_STOCK) {
            resolvedFilters = {
                ...resolvedFilters,
                categoryId: null,
                outOfStockOnly: true,
                expiredOnly: false,
            };
        } else if (safeFilters.categoryId === CAT_DYNAMIC_EXPIRED) {
            resolvedFilters = {
                ...resolvedFilters,
                categoryId: null,
                outOfStockOnly: false,
                expiredOnly: true,
            };
        } else if ('categoryId' in safeFilters) {
            resolvedFilters = {
                ...resolvedFilters,
                outOfStockOnly: false,
                expiredOnly: false,
            };
        }

        const filtersChanged = resolvedFilters.categoryId !== currentFilters.categoryId
            || resolvedFilters.outOfStockOnly !== currentFilters.outOfStockOnly
            || resolvedFilters.expiredOnly !== currentFilters.expiredOnly
            || resolvedFilters.status !== currentFilters.status;
        if (!filtersChanged) return;

        set({
            filters: resolvedFilters,
            cursorStack: [null],
            currentPageIndex: 0,
            menu: [],
            hasMore: true,
        });
        get().fetchPage('current');
    },

    fetchPage: async (direction = 'current') => {
        const state = get();
        if (state.isLoading || recoveryBlocksProductReads()) return false;

        let targetPageIndex = state.currentPageIndex;
        if (direction === 'next' && state.hasMore) targetPageIndex += 1;
        else if (direction === 'prev') targetPageIndex = Math.max(0, state.currentPageIndex - 1);

        const targetCursor = state.cursorStack[targetPageIndex] ?? null;
        set({ isLoading: true });
        try {
            const { data, nextCursor } = await loadDataPaginated(STORES.MENU, {
                limit: 50,
                cursor: targetCursor,
                categoryId: state.filters.categoryId,
                outOfStockOnly: state.filters.outOfStockOnly,
                expiredOnly: state.filters.expiredOnly,
                status: state.filters.status,
                timeIndex: 'createdAt',
            });
            const newCursorStack = [...state.cursorStack];
            if (nextCursor) newCursorStack[targetPageIndex + 1] = nextCursor;
            set({
                menu: data,
                cursorStack: newCursorStack,
                currentPageIndex: targetPageIndex,
                hasMore: Boolean(nextCursor),
                isLoading: false,
            });
            return true;
        } catch (error) {
            if (!handleStructuralProductError(error, set, 'product-store-fetch-page')) {
                Logger.error('Error en fetchPage:', error);
                set({ isLoading: false });
            }
            return false;
        }
    },

    loadInitialProducts: async () => {
        if (get().isLoading || recoveryBlocksProductReads()) return false;
        set({ isLoading: true });
        try {
            const categories = await categoriesRepository.getActiveCategories();
            const sortedCategories = (categories || [])
                .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            set({ categories: sortedCategories, isLoading: false });
            await get().fetchPage('current');
            return true;
        } catch (error) {
            if (!handleStructuralProductError(error, set, 'product-store-load-initial')) {
                Logger.error('Error loading initial data:', error);
                set({ isLoading: false });
            }
            return false;
        }
    },

    checkHasOutOfStockProducts: async () => {
        if (recoveryBlocksProductReads()) return false;
        try {
            const { data } = await loadDataPaginated(STORES.MENU, {
                limit: 1,
                cursor: null,
                categoryId: null,
                outOfStockOnly: true,
                timeIndex: 'createdAt',
            });
            return data.length > 0;
        } catch (error) {
            if (!handleStructuralProductError(error, set, 'product-store-out-of-stock')) {
                Logger.error('Error chequeando productos agotados:', error);
            }
            return false;
        }
    },

    checkHasExpiredProducts: async () => {
        if (recoveryBlocksProductReads()) return false;
        try {
            return await checkHasExpiredProductsForPosMenu({ db, STORES });
        } catch (error) {
            if (!handleStructuralProductError(error, set, 'product-store-expired')) {
                Logger.error('Error chequeando productos caducados:', error);
            }
            return false;
        }
    },

    deleteProduct: async (productId) => {
        if (!(await showConfirmModal('¿Estas seguro de mover este producto a la Papelera?', {
            title: 'Mover a papelera',
            confirmButtonText: 'Si, mover',
            cancelButtonText: 'Cancelar'
        }))) return;

        set({ isLoading: true });
        try {
            const result = await softDeleteWithCascadeSafe(
                STORES.MENU,
                STORES.DELETED_MENU,
                productId,
                { reason: 'Eliminado desde Catálogo' }
            );
            if (result.success) {
                set((state) => ({
                    menu: state.menu.filter((product) => product.id !== productId),
                    isLoading: false,
                }));
                broadcastDBChange({ action: 'product-deleted', productId, timestamp: Date.now() });
                const { menu, currentPageIndex } = get();
                if (menu.length === 0 && currentPageIndex > 0) get().fetchPage('prev');
            } else {
                showMessageModal(`Error al eliminar: ${result.message || 'No encontrado'}`, null, { type: 'error' });
                set({ isLoading: false });
            }
        } catch (error) {
            if (!handleStructuralProductError(error, set, 'product-store-delete')) {
                Logger.error('Error eliminando producto:', error);
                set({ isLoading: false });
            }
        }
    },

    refreshCategories: async () => {
        if (recoveryBlocksProductReads()) return false;
        const categories = await categoriesRepository.getActiveCategories();
        const sortedCategories = (categories || [])
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        set({ categories: sortedCategories });
        return true;
    },
}));

if (typeof window !== 'undefined') {
    useProductStore.getState().initialize();
}
