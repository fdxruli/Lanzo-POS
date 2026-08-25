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
const NOT_FOUND_TITLE = 'Tienda no disponible | Lanzo';
const NOT_FOUND_DESCRIPTION = 'Esta tienda no está disponible. Consulta otras tiendas creadas con Lanzo.';
const APPROVED_SOCIAL_METADATA = new WeakSet();

const SOCIAL_COPY_MIN_COMBINATION_WORDS = 2;
const SOCIAL_COPY_MIN_COMBINED_WORDS = 7;
const SOCIAL_COPY_MIN_RICH_DESCRIPTION_WORDS = 5;
const SOCIAL_COPY_TERSE_WORD_LIMIT = 2;
const SOCIAL_COPY_TERSE_CHARACTER_LIMIT = 24;
const SOCIAL_COPY_MATERIAL_WORD_ADVANTAGE = 2;
const SOCIAL_COPY_MATERIAL_CHARACTER_ADVANTAGE = 12;
const SOCIAL_COPY_RELATED_OVERLAP_RATIO = 0.5;
const SOCIAL_COPY_DISTINCT_OVERLAP_RATIO = 0.34;
const SOCIAL_COPY_TERMINAL_COMPARISON_PUNCTUATION = /[.!?…,:;]+$/gu;
const SOCIAL_COPY_TERMINAL_SENTENCE_PUNCTUATION = /[.!?…,:;]$/u;
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

function socialComparisonKey(value) {
  return normalizeSocialText(value)
    .toLowerCase()
    .replace(SOCIAL_COPY_TERMINAL_COMPARISON_PUNCTUATION, '')
    .trim();
}

