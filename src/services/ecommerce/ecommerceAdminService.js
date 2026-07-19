import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { supabaseClient } from '../supabase';
import {
  buildEcommerceProductConfigurationSyncPayload,
  getEcommerceConfigurationSourceRevision,
  serializeEcommerceProductConfigurationForSync
} from '../../utils/ecommerceProductConfigurationSync';
import { ecommercePublishedStockLocalSource } from './ecommercePublishedStockLocalSource';
import {
  decorateProductWithEcommerceApparelProjection,
  getEcommerceApparelProjectionState,
  projectProductBatchesToEcommerceVariants
} from './ecommerceApparelVariants';

const SAFE_ERROR_MESSAGES = {
  ECOMMERCE_ADMIN_ACCESS_DENIED: 'No tienes permiso para administrar el portal online.',
  ECOMMERCE_STAFF_SESSION_REQUIRED: 'Inicia sesion como personal para administrar el portal online.',
  ECOMMERCE_STAFF_SESSION_INVALID: 'Tu sesion de personal no es valida. Inicia sesion nuevamente.',
  ECOMMERCE_STAFF_PERMISSION_DENIED: 'No tienes permiso para administrar el portal online.',
  ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO: 'La sincronizacion automatica requiere Lanzo Nube.',
  ECOMMERCE_CATALOG_SYNC_BATCH_TOO_LARGE: 'La sincronizacion incluye demasiados productos en un solo lote.',
  ECOMMERCE_CATALOG_SYNC_DUPLICATE_REF: 'La sincronizacion contiene productos duplicados.',
  ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD: 'La sincronizacion contiene una proyeccion invalida.',
  ECOMMERCE_CATALOG_REVISION_CHANGED: 'El catalogo cambio durante la sincronizacion. Se reintentara con la revision vigente.',
  ECOMMERCE_CATALOG_SOURCE_STALE: 'Un dispositivo tiene una version anterior del producto.',
  ECOMMERCE_CATALOG_SOURCE_CONFLICT: 'La revision del producto requiere reconciliacion.',
  ECOMMERCE_CONFIGURATION_INVALID: 'Revisa las variantes, grupos y opciones del producto.',
  ECOMMERCE_CONFIGURATION_OPTION_LIMIT_EXCEEDED: 'El producto supera el limite de opciones permitido.',
  ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE: 'La configuracion contiene una referencia que no pertenece a esta licencia.',
  ECOMMERCE_VARIANT_SOURCE_NOT_FOUND: 'Una variante ya no existe en el catalogo local.',
  ECOMMERCE_OPTION_INGREDIENT_NOT_FOUND: 'Un ingrediente de una opcion ya no existe en el catalogo local.',
  ECOMMERCE_OPTION_GROUP_SELECTION_INVALID: 'Revisa los limites de seleccion de los grupos de opciones.',
  ECOMMERCE_VARIANT_OPTION_VALUES_REQUIRED: 'Cada variante debe indicar su combinacion de atributos.',
  ECOMMERCE_VARIANT_OPTION_VALUE_INVALID: 'Una variante contiene un atributo invalido.',
  ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_CONFLICT: 'Un SKU esta asociado a combinaciones de talla o color incompatibles.',
  ECOMMERCE_APPAREL_VARIANT_PRICE_CONFLICT: 'Un SKU tiene precios incompatibles entre sus lotes.',
  ECOMMERCE_CONFIGURATION_SYNC_FAILED: 'No se pudo sincronizar la configuracion del producto.',
  ECOMMERCE_TIMEZONE_INVALID: 'Selecciona una zona horaria valida.',
  ECOMMERCE_SCHEDULE_INVALID: 'Revisa el horario y corrige los intervalos invalidos.',
  ECOMMERCE_SCHEDULE_REQUIRED: 'Configura al menos un dia abierto antes de aplicar el horario.',
  ECOMMERCE_SCHEDULE_DUPLICATE_DAY: 'Cada dia debe aparecer una sola vez.',
  ECOMMERCE_EXCEPTION_INVALID: 'Revisa las excepciones del horario.',
  ECOMMERCE_PAUSE_UNTIL_INVALID: 'La reanudacion debe programarse para una fecha futura.',
  ECOMMERCE_PAUSE_REASON_INVALID: 'La razon de la pausa no puede superar 300 caracteres.',
  ECOMMERCE_TEMPLATE_INVALID: 'La plantilla seleccionada no es válida.',
  ECOMMERCE_THEME_INVALID: 'La configuración visual no es válida.',
  ECOMMERCE_THEME_COLOR_INVALID: 'Los colores deben usar formato hexadecimal #RRGGBB.',
  ECOMMERCE_IMAGE_URL_INVALID: 'La dirección de imagen no es válida.',
  ECOMMERCE_BRANDING_REQUIRES_PRO: 'La personalización avanzada requiere Lanzo Nube.',
  ECOMMERCE_PORTAL_SAVE_FAILED: 'No se pudo guardar el portal online. Intenta nuevamente.'
};

