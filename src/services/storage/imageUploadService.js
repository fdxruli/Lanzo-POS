import Logger from '../Logger';
import { loadData, STORES } from '../database';
import {
  getDeviceSecurityToken,
  getStableDeviceId,
  supabaseClient
} from '../supabase';
import { checkInternetConnection } from '../utils';

const IMAGE_BUCKET = 'images';
const AUTHORIZE_FUNCTION = 'authorize-image-upload';
const STAFF_SESSION_TOKEN_KEY = 'staff_session_token';

export const IMAGE_UPLOAD_PURPOSES = Object.freeze({
  BUSINESS_LOGO: 'business-logo',
  BUSINESS_COVER: 'business-cover',
  PRODUCT_IMAGE: 'product-image',
  CATEGORY_IMAGE: 'category-image',
  RESTAURANT_ITEM_IMAGE: 'restaurant-item-image',
  PROFILE_IMAGE: 'profile-image',
  MISC: 'misc'
});

const PURPOSE_ALIASES = Object.freeze({
  logo: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO,
  business_logo: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO,
  businessLogo: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO,
  cover: IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER,
  product: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
  product_image: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
  productImage: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
  category: IMAGE_UPLOAD_PURPOSES.CATEGORY_IMAGE,
  category_image: IMAGE_UPLOAD_PURPOSES.CATEGORY_IMAGE,
  categoryImage: IMAGE_UPLOAD_PURPOSES.CATEGORY_IMAGE,
  restaurant: IMAGE_UPLOAD_PURPOSES.RESTAURANT_ITEM_IMAGE,
  restaurant_item_image: IMAGE_UPLOAD_PURPOSES.RESTAURANT_ITEM_IMAGE,
  restaurantItemImage: IMAGE_UPLOAD_PURPOSES.RESTAURANT_ITEM_IMAGE,
  profile: IMAGE_UPLOAD_PURPOSES.PROFILE_IMAGE,
  avatar: IMAGE_UPLOAD_PURPOSES.PROFILE_IMAGE,
  misc: IMAGE_UPLOAD_PURPOSES.MISC
});

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

const MAX_SIZE_BY_PURPOSE = Object.freeze({
  [IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO]: 2 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER]: 5 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE]: 4 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.CATEGORY_IMAGE]: 4 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.RESTAURANT_ITEM_IMAGE]: 4 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.PROFILE_IMAGE]: 2 * 1024 * 1024,
  [IMAGE_UPLOAD_PURPOSES.MISC]: 4 * 1024 * 1024
});

const FRIENDLY_UPLOAD_ERRORS = Object.freeze({
  STORAGE_UPLOAD_RATE_LIMITED: 'Demasiados intentos al subir imágenes. Espera unos minutos e intenta de nuevo.',
  INVALID_IMAGE_TYPE: 'El archivo debe ser una imagen JPG, PNG, WEBP o GIF.',
  IMAGE_TOO_LARGE: 'La imagen es demasiado grande. Reduce el tamaño e intenta de nuevo.',
  INVALID_IMAGE_PATH: 'No se pudo preparar la ruta segura de la imagen.',
  STORAGE_UPLOAD_NOT_ALLOWED: 'No tienes permiso para subir esta imagen.',
  STORAGE_UPLOAD_FAILED: 'No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo.',
  ONLINE_REQUIRED: 'Necesitas conexión a internet para subir imágenes.',
  SECURE_CONTEXT_REQUIRED: 'No se pudo confirmar la identidad segura del dispositivo. Vuelve a iniciar sesión o reactiva la licencia.'
});

function normalizePurpose(purpose) {
  if (!purpose) return IMAGE_UPLOAD_PURPOSES.MISC;
  const normalized = PURPOSE_ALIASES[purpose] || String(purpose).trim().toLowerCase();
  return Object.values(IMAGE_UPLOAD_PURPOSES).includes(normalized)
    ? normalized
    : IMAGE_UPLOAD_PURPOSES.MISC;
}

function getFriendlyErrorMessage(code, fallback) {
  return FRIENDLY_UPLOAD_ERRORS[code] || fallback || FRIENDLY_UPLOAD_ERRORS.STORAGE_UPLOAD_FAILED;
}

