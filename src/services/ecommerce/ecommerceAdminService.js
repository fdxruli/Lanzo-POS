import { useAppStore } from '../../store/useAppStore';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { supabaseClient } from '../supabase';

const SAFE_ERROR_MESSAGES = {
  ECOMMERCE_ADMIN_ACCESS_DENIED: 'No tienes permiso para administrar el portal online.',
  ECOMMERCE_STAFF_SESSION_REQUIRED: 'Inicia sesion como personal para administrar el portal online.',
  ECOMMERCE_STAFF_SESSION_INVALID: 'Tu sesion de personal no es valida. Inicia sesion nuevamente.',
  ECOMMERCE_STAFF_PERMISSION_DENIED: 'No tienes permiso para administrar el portal online.',
  ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO: 'La sincronizacion automatica requiere Lanzo Nube.',
  ECOMMERCE_CATALOG_SYNC_BATCH_TOO_LARGE: 'La sincronizacion incluye demasiados productos en un solo lote.',
  ECOMMERCE_CATALOG_SYNC_DUPLICATE_REF: 'La sincronizacion contiene productos duplicados.',
  ECOMMERCE_CATALOG_REVISION_CHANGED: 'El catalogo cambio durante la sincronizacion. Se reintentara con la revision vigente.'
};

const SAFE_CONTEXT_MESSAGES = new Set([
  'La conexion con Supabase no esta configurada.',
  'Necesitas conexion a internet para configurar el portal online.',
  'No se pudo confirmar el acceso para administrar el portal. Revalida la licencia o inicia sesion nuevamente.'
]);

const normalizeFailure = (data, fallback) => {
  const code = data?.code || data?.error?.code || 'ECOMMERCE_ADMIN_ERROR';

  return {
    ...(data || {}),
    success: false,
    code,
    message: SAFE_ERROR_MESSAGES[code]
      || data?.message
      || data?.error?.message
      || fallback
  };
};

export const createEcommerceAdminService = ({
  rpc = (name, payload) => supabaseClient?.rpc(name, payload),
  isConfigured = () => Boolean(supabaseClient),
  getLicenseDetails = () => useAppStore.getState()?.licenseDetails || {},
  buildAuthContext = buildPosSyncAuthContext,
  isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
} = {}) => {
  const getContext = async () => {
    if (!isConfigured()) {
      throw new Error('La conexion con Supabase no esta configurada.');
    }

    if (!isOnline()) {
      throw new Error('Necesitas conexion a internet para configurar el portal online.');
    }

    const licenseKey = getLicenseKeyFromDetails(getLicenseDetails());
    const authContext = await buildAuthContext({ licenseKey });

    if (
      !authContext?.licenseKey
      || !authContext?.deviceFingerprint
      || !authContext?.securityToken
    ) {
      throw new Error(
        'No se pudo confirmar el acceso para administrar el portal. '
        + 'Revalida la licencia o inicia sesion nuevamente.'
      );
    }

    return {
      p_license_key: authContext.licenseKey,
      p_device_fingerprint: authContext.deviceFingerprint,
      p_security_token: authContext.securityToken,
      p_staff_session_token: authContext.staffSessionToken || null
    };
  };

  const callRpc = async (
    name,
    payload = {},
    fallback = 'No se pudo completar la operacion del portal online.'
  ) => {
    try {
      const context = await getContext();
      const { data, error } = await rpc(name, { ...context, ...payload });

      if (error) {
        return normalizeFailure({ code: error.code }, fallback);
      }

      if (data?.success === true) {
        return data;
      }

      return normalizeFailure(data, fallback);
    } catch (error) {
      const code = error?.code || 'ECOMMERCE_ADMIN_NETWORK_ERROR';
      const safeContextMessage = SAFE_CONTEXT_MESSAGES.has(error?.message)
        ? error.message
        : null;

      return {
        success: false,
        code,
        message: SAFE_ERROR_MESSAGES[code] || safeContextMessage || fallback
      };
    }
  };

  return {
    getEcommercePortal: () => callRpc(
      'ecommerce_admin_get_portal',
      {},
      'No se pudo cargar la configuracion del portal online.'
    ),

    saveEcommercePortal: (payload) => callRpc(
      'ecommerce_admin_upsert_portal',
      { p_payload: payload || {} },
      'No se pudo guardar el portal online.'
    ),

    listPublishedProducts: () => callRpc(
      'ecommerce_admin_list_published_products',
      {},
      'No se pudieron cargar los productos del portal.'
    ),

    savePublishedProduct: (payload) => callRpc(
      'ecommerce_admin_upsert_published_product',
      { p_payload: payload || {} },
      'No se pudo guardar el producto publicado.'
    ),

    setProductPublished: (productId, isPublished) => callRpc(
      'ecommerce_admin_set_product_published',
      {
        p_product_id: productId,
        p_is_published: Boolean(isPublished)
      },
      'No se pudo cambiar la publicacion del producto.'
    ),

    syncPublishedCatalog: ({ projections, idempotencyKey, expectedCatalogRevision }) => callRpc(
      'ecommerce_admin_sync_published_catalog',
      {
        p_projections: Array.isArray(projections) ? projections : [],
        p_idempotency_key: idempotencyKey || null,
        p_expected_catalog_revision: expectedCatalogRevision || null
      },
      'No se pudo sincronizar el catalogo publicado.'
    )
  };
};

const ecommerceAdminService = createEcommerceAdminService();

export const getEcommercePortal = ecommerceAdminService.getEcommercePortal;
export const saveEcommercePortal = ecommerceAdminService.saveEcommercePortal;
export const listPublishedProducts = ecommerceAdminService.listPublishedProducts;
export const savePublishedProduct = ecommerceAdminService.savePublishedProduct;
export const setProductPublished = ecommerceAdminService.setProductPublished;
export const syncPublishedCatalog = ecommerceAdminService.syncPublishedCatalog;