export const buildDefaultEcommerceAdminAuthContext = async ({ licenseKey }) => {
  const { buildPosSyncAuthContext } = await import('../sync/posSyncClient');
  return buildPosSyncAuthContext({ licenseKey });
};

const SAFE_CONTEXT_MESSAGES = new Set([
  'La conexion con Supabase no esta configurada.',
  'Necesitas conexion a internet para configurar el portal online.',
  'No se pudo confirmar el acceso para administrar el portal. Revalida la licencia o inicia sesion nuevamente.'
]);

export const normalizeEcommerceAdminFailure = (data, fallback) => {
  const code = data?.code || data?.error?.code || 'ECOMMERCE_ADMIN_ERROR';
  const status = Number(
    data?.status
    ?? data?.statusCode
    ?? data?.error?.status
    ?? data?.error?.statusCode
  );

  return {
    ...(data || {}),
    success: false,
    code,
    name: data?.name || data?.error?.name || null,
    status: Number.isFinite(status) ? status : null,
    retryable: data?.retryable === true || data?.error?.retryable === true,
    message: SAFE_ERROR_MESSAGES[code] || fallback
  };
};

const normalizeFailure = normalizeEcommerceAdminFailure;

export const getEcommerceAdminAuthorizationContext = async ({
  isConfigured = () => Boolean(supabaseClient),
  isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  getLicenseDetails = () => useAppStore.getState()?.licenseDetails || {},
  buildAuthContext = buildDefaultEcommerceAdminAuthContext
} = {}) => {
  if (!isConfigured()) throw new Error('La conexion con Supabase no esta configurada.');
  if (!isOnline()) {
    const error = new Error('Necesitas conexion a internet para configurar el portal online.');
    error.code = 'ECOMMERCE_ADMIN_OFFLINE';
    error.retryable = true;
    throw error;
  }
  const licenseKey = getLicenseKeyFromDetails(getLicenseDetails());
  const authContext = await buildAuthContext({ licenseKey });
  if (!authContext?.licenseKey || !authContext?.deviceFingerprint || !authContext?.securityToken) {
    throw new Error('No se pudo confirmar el acceso para administrar el portal. Revalida la licencia o inicia sesion nuevamente.');
  }
  return {
    p_license_key: authContext.licenseKey,
    p_device_fingerprint: authContext.deviceFingerprint,
    p_security_token: authContext.securityToken,
    p_staff_session_token: authContext.staffSessionToken || null
  };
};

const buildConfigurationFailure = (error, fallback) => normalizeFailure({
  code: error?.code || error?.message || 'ECOMMERCE_CONFIGURATION_INVALID',
  message: fallback
}, fallback);

const isProjectionObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const buildPublishedProductConfiguration = (localProduct = {}) => {
  const baseConfiguration = buildEcommerceProductConfigurationSyncPayload(localProduct);
  const apparelState = getEcommerceApparelProjectionState(localProduct);
  if (!apparelState) return baseConfiguration;

  return serializeEcommerceProductConfigurationForSync({
    ...baseConfiguration,
    type: 'variant_parent',
    variants: Array.isArray(localProduct.variants) ? localProduct.variants : [],
    availabilitySource: 'variant_aggregate',
    availabilityReasonCode: apparelState.availabilityReasonCode,
    limitingSource: baseConfiguration.limitingSource
  });
};

const preparePublishedProductPayload = (payload = {}) => {
  const {
    localProduct,
    configuration: suppliedConfiguration,
    configurationSourceRevision: suppliedSourceRevision,
    ...publishedPayload
  } = payload || {};

  if (!localProduct && !suppliedConfiguration) {
    return { payload: publishedPayload, useV2: false };
  }

  const configuration = suppliedConfiguration
    ? serializeEcommerceProductConfigurationForSync(suppliedConfiguration)
    : buildPublishedProductConfiguration(localProduct);
  const configurationSourceRevision = suppliedSourceRevision
    || getEcommerceConfigurationSourceRevision(localProduct)
    || null;

  return {
    useV2: true,
    payload: {
      ...publishedPayload,
      configuration,
      configurationSourceRevision
    }
  };
};

const hydrateLocalProductApparelVariants = async ({
  localProduct,
  localSource = ecommercePublishedStockLocalSource,
  now = new Date()
} = {}) => {
  if (!localProduct?.id || (Array.isArray(localProduct.variants) && localProduct.variants.length > 0)) {
    return localProduct;
  }

  const batchesByProduct = await localSource.getBatchesByProductIds([localProduct.id]);
  const batches = batchesByProduct.get(localProduct.id)
    || batchesByProduct.get(String(localProduct.id))
    || [];
  const projection = projectProductBatchesToEcommerceVariants({
    product: localProduct,
    batches,
    now
  });
  return decorateProductWithEcommerceApparelProjection({
    product: localProduct,
    projection
  });
};

const preparePublishedProductPayloadAsync = async (
  payload = {},
  { localSource = ecommercePublishedStockLocalSource, now = new Date() } = {}
) => {
  if (!payload?.localProduct || payload?.configuration) {
    return preparePublishedProductPayload(payload);
  }
  const localProduct = await hydrateLocalProductApparelVariants({
    localProduct: payload.localProduct,
    localSource,
    now
  });
  return preparePublishedProductPayload({ ...payload, localProduct });
};

