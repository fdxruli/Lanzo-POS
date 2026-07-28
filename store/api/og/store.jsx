import { ImageResponse } from '@vercel/og';
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
  StoreOgCard,
  buildStoreOgCardModel,
} from '../_storeOgCard.js';

export const VERSIONED_CACHE = 'public, max-age=31536000, immutable';
export const REVALIDATED_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
export const NOT_FOUND_CACHE = 'public, max-age=0, s-maxage=300';
export const TEMPORARY_CACHE = 'public, max-age=0, s-maxage=60';

const BASE_HEADERS = Object.freeze({
  'Content-Type': 'image/png',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
});

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
    requestedVersion != null
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

export function createStoreOgHandler({
  portalClient,
  imageLoader,
  ImageResponseImpl = ImageResponse,
  environment = process.env,
  fetchImpl = globalThis.fetch,
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

    const model = buildStoreOgCardModel({ result, logoImage, coverImage });
    return new ImageResponseImpl(
      StoreOgCard({ model }),
      {
        width: OPEN_GRAPH_IMAGE_WIDTH,
        height: OPEN_GRAPH_IMAGE_HEIGHT,
        status: responseStatus,
        headers,
      },
    );
  };
}

const handler = createStoreOgHandler();

export default {
  fetch(request) {
    return handler(request);
  },
};
