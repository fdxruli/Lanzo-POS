import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { getDeviceSecurityToken, getStableDeviceId, supabaseClient } from '../supabase';

const getContext = async () => {
  if (!supabaseClient) throw new Error('La conexion con Supabase no esta configurada.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Necesitas conexion a internet para configurar el portal online.');
  }

  const licenseKey = getLicenseKeyFromDetails(useAppStore.getState()?.licenseDetails || {});
  const [deviceFingerprint, securityToken] = await Promise.all([
    getStableDeviceId(),
    getDeviceSecurityToken()
  ]);

  if (!licenseKey || !deviceFingerprint || !securityToken) {
    throw new Error('No se pudo confirmar el dispositivo administrador. Revalida la licencia e intenta de nuevo.');
  }

  return {
    p_license_key: licenseKey,
    p_device_fingerprint: deviceFingerprint,
    p_security_token: securityToken
  };
};

const callRpc = async (name, payload = {}, fallback = 'No se pudo completar la operacion del portal online.') => {
  try {
    const context = await getContext();
    const { data, error } = await supabaseClient.rpc(name, { ...context, ...payload });
    if (error) throw error;
    if (data?.success === true) return data;
    return {
      ...(data || {}),
      success: false,
      code: data?.code || data?.error?.code || 'ECOMMERCE_ADMIN_ERROR',
      message: data?.message || data?.error?.message || fallback
    };
  } catch (error) {
    return {
      success: false,
      code: error?.code || 'ECOMMERCE_ADMIN_NETWORK_ERROR',
      message: error?.message || fallback
    };
  }
};

export const getEcommercePortal = () => callRpc(
  'ecommerce_admin_get_portal', {}, 'No se pudo cargar la configuracion del portal online.'
);

export const saveEcommercePortal = (payload) => callRpc(
  'ecommerce_admin_upsert_portal', { p_payload: payload || {} }, 'No se pudo guardar el portal online.'
);

export const listPublishedProducts = () => callRpc(
  'ecommerce_admin_list_published_products', {}, 'No se pudieron cargar los productos del portal.'
);

export const savePublishedProduct = (payload) => callRpc(
  'ecommerce_admin_upsert_published_product', { p_payload: payload || {} }, 'No se pudo guardar el producto publicado.'
);

export const setProductPublished = (productId, isPublished) => callRpc(
  'ecommerce_admin_set_product_published',
  { p_product_id: productId, p_is_published: Boolean(isPublished) },
  'No se pudo cambiar la publicacion del producto.'
);