export const createEcommerceAdminService = ({
  rpc = (name, payload) => supabaseClient?.rpc(name, payload),
  isConfigured = () => Boolean(supabaseClient),
  getLicenseDetails = () => useAppStore.getState()?.licenseDetails || {},
  buildAuthContext = buildDefaultEcommerceAdminAuthContext,
  isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  localSource = ecommercePublishedStockLocalSource
} = {}) => {
  const getContext = () => getEcommerceAdminAuthorizationContext({
    isConfigured, isOnline, getLicenseDetails, buildAuthContext
  });

  const callRpc = async (
    name,
    payload = {},
    fallback = 'No se pudo completar la operacion del portal online.'
  ) => {
    try {
      const context = await getContext();
      const { data, error } = await rpc(name, { ...context, ...payload });

      if (error) {
        return normalizeFailure(error, fallback);
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

      return normalizeFailure({
        code,
        name: error?.name,
        status: error?.status ?? error?.statusCode,
        retryable: error?.retryable === true,
        message: SAFE_ERROR_MESSAGES[code] || safeContextMessage || fallback
      }, fallback);
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

    saveOperatingSchedule: ({ timezone, businessHoursEnabled, weekly, exceptions }) => callRpc(
      'ecommerce_admin_save_operating_schedule',
      {
        p_timezone: timezone,
        p_business_hours_enabled: businessHoursEnabled === true,
        p_weekly: Array.isArray(weekly) ? weekly : [],
        p_exceptions: Array.isArray(exceptions) ? exceptions : []
      },
      'No se pudo guardar el horario de atencion.'
    ),

    setOrderPause: ({ paused, reason = null, resumeAt = null }) => callRpc(
      'ecommerce_admin_set_order_pause',
      {
        p_paused: paused === true,
        p_reason: reason || null,
        p_resume_at: resumeAt || null
      },
      paused ? 'No se pudieron pausar los pedidos.' : 'No se pudieron reanudar los pedidos.'
    ),

    listPublishedProducts: () => callRpc(
      'ecommerce_admin_list_published_products',
      {},
      'No se pudieron cargar los productos del portal.'
    ),

    savePublishedProduct: async (payload) => {
      const fallback = 'No se pudo guardar el producto publicado.';
      try {
        const prepared = await preparePublishedProductPayloadAsync(payload, { localSource });
        return callRpc(
          prepared.useV2
            ? 'ecommerce_admin_upsert_published_product_v2'
            : 'ecommerce_admin_upsert_published_product',
          { p_payload: prepared.payload },
          fallback
        );
      } catch (error) {
        return buildConfigurationFailure(error, fallback);
      }
    },

    setProductPublished: (productId, isPublished) => callRpc(
      'ecommerce_admin_set_product_published',
      {
        p_product_id: productId,
        p_is_published: Boolean(isPublished)
      },
      'No se pudo cambiar la publicacion del producto.'
    ),

    syncProductConfiguration: async ({
      publishedProductId,
      configuration,
      sourceRevision = null
    }) => {
      const fallback = 'No se pudo sincronizar la configuracion del producto.';
      try {
        return callRpc(
          'ecommerce_admin_sync_product_configuration',
          {
            p_published_product_id: publishedProductId,
            p_configuration: serializeEcommerceProductConfigurationForSync(configuration || {}),
            p_source_revision: sourceRevision || null
          },
          fallback
        );
      } catch (error) {
        return buildConfigurationFailure(error, fallback);
      }
    },

    syncPublishedCatalog: ({ projections, idempotencyKey, expectedCatalogRevision }) => {
      const fallback = 'No se pudo sincronizar el catalogo publicado.';
      if (
        !Array.isArray(projections)
        || projections.some((projection) => !isProjectionObject(projection))
      ) {
        return Promise.resolve(normalizeFailure({
          code: 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD'
        }, fallback));
      }

      return callRpc(
        'ecommerce_admin_sync_published_catalog_v2',
        {
          p_projections: projections,
          p_idempotency_key: idempotencyKey || 'catalog-sync',
          p_expected_catalog_revision: expectedCatalogRevision || null
        },
        fallback
      );
    }
  };
};

const ecommerceAdminService = createEcommerceAdminService();

export const getEcommercePortal = ecommerceAdminService.getEcommercePortal;
export const saveEcommercePortal = ecommerceAdminService.saveEcommercePortal;
export const saveOperatingSchedule = ecommerceAdminService.saveOperatingSchedule;
export const setOrderPause = ecommerceAdminService.setOrderPause;
export const listPublishedProducts = ecommerceAdminService.listPublishedProducts;
export const savePublishedProduct = ecommerceAdminService.savePublishedProduct;
export const setProductPublished = ecommerceAdminService.setProductPublished;
export const syncProductConfiguration = ecommerceAdminService.syncProductConfiguration;
export const syncPublishedCatalog = ecommerceAdminService.syncPublishedCatalog;

export const ecommerceAdminServiceInternals = Object.freeze({
  isProjectionObject,
  buildPublishedProductConfiguration,
  preparePublishedProductPayload,
  preparePublishedProductPayloadAsync,
  hydrateLocalProductApparelVariants
});
