import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import {
  createEcommercePublishedStockAlertService,
  getEcommercePublishedStockAlertContextKey
} from '../../services/ecommerce/ecommercePublishedStockAlertService';

const initialState = Object.freeze({
  ecommercePublishedStockAlertSnapshot: null,
  ecommercePublishedStockAlertLoading: false,
  ecommercePublishedStockAlertError: null,
  ecommercePublishedStockAlertLoadedAt: null,
  ecommercePublishedStockAlertContextKey: null,
  ecommercePublishedStockAlertRequestEpoch: 0,
  hasLocalOperationalWarning: false
});

const canEvaluate = (state = {}) => evaluateEcommercePortalAccess({
  canAccess: state.canAccess,
  currentDeviceRole: state.currentDeviceRole
});

const hasOperationalWarning = (snapshot) => Boolean(
  snapshot?.portalStatus === 'published'
  && Number(snapshot?.outOfStockCount || 0) > 0
);

const countByStatus = (products, status) => (
  products.filter((product) => product.status === status).length
);

export const createEcommercePublishedStockAlertSlice = (set, get) => {
  const service = createEcommercePublishedStockAlertService({ getState: get });

  return {
    ...initialState,

    loadEcommercePublishedStockAlerts: async ({
      force = false,
      reason = 'manual',
      background = false,
      portal,
      publishedProducts
    } = {}) => {
      const state = get();
      if (!canEvaluate(state)) {
        service.clearEcommercePublishedStockAlerts();
        set((current) => ({
          ...initialState,
          ecommercePublishedStockAlertRequestEpoch:
            Number(current.ecommercePublishedStockAlertRequestEpoch || 0) + 1
        }));
        return { success: true, skipped: true, unauthorized: true };
      }

      const contextKey = getEcommercePublishedStockAlertContextKey(state);
      if (!contextKey) {
        service.clearEcommercePublishedStockAlerts();
        set((current) => ({
          ...initialState,
          ecommercePublishedStockAlertRequestEpoch:
            Number(current.ecommercePublishedStockAlertRequestEpoch || 0) + 1
        }));
        return { success: true, skipped: true, contextMissing: true };
      }

      const requestEpoch = Number(
        state.ecommercePublishedStockAlertRequestEpoch || 0
      ) + 1;
      const sameContext = state.ecommercePublishedStockAlertContextKey === contextKey;
      const previousSnapshot = sameContext
        ? state.ecommercePublishedStockAlertSnapshot
        : null;

      set({
        ecommercePublishedStockAlertSnapshot: previousSnapshot,
        ecommercePublishedStockAlertLoading: !background && !previousSnapshot,
        ecommercePublishedStockAlertError: null,
        ecommercePublishedStockAlertLoadedAt: sameContext
          ? state.ecommercePublishedStockAlertLoadedAt
          : null,
        ecommercePublishedStockAlertContextKey: contextKey,
        ecommercePublishedStockAlertRequestEpoch: requestEpoch,
        hasLocalOperationalWarning: sameContext
          ? Boolean(state.hasLocalOperationalWarning)
          : false
      });

      const result = await service.evaluatePublishedProductStockAlerts({
        force,
        reason,
        ...(portal !== undefined ? { portal } : {}),
        ...(publishedProducts !== undefined ? { publishedProducts } : {})
      });

      const current = get();
      const currentContextKey = getEcommercePublishedStockAlertContextKey(current);
      if (
        currentContextKey !== contextKey
        || current.ecommercePublishedStockAlertRequestEpoch !== requestEpoch
        || result?.stale === true
      ) {
        return { ...result, stale: true, committed: false };
      }

      if (result?.success !== true) {
        set({
          ecommercePublishedStockAlertLoading: false,
          ecommercePublishedStockAlertError:
            result?.message || 'No se pudo verificar el stock publicado.'
        });
        return result;
      }

      set({
        ecommercePublishedStockAlertSnapshot: result,
        ecommercePublishedStockAlertLoading: false,
        ecommercePublishedStockAlertError: null,
        ecommercePublishedStockAlertLoadedAt:
          result.evaluatedAt || new Date().toISOString(),
        ecommercePublishedStockAlertContextKey: contextKey,
        hasLocalOperationalWarning: hasOperationalWarning(result)
      });

      return { ...result, committed: true };
    },

    invalidateEcommercePublishedStockAlerts: ({ reason = 'manual' } = {}) => {
      const contextKey = getEcommercePublishedStockAlertContextKey(get());
      service.invalidateEcommercePublishedStockAlerts({ contextKey });
      set({
        ecommercePublishedStockAlertLoadedAt: null,
        ecommercePublishedStockAlertError: null
      });
      return { success: true, reason };
    },

    reconcileEcommercePublishedStockAlertProducts: ({
      portal,
      publishedProducts = []
    } = {}) => {
      const snapshot = get().ecommercePublishedStockAlertSnapshot;
      if (!snapshot?.products) return;

      const publishedById = new Map(
        publishedProducts
          .filter((product) => product?.isPublished === true && product?.localProductRef)
          .map((product) => [String(product.id), String(product.localProductRef)])
      );
      const products = snapshot.products.filter((result) => (
        publishedById.get(String(result.publishedProductId)) === String(result.localProductRef)
      ));
      const nextSnapshot = {
        ...snapshot,
        portalStatus: portal?.status || snapshot.portalStatus,
        publishedCount: products.length,
        outOfStockCount: countByStatus(products, 'out_of_stock'),
        unverifiedCount: countByStatus(products, 'unverified'),
        sourceMissingCount: countByStatus(products, 'source_missing'),
        inactiveSourceCount: countByStatus(products, 'inactive_source'),
        notTrackedCount: countByStatus(products, 'not_tracked'),
        products
      };

      set({
        ecommercePublishedStockAlertSnapshot: nextSnapshot,
        hasLocalOperationalWarning: hasOperationalWarning(nextSnapshot)
      });
    },

    clearEcommercePublishedStockAlerts: () => {
      service.clearEcommercePublishedStockAlerts();
      set((current) => ({
        ...initialState,
        ecommercePublishedStockAlertRequestEpoch:
          Number(current.ecommercePublishedStockAlertRequestEpoch || 0) + 1
      }));
    }
  };
};
