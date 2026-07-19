import { getEcommerceAdminAuthorizationContext, normalizeEcommerceAdminFailure } from './ecommerceAdminService';
import { supabaseClient } from '../supabase';
import { validateEcommerceSiteDocument } from '../../utils/ecommerceSiteDocument';

const SAFE_MESSAGES = {
  ECOMMERCE_SITE_DOCUMENT_INVALID: 'La estructura del sitio no es válida.',
  ECOMMERCE_SITE_DOCUMENT_TOO_LARGE: 'El documento del sitio es demasiado grande.',
  ECOMMERCE_SITE_SCHEMA_UNSUPPORTED: 'Esta versión del sitio no es compatible.',
  ECOMMERCE_SITE_SECTION_INVALID: 'Una sección del sitio no es válida.',
  ECOMMERCE_SITE_REQUIRED_SECTION_MISSING: 'El sitio requiere encabezado, catálogo y pie de página.',
  ECOMMERCE_SITE_DUPLICATE_SECTION: 'El sitio contiene secciones duplicadas.',
  ECOMMERCE_SITE_DRAFT_CONFLICT: 'El borrador cambió en otro dispositivo. Recarga para continuar.',
  ECOMMERCE_SITE_VERSION_NOT_FOUND: 'La versión solicitada ya no está disponible.',
  ECOMMERCE_SITE_ACCESS_DENIED: 'Tu plan o permisos no permiten usar el constructor del sitio.',
  ECOMMERCE_SITE_PUBLISH_FAILED: 'No se pudo publicar el sitio. Intenta nuevamente.',
  ECOMMERCE_SITE_SAVE_FAILED: 'No se pudo guardar el borrador del sitio. Intenta nuevamente.'
};

const failure = (data, fallback) => {
  const result = normalizeEcommerceAdminFailure(data, fallback);
  return { ...result, message: SAFE_MESSAGES[result.code] || result.message || fallback };
};

export const createEcommerceSiteBuilderService = ({
  rpc = (name, payload) => supabaseClient?.rpc(name, payload),
  getContext = getEcommerceAdminAuthorizationContext
} = {}) => {
  const call = async (name, payload, fallback) => {
    try {
      const context = await getContext();
      const { data, error } = await rpc(name, { ...context, ...payload });
      return error || data?.success !== true ? failure(error || data, fallback) : data;
    } catch (error) {
      return failure(error, fallback);
    }
  };
  return {
    getSiteBuilderState: () => call('ecommerce_admin_get_site_builder', {}, 'No se pudo cargar el constructor del sitio.'),
    saveSiteDraft: ({ expectedRevision, document }) => {
      const validation = validateEcommerceSiteDocument(document);
      if (!validation.valid) return Promise.resolve(failure({ code: validation.code }, 'No se pudo guardar el borrador del sitio.'));
      return call('ecommerce_admin_save_site_draft', { p_expected_revision: expectedRevision, p_document: validation.document }, 'No se pudo guardar el borrador del sitio.');
    },
    publishSiteDraft: () => call('ecommerce_admin_publish_site', {}, 'No se pudo publicar el sitio.'),
    listSiteVersions: () => call('ecommerce_admin_list_site_versions', {}, 'No se pudo cargar el historial del sitio.'),
    restoreSiteVersion: (versionId) => call('ecommerce_admin_restore_site_version', { p_version_id: versionId }, 'No se pudo restaurar la versión del sitio.')
  };
};

const service = createEcommerceSiteBuilderService();
export const getSiteBuilderState = service.getSiteBuilderState;
export const saveSiteDraft = service.saveSiteDraft;
export const publishSiteDraft = service.publishSiteDraft;
export const listSiteVersions = service.listSiteVersions;
export const restoreSiteVersion = service.restoreSiteVersion;
