import { createPublicPortalSocialClient } from './_publicPortal.js';
import {
  parsePublicStoreOrigins,
  resolvePublicRequestOrigin,
} from './_publicRequestOrigin.js';
import { renderSocialHead } from './_socialHead.js';
import {
  buildGenericStoreSocialMetadata,
  buildStoreSocialMetadata,
  validateStoreSlug,
} from './_socialMetadata.js';
import {
  injectSocialHead,
  validateStoreHtmlTemplate,
} from './_storeHtmlTemplate.js';

export const REVALIDATED_HTML_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
export const NOT_FOUND_HTML_CACHE = 'public, max-age=0, s-maxage=300';
export const TEMPORARY_HTML_CACHE = 'public, max-age=0, s-maxage=60';
export const OPEN_GRAPH_RENDER_REVISION = 4;

const NO_STORE = 'no-store';
const ROBOTS_POLICY = 'noindex, nofollow, noarchive';
const FINAL_ERROR_BODY = 'Store page temporarily unavailable.';

const htmlHeaders = (cacheControl, extra = {}) => ({
  'Cache-Control': cacheControl,
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': ROBOTS_POLICY,
  ...extra,
});

const textHeaders = (cacheControl, extra = {}) => ({
  'Cache-Control': cacheControl,
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': ROBOTS_POLICY,
  ...extra,
});

function hasRequestBody(request) {
  const contentLength = request?.headers?.get?.('content-length');
  if (contentLength != null && contentLength !== '') {
    if (!/^\d+$/u.test(contentLength.trim())) return true;
    if (Number(contentLength) !== 0) return true;
  }
  return request?.headers?.has?.('transfer-encoding') === true;
}

function parseStorePageRequest(request) {
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return Object.freeze({ method, slug: null, invalidQuery: true });
  }

  const slugValues = url.searchParams.getAll('slug');
  const hasNestedSlug = Array.from(url.searchParams.keys())
    .some((key) => key !== 'slug' && /^slug(?:\[|\.)/u.test(key));
  let slug = null;
  if (slugValues.length === 1 && !hasNestedSlug) {
    try {
      slug = validateStoreSlug(slugValues[0]);
    } catch {
      slug = null;
    }
  }
  return Object.freeze({
    method,
    slug,
    invalidQuery: slugValues.length !== 1 || hasNestedSlug || slug == null,
  });
}

function cacheForResult(result) {
  if (result?.status === 'ok') return REVALIDATED_HTML_CACHE;
  if (result?.status === 'not_found') return NOT_FOUND_HTML_CACHE;
  return TEMPORARY_HTML_CACHE;
}

async function loadGeneratedTemplate() {
  const generated = await import('../generated/storeHtmlTemplate.js');
  return generated.STORE_HTML_TEMPLATE;
}

function finalTemplateError() {
  return new Response(FINAL_ERROR_BODY, {
    status: 500,
    headers: textHeaders(NO_STORE),
  });
}

export function createStorePageHandler({
  portalClient,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  templateLoader = loadGeneratedTemplate,
  metadataBuilder = buildStoreSocialMetadata,
  genericMetadataBuilder = buildGenericStoreSocialMetadata,
  socialHeadRenderer = renderSocialHead,
} = {}) {
  return async function handleStorePage(request) {
    const parsed = parseStorePageRequest(request);
    if (parsed.method !== 'GET' && parsed.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: textHeaders(NO_STORE, { Allow: 'GET, HEAD' }),
      });
    }

    let template;
    try {
      template = await templateLoader();
      validateStoreHtmlTemplate(template);
    } catch {
      return finalTemplateError();
    }

    const invalidRequest = parsed.invalidQuery || hasRequestBody(request);
    let result;
    let publicOrigin = null;
    let status = invalidRequest ? 400 : 200;

    if (invalidRequest) {
      result = Object.freeze({ status: 'unavailable', reason: 'invalid_request' });
    } else {
      try {
        const allowedOrigins = parsePublicStoreOrigins(environment?.PUBLIC_STORE_ORIGINS);
        publicOrigin = resolvePublicRequestOrigin({ request, allowedOrigins });
      } catch {
        result = Object.freeze({ status: 'unavailable', reason: 'invalid_origin' });
      }

      if (!result) {
        try {
          const client = portalClient || createPublicPortalSocialClient({
            supabaseUrl: environment?.VITE_SUPABASE_URL,
            publishableKey: environment?.VITE_SUPABASE_PUBLISHABLE_KEY,
            fetchImpl,
            timeoutMs: 4_000,
          });
          result = await client.getPortalBySlug(parsed.slug);
        } catch {
          result = Object.freeze({ status: 'unavailable', reason: 'configuration_missing' });
        }
      }
    }

    let cacheControl = invalidRequest ? NO_STORE : cacheForResult(result);
    const headers = htmlHeaders(cacheControl);
    if (parsed.method === 'HEAD') {
      return new Response(null, { status, headers });
    }

    try {
      let metadata;
      if (result.status === 'ok' && publicOrigin) {
        try {
          metadata = metadataBuilder({
            publicOrigin,
            slug: parsed.slug,
            portal: result.portal,
            siteVersionNumber: result.siteVersionNumber,
            renderRevision: OPEN_GRAPH_RENDER_REVISION,
          });
        } catch {
          result = Object.freeze({ status: 'unavailable', reason: 'metadata_failure' });
          cacheControl = TEMPORARY_HTML_CACHE;
        }
      }
      if (!metadata) {
        metadata = genericMetadataBuilder({
          status: result.status === 'not_found' ? 'not_found' : 'unavailable',
        });
      }

      const html = injectSocialHead(template, socialHeadRenderer(metadata));
      return new Response(html, {
        status,
        headers: htmlHeaders(cacheControl),
      });
    } catch {
      return finalTemplateError();
    }
  };
}

const handler = createStorePageHandler();

export default {
  fetch(request) {
    return handler(request);
  },
};
