export const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export const MIN_STORE_SLUG_LENGTH = 3;
export const MAX_STORE_SLUG_LENGTH = 64;
export const MAX_STORE_NAME_LENGTH = 80;
export const MAX_SOCIAL_TITLE_LENGTH = 110;
export const MAX_SOCIAL_DESCRIPTION_LENGTH = 200;
export const MAX_IMAGE_ALT_LENGTH = 160;

export const SOCIAL_LOCALE = 'es_MX';
export const SOCIAL_SITE_NAME = 'Lanzo Tienda';
export const OPEN_GRAPH_IMAGE_WIDTH = 1200;
export const OPEN_GRAPH_IMAGE_HEIGHT = 630;
export const OPEN_GRAPH_IMAGE_TYPE = 'image/png';

const TITLE_SUFFIX = 'Tienda en línea';
const GLOBAL_TITLE = 'Tienda en línea | Lanzo';
const GLOBAL_DESCRIPTION = 'Consulta productos y realiza tu pedido en línea.';
const GLOBAL_IMAGE_ALT = 'Vista previa de Lanzo Tienda';

const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPE_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export class SocialMetadataValidationError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'SocialMetadataValidationError';
    this.code = code;
  }
}

export function validateStoreSlug(value) {
  if (
    typeof value !== 'string'
    || value.length < MIN_STORE_SLUG_LENGTH
    || value.length > MAX_STORE_SLUG_LENGTH
    || !STORE_SLUG_PATTERN.test(value)
  ) {
    throw new SocialMetadataValidationError(
      'INVALID_STORE_SLUG',
      'El identificador de la tienda no es válido.',
    );
  }

  return value;
}

export function normalizeSocialText(value) {
  if (typeof value !== 'string') return '';

  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function truncateSocialText(value, maximumLength) {
  const normalized = normalizeSocialText(value);
  if (!Number.isSafeInteger(maximumLength) || maximumLength <= 0) return '';

  const characters = Array.from(normalized);
  if (characters.length <= maximumLength) return normalized;
  if (maximumLength === 1) return '…';

  return `${characters.slice(0, maximumLength - 1).join('').trimEnd()}…`;
}

export function escapeHtmlText(value) {
  const text = typeof value === 'string' ? value : '';
  return text.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPE_ENTITIES[character]);
}

export function escapeHtmlAttribute(value) {
  return escapeHtmlText(value);
}

export function normalizePublicOrigin(value) {
  if (typeof value !== 'string') {
    throw new SocialMetadataValidationError(
      'INVALID_PUBLIC_ORIGIN',
      'El origen público configurado no es válido.',
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SocialMetadataValidationError(
      'INVALID_PUBLIC_ORIGIN',
      'El origen público configurado no es válido.',
    );
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/+$/u.test(url.pathname)
  ) {
    throw new SocialMetadataValidationError(
      'INVALID_PUBLIC_ORIGIN',
      'El origen público configurado no es válido.',
    );
  }

  return url.origin;
}

function normalizeStoreName(value) {
  const name = truncateSocialText(value, MAX_STORE_NAME_LENGTH);
  return normalizeSocialText(name.replace(/\s*\|+\s*$/u, ''));
}

export function buildSocialTitle(storeName) {
  const name = normalizeStoreName(storeName);
  if (!name) return GLOBAL_TITLE;

  return truncateSocialText(
    `${name} | ${TITLE_SUFFIX}`,
    MAX_SOCIAL_TITLE_LENGTH,
  );
}

export function buildSocialDescription({ name, headline, description } = {}) {
  const normalizedHeadline = normalizeSocialText(headline);
  if (normalizedHeadline) {
    return truncateSocialText(normalizedHeadline, MAX_SOCIAL_DESCRIPTION_LENGTH);
  }

  const normalizedDescription = normalizeSocialText(description);
  if (normalizedDescription) {
    return truncateSocialText(normalizedDescription, MAX_SOCIAL_DESCRIPTION_LENGTH);
  }

  const normalizedName = normalizeStoreName(name);
  if (normalizedName) {
    return truncateSocialText(
      `Consulta el catálogo de ${normalizedName} y realiza tu pedido en línea.`,
      MAX_SOCIAL_DESCRIPTION_LENGTH,
    );
  }

  return GLOBAL_DESCRIPTION;
}

export function buildCanonicalUrl({ publicOrigin, slug }) {
  const origin = normalizePublicOrigin(publicOrigin);
  const validSlug = validateStoreSlug(slug);
  return new URL(`/tienda/${validSlug}`, `${origin}/`).toString();
}

export function buildOpenGraphImageUrl({
  publicOrigin,
  slug,
  siteVersionNumber,
}) {
  const origin = normalizePublicOrigin(publicOrigin);
  const validSlug = validateStoreSlug(slug);
  const imageUrl = new URL(`/api/og/store/${validSlug}`, `${origin}/`);
  const imageVersioned = Number.isSafeInteger(siteVersionNumber) && siteVersionNumber > 0;

  if (imageVersioned) {
    imageUrl.searchParams.set('v', String(siteVersionNumber));
  }

  return Object.freeze({
    imageUrl: imageUrl.toString(),
    imageVersioned,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function buildStoreSocialMetadata({
  publicOrigin,
  slug,
  portal,
  siteVersionNumber,
} = {}) {
  const allowedPortal = portal && typeof portal === 'object'
    ? {
        name: portal.name,
        headline: portal.headline,
        description: portal.description,
      }
    : {};
  const name = normalizeStoreName(allowedPortal.name);
  const title = buildSocialTitle(name);
  const description = buildSocialDescription({
    name,
    headline: allowedPortal.headline,
    description: allowedPortal.description,
  });
  const canonicalUrl = buildCanonicalUrl({ publicOrigin, slug });
  const { imageUrl, imageVersioned } = buildOpenGraphImageUrl({
    publicOrigin,
    slug,
    siteVersionNumber,
  });
  const imageAlt = truncateSocialText(
    name ? `Vista previa de ${name}` : GLOBAL_IMAGE_ALT,
    MAX_IMAGE_ALT_LENGTH,
  );

  return deepFreeze({
    title,
    description,
    canonicalUrl,
    imageUrl,
    imageAlt,
    locale: SOCIAL_LOCALE,
    siteName: SOCIAL_SITE_NAME,
    imageVersioned,
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonicalUrl,
      image: imageUrl,
      imageAlt,
      imageWidth: OPEN_GRAPH_IMAGE_WIDTH,
      imageHeight: OPEN_GRAPH_IMAGE_HEIGHT,
      imageType: OPEN_GRAPH_IMAGE_TYPE,
      locale: SOCIAL_LOCALE,
      siteName: SOCIAL_SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: imageUrl,
      imageAlt,
    },
  });
}
