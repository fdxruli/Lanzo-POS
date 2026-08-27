import {
  createPublicPortalSocialClient,
} from '../_publicPortal.js';
import {
  OPEN_GRAPH_IMAGE_HEIGHT,
  OPEN_GRAPH_IMAGE_WIDTH,
  validateStoreSlug,
} from '../_socialMetadata.js';
import { createSafePublicImageLoader } from '../_safePublicImage.js';
import {
  StoreOgFallbackCard,
  buildStoreOgFallbackCardModel,
} from '../_storeOgFallbackCard.js';
import { StoreOgCardV2 } from '../_storeOgCardV2.js';
import { buildStoreOgCardV2Model } from '../_storeOgCardV2Model.js';

export const VERSIONED_CACHE = 'public, max-age=31536000, immutable';
export const REVALIDATED_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
export const NOT_FOUND_CACHE = 'public, max-age=0, s-maxage=300';
export const TEMPORARY_CACHE = 'public, max-age=0, s-maxage=60';
export const MINIMUM_PNG_BYTES = 1_000;
export const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BASE_HEADERS = Object.freeze({
  'Content-Type': 'image/png',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
});
const FINAL_ERROR_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
});

let imageResponsePromise;

export function loadImageResponse() {
  imageResponsePromise ??= import('@vercel/og')
    .then((module) => {
      if (typeof module?.ImageResponse !== 'function') {
        throw new TypeError('@vercel/og did not export ImageResponse.');
      }
      return module.ImageResponse;
    });
  return imageResponsePromise;
}

