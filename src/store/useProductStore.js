// src/store/useProductStore.js
import { create } from 'zustand';
import {
    loadDataPaginated,
    STORES,
    softDeleteWithCascadeSafe
} from '../services/database';
import Logger from '../services/Logger';
import { categoriesRepository } from '../services/db/general';

// Variables privadas del módulo para gestionar listeners
let broadcastChannel = null;
let visibilityListener = null;
let focusListener = null;
let pageshowListener = null;
let listenersInitialized = false;

// De-duplicación: colapsa la ráfaga de eventos simultáneos (visibilitychange +
// focus + pageshow) en una sola llamada. 300 ms es suficiente para absorber la
// ráfaga sin bloquear actualizaciones legítimas tras horas de suspensión.
let lastInvalidationTime = 0;
const BURST_DEDUPE_MS = 300;

// Bandera de reintento: si llega una invalidación mientras ya hay una en vuelo,
// en lugar de descartarla silenciosamente, se programa exactamente un reintento.
let pendingInvalidation = false;

/**
 * Establece los listeners globales para invalidación reactiva.
 * Se ejecuta una sola vez por sesión.
 *
 * @param {Function} get - Función getter del store de Zustand
 * @returns {Function} Función cleanup para desuscribirse
 */
function setupReactiveListeners(get) {
    if (listenersInitialized) return () => { };

    listenersInitialized = true;

    if (typeof window === 'undefined') return () => { };

    // ─────────────────────────────────────────────────────────────────
    // 1. BROADCAST CHANNEL: Sincronización cross-tab
    // ─────────────────────────────────────────────────────────────────
    try {
        broadcastChannel = new BroadcastChannel('product-store-invalidation');
        broadcastChannel.addEventListener('message', (event) => {
            if (event.data?.type === 'db-changed') {
                Logger.debug('[ProductStore] BroadcastChannel: db-changed detected', event.data);
                get().invalidateAndReset();
            }
        });
    } catch (error) {
        Logger.warn('BroadcastChannel no soportado en este navegador:', error);
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. VISIBILITY, FOCUS y PAGESHOW: Detección robusta de primer plano
    //
    // Se usan tres eventos complementarios:
    // - visibilitychange → cubre cambios de pestaña y bloqueo de pantalla
    // - focus           → complementa en desktop cuando visibilitychange
    //                     no es suficiente (p. ej. cambio de ventana OS)
    // - pageshow        → el más confiable para bfcache y vuelta de sleep;
    //                     event.persisted === true indica restauración de caché
    // ─────────────────────────────────────────────────────────────────
    const handleWakeUp = (source) => {
        Logger.debug(`[ProductStore] Wake-up detectado desde: ${source}`);
        get().invalidateAndReset();
    };

    visibilityListener = () => {
        if (document.visibilityState === 'visible') {
            handleWakeUp('visibilitychange');
        }
    };

    focusListener = () => {
        handleWakeUp('focus');
    };

    pageshowListener = (event) => {
        // event.persisted === true: la página fue restaurada de bfcache o sleep
        if (event.persisted) {
            handleWakeUp('pageshow(persisted)');
        }
    };

    document.addEventListener('visibilitychange', visibilityListener);
    window.addEventListener('focus', focusListener);
    window.addEventListener('pageshow', pageshowListener);

    // ─────────────────────────────────────────────────────────────────
    // CLEANUP: Retornar función para desuscribirse
    // ─────────────────────────────────────────────────────────────────
    return () => {
        listenersInitialized = false;
        if (broadcastChannel) {
            broadcastChannel.close();
            broadcastChannel = null;
        }
        if (visibilityListener) {
            document.removeEventListener('visibilitychange', visibilityListener);
            visibilityListener = null;
        }
        if (focusListener) {
            window.removeEventListener('focus', focusListener);
            focusListener = null;
        }
        if (pageshowListener) {
            window.removeEventListener('pageshow', pageshowListener);
            pageshowListener = null;
        }
    };
}

/**
 * Notifica a todas las pestañas que la BD ha cambiado.
 * Se llama desde servicios que mutarán la BD (softDelete, create, etc.)
 *
 * @param {object} metadata - Información opcional sobre qué cambió
 */
export function broadcastDBChange(metadata = {}) {
    if (broadcastChannel && broadcastChannel.readyState === 'connected') {
        broadcastChannel.postMessage({
            type: 'db-changed',
            timestamp: Date.now(),
            metadata,
        });
    }
}

export const useProductStore = create((set, get) => ({
    menu: [],
    categories: [],
    isLoading: false,
    isInvalidating: false,

    // ── Motor de cursores ──────────────────────────────────────────
    cursorStack: [null],
    currentPageIndex: 0,
    hasMore: true,

    filters: {
        categoryId: null,
        outOfStockOnly: false,
        status: 'active',
    },

    initialize: () => {
        Logger.debug('[ProductStore] Initializing reactive listeners');
        return setupReactiveListeners(get);
    },

    invalidateAndReset: () => {
        const state = get();
        const now = Date.now();

        // PASO 1 – De-duplicación de ráfaga:
        // Dos eventos que lleguen dentro de BURST_DEDUPE_MS se colapsan en uno.
        // NO bloqueamos si la última invalidación fue hace > BURST_DEDUPE_MS
        // (que es el caso legítimo tras horas de suspensión).
        if (now - lastInvalidationTime < BURST_DEDUPE_MS) {
            Logger.debug('[ProductStore] Invalidation burst deduplicated');
            return;
        }

        // PASO 2 – Mutex con reintento:
        // Si ya hay una invalidación en vuelo, programamos un reintento
        // en lugar de descartar silenciosamente la petición.
        if (state.isInvalidating) {
            Logger.debug('[ProductStore] Invalidation in progress – scheduling retry');
            pendingInvalidation = true;
            return;
        }

        lastInvalidationTime = now;
        Logger.info('[ProductStore] Executing hard invalidation + reset');

        // 1. Bloquear nuevas llamadas (mutex)
        set({ isInvalidating: true });

        // 2. Purgar caché en memoria
        set({
            menu: [],
            cursorStack: [null],
            currentPageIndex: 0,
            hasMore: true,
        });

        // 3. Rehidratar desde IndexedDB y liberar el bloqueo
        get()
            .fetchPage('current')
            .catch((error) => {
                Logger.error('[ProductStore] Error during invalidation re-fetch:', error);
            })
            .finally(() => {
                set({ isInvalidating: false });
                Logger.debug('[ProductStore] Invalidation complete');

                // Si llegó una petición mientras estábamos en vuelo, ejecutarla ahora.
                if (pendingInvalidation) {
                    pendingInvalidation = false;
                    Logger.info('[ProductStore] Executing pending invalidation after mutex release');
                    // Resetear el tiempo para que no quede bloqueado por BURST_DEDUPE_MS
                    lastInvalidationTime = 0;
                    get().invalidateAndReset();
                }
            });
    },

    /**
     * Actualiza los filtros activos y reinicia la paginación desde el inicio.
     */
    setFilters: (newFilters = {}) => {
        const { searchTerm, ...safeFilters } = newFilters;
        void searchTerm;
        if (Object.keys(safeFilters).length === 0) return;

        const currentFilters = get().filters;
        let resolvedFilters = { ...currentFilters, ...safeFilters };

        if (safeFilters.categoryId === 'CAT_DYNAMIC_AGOTADOS') {
            resolvedFilters = {
                ...resolvedFilters,
                categoryId: null,
                outOfStockOnly: true,
            };
        } else if ('categoryId' in safeFilters) {
            resolvedFilters = {
                ...resolvedFilters,
                outOfStockOnly: false,
            };
        }

        const filtersChanged =
            resolvedFilters.categoryId !== currentFilters.categoryId ||
            resolvedFilters.outOfStockOnly !== currentFilters.outOfStockOnly ||
            resolvedFilters.status !== currentFilters.status;

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

    /**
     * Motor de paginación por cursores.
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
            const { data, nextCursor } = await loadDataPaginated(STORES.MENU, {
                limit: 50,
                cursor: targetCursor,
                categoryId: state.filters.categoryId,
                outOfStockOnly: state.filters.outOfStockOnly,
                status: state.filters.status,
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
     */
    loadInitialProducts: async () => {
        if (get().isLoading) return;

        set({ isLoading: true });
        try {
            const categories = await categoriesRepository.getActiveCategories();
            const sortedCategories = (categories || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

            set({ categories: sortedCategories, isLoading: false });
            get().fetchPage('current');
        } catch (error) {
            Logger.error('Error loading initial data:', error);
            set({ isLoading: false });
        }
    },

    /**
     * Comprueba si existen productos agotados.
     */
    checkHasOutOfStockProducts: async () => {
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
            Logger.error('Error chequeando productos agotados:', error);
            return false;
        }
    },

    deleteProduct: async (productId) => {
        if (!window.confirm('¿Estas seguro de mover este producto a la Papelera?')) return;

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

                broadcastDBChange({
                    action: 'product-deleted',
                    productId,
                    timestamp: Date.now(),
                });

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
        const sortedCategories = (categories || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        set({ categories: sortedCategories });
    },
}));