function socialWords(value) {
  return socialComparisonKey(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function socialTextProfile(value) {
  const text = normalizeSocialText(value);
  const words = socialWords(text);

  return Object.freeze({
    text,
    comparisonKey: socialComparisonKey(text),
    words: Object.freeze(words),
    wordCount: words.length,
    characterCount: Array.from(text).length,
  });
}

function socialWordOverlapRatio(left, right) {
  if (!left.words.length || !right.words.length) return 0;

  const rightWords = new Set(right.words);
  const sharedWords = new Set(left.words.filter((word) => rightWords.has(word)));
  return sharedWords.size / Math.min(left.words.length, right.words.length);
}

function isMateriallyMoreInformative(candidate, other) {
  return candidate.wordCount >= other.wordCount + SOCIAL_COPY_MATERIAL_WORD_ADVANTAGE
    || candidate.characterCount >= other.characterCount + SOCIAL_COPY_MATERIAL_CHARACTER_ADVANTAGE;
}

function isTerseSocialText(profile) {
  return profile.wordCount <= SOCIAL_COPY_TERSE_WORD_LIMIT
    && profile.characterCount <= SOCIAL_COPY_TERSE_CHARACTER_LIMIT;
}

function strongerSocialCandidate(headline, description) {
  if (headline.wordCount !== description.wordCount) {
    return headline.wordCount > description.wordCount ? headline : description;
  }
  if (headline.characterCount !== description.characterCount) {
    return headline.characterCount > description.characterCount ? headline : description;
  }
  return headline;
}

function combineSocialCandidates(headline, description) {
  const separator = SOCIAL_COPY_TERMINAL_SENTENCE_PUNCTUATION.test(headline.text)
    ? ' '
    : '. ';
  return `${headline.text}${separator}${description.text}`;
}

export function buildSocialDescription({ name, headline, description } = {}) {
  const headlineCandidate = socialTextProfile(headline);
  const descriptionCandidate = socialTextProfile(description);

  if (headlineCandidate.text && descriptionCandidate.text) {
    const comparisonKeysAvailable = Boolean(
      headlineCandidate.comparisonKey && descriptionCandidate.comparisonKey,
    );

    if (
      comparisonKeysAvailable
      && headlineCandidate.comparisonKey === descriptionCandidate.comparisonKey
    ) {
      return truncateSocialText(
        strongerSocialCandidate(headlineCandidate, descriptionCandidate).text,
        MAX_SOCIAL_DESCRIPTION_LENGTH,
      );
    }

    if (
      comparisonKeysAvailable
      && descriptionCandidate.comparisonKey.includes(headlineCandidate.comparisonKey)
    ) {
      return truncateSocialText(descriptionCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }
    if (
      comparisonKeysAvailable
      && headlineCandidate.comparisonKey.includes(descriptionCandidate.comparisonKey)
    ) {
      return truncateSocialText(headlineCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }

    const overlapRatio = socialWordOverlapRatio(headlineCandidate, descriptionCandidate);
    if (
      overlapRatio >= SOCIAL_COPY_RELATED_OVERLAP_RATIO
      && isMateriallyMoreInformative(descriptionCandidate, headlineCandidate)
    ) {
      return truncateSocialText(descriptionCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }
    if (
      overlapRatio >= SOCIAL_COPY_RELATED_OVERLAP_RATIO
      && isMateriallyMoreInformative(headlineCandidate, descriptionCandidate)
    ) {
      return truncateSocialText(headlineCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }

    if (
      isTerseSocialText(descriptionCandidate)
      && isMateriallyMoreInformative(headlineCandidate, descriptionCandidate)
    ) {
      return truncateSocialText(headlineCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }

    const combinedText = combineSocialCandidates(headlineCandidate, descriptionCandidate);
    const combinedWordCount = headlineCandidate.wordCount + descriptionCandidate.wordCount;
    const combinedFits = Array.from(combinedText).length <= MAX_SOCIAL_DESCRIPTION_LENGTH;
    const supportsConciseLead = headlineCandidate.wordCount >= SOCIAL_COPY_MIN_COMBINATION_WORDS
      && descriptionCandidate.wordCount >= SOCIAL_COPY_MIN_RICH_DESCRIPTION_WORDS;
    const supportsBalancedCombination = headlineCandidate.wordCount > SOCIAL_COPY_TERSE_WORD_LIMIT
      && descriptionCandidate.wordCount > SOCIAL_COPY_TERSE_WORD_LIMIT
      && !isMateriallyMoreInformative(headlineCandidate, descriptionCandidate)
      && !isMateriallyMoreInformative(descriptionCandidate, headlineCandidate);

    if (
      overlapRatio <= SOCIAL_COPY_DISTINCT_OVERLAP_RATIO
      && combinedWordCount >= SOCIAL_COPY_MIN_COMBINED_WORDS
      && combinedFits
      && (supportsConciseLead || supportsBalancedCombination)
    ) {
      return combinedText;
    }

    if (
      isTerseSocialText(headlineCandidate)
      && isMateriallyMoreInformative(descriptionCandidate, headlineCandidate)
    ) {
      return truncateSocialText(descriptionCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
    }

    return truncateSocialText(
      strongerSocialCandidate(headlineCandidate, descriptionCandidate).text,
      MAX_SOCIAL_DESCRIPTION_LENGTH,
    );
  }

  if (headlineCandidate.text) {
    return truncateSocialText(headlineCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
  }

  if (descriptionCandidate.text) {
    return truncateSocialText(descriptionCandidate.text, MAX_SOCIAL_DESCRIPTION_LENGTH);
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
  renderRevision,
}) {
  const origin = normalizePublicOrigin(publicOrigin);
  const validSlug = validateStoreSlug(slug);
  const imageUrl = new URL('/api/og/store', `${origin}/`);
  imageUrl.searchParams.set('slug', validSlug);
  const imageVersioned = Number.isSafeInteger(siteVersionNumber) && siteVersionNumber > 0;
  const rendererVersioned = Number.isSafeInteger(renderRevision) && renderRevision > 0;

  if (imageVersioned) {
    imageUrl.searchParams.set('v', String(siteVersionNumber));
  }
  if (rendererVersioned) {
    imageUrl.searchParams.set('rv', String(renderRevision));
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

function approveMetadata(value) {
  APPROVED_SOCIAL_METADATA.add(value);
  return deepFreeze(value);
}

export function isApprovedStoreSocialMetadata(value) {
  return Boolean(value && typeof value === 'object' && APPROVED_SOCIAL_METADATA.has(value));
}

export function buildGenericStoreSocialMetadata({ status = 'unavailable' } = {}) {
  const notFound = status === 'not_found';
  if (!notFound && status !== 'unavailable') {
    throw new SocialMetadataValidationError(
      'INVALID_GENERIC_METADATA_STATUS',
      'El estado de metadatos genéricos no es válido.',
    );
  }

  const title = notFound ? NOT_FOUND_TITLE : GLOBAL_TITLE;
  const description = notFound ? NOT_FOUND_DESCRIPTION : GLOBAL_DESCRIPTION;
  return approveMetadata({
    title,
    description,
    canonicalUrl: null,
    imageUrl: null,
    imageAlt: null,
    locale: SOCIAL_LOCALE,
    siteName: SOCIAL_SITE_NAME,
    imageVersioned: false,
    openGraph: {
      type: 'website',
      title,
      description,
      url: null,
      image: null,
      imageAlt: null,
      imageWidth: null,
      imageHeight: null,
      imageType: null,
      locale: SOCIAL_LOCALE,
      siteName: SOCIAL_SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image: null,
      imageAlt: null,
    },
  });
}

export function buildStoreSocialMetadata({
  publicOrigin,
  slug,
  portal,
  siteVersionNumber,
  renderRevision,
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
    renderRevision,
  });
  const imageAlt = truncateSocialText(
    name ? `Vista previa de ${name}` : GLOBAL_IMAGE_ALT,
    MAX_IMAGE_ALT_LENGTH,
  );

  return approveMetadata({
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