function parseRequest(request) {
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
  const url = new URL(request.url);
  const slugValues = url.searchParams.getAll('slug');
  let slug = null;
  if (slugValues.length === 1) {
    try {
      slug = validateStoreSlug(slugValues[0]);
    } catch {
      slug = null;
    }
  }

  const versionValues = url.searchParams.getAll('v');
  let requestedVersion = null;
  if (versionValues.length === 1 && /^\d+$/u.test(versionValues[0])) {
    const parsed = Number(versionValues[0]);
    requestedVersion = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return Object.freeze({ method, slug, requestedVersion });
}

function cacheFor(result, requestedVersion) {
  if (result?.status === 'not_found') return NOT_FOUND_CACHE;
  if (result?.status !== 'ok') return TEMPORARY_CACHE;
  if (
    requestedVersion !== null
    && Number.isSafeInteger(result.siteVersionNumber)
    && requestedVersion === result.siteVersionNumber
  ) {
    return VERSIONED_CACHE;
  }
  return REVALIDATED_CACHE;
}

function responseHeaders(cacheControl, extra = {}) {
  return Object.freeze({
    ...BASE_HEADERS,
    'Cache-Control': cacheControl,
    ...extra,
  });
}

function methodNotAllowed() {
  return new Response(null, {
    status: 405,
    headers: responseHeaders(TEMPORARY_CACHE, { Allow: 'GET, HEAD' }),
  });
}

function reportRenderFailure(logger, attempt) {
  try {
    logger?.warn?.(`[store-og] render_failed:${attempt}`);
  } catch {
    // Diagnostics must never affect the public response.
  }
}

function buildSuccessfulStoreOgV2Model(result) {
  const portal = result?.portal || {};
  return buildStoreOgCardV2Model({
    name: portal.name,
    headline: portal.headline,
    description: portal.description,
    templateCode: portal.templateCode,
    theme: portal.theme,
    logoUrl: portal.logoUrl,
    coverImageUrl: portal.coverImageUrl,
  });
}

export function buildStoreOgRenderAttempts({
  result,
  logoImage = null,
  coverImage = null,
} = {}) {
  if (result?.status !== 'ok') {
    return Object.freeze([
      Object.freeze({
        name: 'status_fallback',
        model: buildStoreOgFallbackCardModel({ status: result?.status }),
      }),
    ]);
  }

  const model = buildSuccessfulStoreOgV2Model(result);
  const attempts = [];
  const seen = new Set();
  const addAttempt = (name, nextLogoImage, nextCoverImage) => {
    const signature = `${nextLogoImage ? 'logo' : 'no-logo'}:${nextCoverImage ? 'cover' : 'no-cover'}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    attempts.push(Object.freeze({
      name,
      model,
      logoImage: nextLogoImage,
      coverImage: nextCoverImage,
    }));
  };

  const primaryAttempt = logoImage && coverImage
    ? 'logo_and_cover'
    : (coverImage ? 'cover_only' : (logoImage ? 'logo_only' : 'branding_only'));
  addAttempt(primaryAttempt, logoImage, coverImage);
  if (logoImage && coverImage) addAttempt('cover_only', null, coverImage);
  if (logoImage && coverImage) addAttempt('logo_only', logoImage, null);
  addAttempt('branding_only', null, null);

  return Object.freeze(attempts);
}

export function renderStoreOgImage({
  ImageResponseImpl,
  model,
  logoImage = null,
  coverImage = null,
  status,
}) {
  let card;
  if (model?.version === 2) {
    card = StoreOgCardV2({ model, logoImage, coverImage });
  } else if (model?.renderer === 'fallback') {
    card = StoreOgFallbackCard({ model });
  } else {
    throw new TypeError('Unknown Open Graph card model.');
  }

  return new ImageResponseImpl(
    card,
    {
      width: OPEN_GRAPH_IMAGE_WIDTH,
      height: OPEN_GRAPH_IMAGE_HEIGHT,
      status,
    },
  );
}

export function validateNonEmptyPng(bytes) {
  const png = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (png.byteLength <= MINIMUM_PNG_BYTES) {
    throw new TypeError('Open Graph renderer produced an empty or undersized PNG.');
  }
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (png[index] !== PNG_SIGNATURE[index]) {
      throw new TypeError('Open Graph renderer produced an invalid PNG signature.');
    }
  }
  return png;
}

export async function materializeStoreOgImage({
  ImageResponseImpl,
  model,
  logoImage = null,
  coverImage = null,
  status,
  headers,
}) {
  const imageResponse = renderStoreOgImage({
    ImageResponseImpl,
    model,
    logoImage,
    coverImage,
    status,
  });
  const bytes = validateNonEmptyPng(new Uint8Array(await imageResponse.arrayBuffer()));
  return new Response(bytes, { status, headers });
}

export function createStoreOgHandler({
  portalClient,
  imageLoader,
  ImageResponseImpl,
  imageResponseLoader = loadImageResponse,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  logger = globalThis.console,
} = {}) {
  return async function handleStoreOg(request) {
    const parsedRequest = parseRequest(request);
    if (parsedRequest.method !== 'GET' && parsedRequest.method !== 'HEAD') {
      return methodNotAllowed();
    }

    let result;
    let responseStatus = 200;
    if (!parsedRequest.slug) {
      responseStatus = 400;
      result = Object.freeze({ status: 'unavailable', reason: 'invalid_slug' });
    } else {
      try {
        const client = portalClient || createPublicPortalSocialClient({
          supabaseUrl: environment?.VITE_SUPABASE_URL,
          publishableKey: environment?.VITE_SUPABASE_PUBLISHABLE_KEY,
          fetchImpl,
          timeoutMs: 4_000,
        });
        result = await client.getPortalBySlug(parsedRequest.slug);
      } catch {
        result = Object.freeze({ status: 'unavailable', reason: 'configuration_missing' });
      }
    }

    const cacheControl = cacheFor(result, parsedRequest.requestedVersion);
    const headers = responseHeaders(cacheControl);
    if (parsedRequest.method === 'HEAD') {
      return new Response(null, { status: responseStatus, headers });
    }

    let logoImage = null;
    let coverImage = null;
    if (result.status === 'ok') {
      const loadImage = imageLoader || createSafePublicImageLoader({
        supabaseUrl: environment?.VITE_SUPABASE_URL,
        fetchImpl,
      });
      [logoImage, coverImage] = await Promise.all([
        loadImage(result.portal.logoUrl),
        loadImage(result.portal.coverImageUrl),
      ]);
    }

    let ResolvedImageResponseImpl;
    try {
      ResolvedImageResponseImpl = ImageResponseImpl || await imageResponseLoader();
    } catch {
      reportRenderFailure(logger, 'image_response_unavailable');
      return new Response('Open Graph image unavailable.', {
        status: 500,
        headers: FINAL_ERROR_HEADERS,
      });
    }

    const attempts = buildStoreOgRenderAttempts({ result, logoImage, coverImage });
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const degraded = index > 0;
      try {
        return await materializeStoreOgImage({
          ImageResponseImpl: ResolvedImageResponseImpl,
          model: attempt.model,
          logoImage: attempt.logoImage,
          coverImage: attempt.coverImage,
          status: responseStatus,
          headers: degraded ? responseHeaders(TEMPORARY_CACHE) : headers,
        });
      } catch {
        reportRenderFailure(logger, attempt.name);
      }
    }

    return new Response('Open Graph image unavailable.', {
      status: 500,
      headers: FINAL_ERROR_HEADERS,
    });
  };
}

const handler = createStoreOgHandler();

export default {
  fetch(request) {
    return handler(request);
  },
};