function getFileExtension(filename = '') {
  const cleanName = String(filename || '').trim();
  const parts = cleanName.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function validateClientSideImage(file, purpose) {
  if (!(file instanceof File)) {
    return { valid: false, code: 'INVALID_IMAGE_TYPE' };
  }

  const extension = getFileExtension(file.name);
  const mimeType = String(file.type || '').toLowerCase();

  if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, code: 'INVALID_IMAGE_TYPE' };
  }

  const maxSize = MAX_SIZE_BY_PURPOSE[purpose] || MAX_SIZE_BY_PURPOSE[IMAGE_UPLOAD_PURPOSES.MISC];
  if (typeof file.size === 'number' && file.size > maxSize) {
    return { valid: false, code: 'IMAGE_TOO_LARGE', maxSize };
  }

  return { valid: true, maxSize };
}

async function getStaffSessionToken() {
  try {
    const record = await loadData(STORES.SYNC_CACHE, STAFF_SESSION_TOKEN_KEY);
    return record?.value || null;
  } catch (error) {
    Logger.warn('[Storage] No se pudo leer la sesión staff para upload seguro:', error);
    return null;
  }
}

function buildUploadError(code, fallback) {
  const error = new Error(getFriendlyErrorMessage(code, fallback));
  error.code = code || 'STORAGE_UPLOAD_FAILED';
  return error;
}

export async function uploadImageFile({ file, licenseKey, purpose = IMAGE_UPLOAD_PURPOSES.MISC }) {
  const normalizedPurpose = normalizePurpose(purpose);
  const localValidation = validateClientSideImage(file, normalizedPurpose);

  if (!localValidation.valid) {
    throw buildUploadError(localValidation.code);
  }

  const isOnline = await checkInternetConnection();
  if (!isOnline) {
    throw buildUploadError('ONLINE_REQUIRED');
  }

  if (!licenseKey || !supabaseClient) {
    throw buildUploadError('SECURE_CONTEXT_REQUIRED');
  }

  const [deviceFingerprint, securityToken, staffSessionToken] = await Promise.all([
    getStableDeviceId(),
    getDeviceSecurityToken(),
    getStaffSessionToken()
  ]);

  if (!deviceFingerprint || !securityToken) {
    throw buildUploadError('SECURE_CONTEXT_REQUIRED');
  }

  const { data: authorization, error: authorizationError } = await supabaseClient.functions.invoke(
    AUTHORIZE_FUNCTION,
    {
      body: {
        license_key: licenseKey,
        device_fingerprint: deviceFingerprint,
        security_token: securityToken,
        staff_session_token: staffSessionToken || null,
        purpose: normalizedPurpose,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size
      }
    }
  );

  if (authorizationError) {
    Logger.warn('[Storage] Error autorizando upload de imagen:', authorizationError);
    throw buildUploadError('STORAGE_UPLOAD_FAILED');
  }

  if (!authorization?.success) {
    throw buildUploadError(
      authorization?.code || 'STORAGE_UPLOAD_NOT_ALLOWED',
      authorization?.message
    );
  }

  if (
    authorization.bucket !== IMAGE_BUCKET ||
    !authorization.path ||
    !authorization.token ||
    !authorization.path.startsWith('public_uploads/')
  ) {
    Logger.warn('[Storage] Autorización de upload inválida:', authorization);
    throw buildUploadError('INVALID_IMAGE_PATH');
  }

  const { error: uploadError } = await supabaseClient
    .storage
    .from(authorization.bucket)
    .uploadToSignedUrl(authorization.path, authorization.token, file, {
      cacheControl: '3600',
      contentType: authorization.mime_type || file.type,
      upsert: false
    });

  if (uploadError) {
    Logger.warn('[Storage] Falló upload firmado de imagen:', uploadError);
    throw buildUploadError(uploadError?.message?.includes('exceeded') ? 'IMAGE_TOO_LARGE' : 'STORAGE_UPLOAD_FAILED');
  }

  const { data: publicUrlData } = supabaseClient
    .storage
    .from(authorization.bucket)
    .getPublicUrl(authorization.public_url_path || authorization.path);

  return {
    bucket: authorization.bucket,
    path: authorization.path,
    publicUrl: publicUrlData?.publicUrl || null,
    maxSizeBytes: authorization.max_size_bytes || localValidation.maxSize,
    mimeType: authorization.mime_type || file.type,
    purpose: normalizedPurpose
  };
}

export async function uploadBusinessLogo(file, licenseKey) {
  return uploadImageFile({
    file,
    licenseKey,
    purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_LOGO
  });
}
