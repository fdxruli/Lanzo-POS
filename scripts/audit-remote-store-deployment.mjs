/**
 * Read-only, sanitized validation of a lanzo-store Vercel preview.
 *
 * Usage:
 *   node scripts/audit-remote-store-deployment.mjs \
 *     --base-url https://<preview>.vercel.app --slug <public-test-slug>
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStoreSlug } from '../store/api/_socialMetadata.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_EVIDENCE_PATH = path.join(projectRoot, '.tmp', 'social-preview-1.7-evidence.json');
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const NOINDEX = 'noindex, nofollow, noarchive';
const INVALID_SLUG = 'INVALIDO';
const MISSING_SLUG = 'slug-inexistente-controlado';
const TRACKING_TOKEN = 'token-ficticio';
const DEFAULT_PRODUCTION_HOSTS = Object.freeze(['lanzo-store.vercel.app']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function parseCacheControl(value) {
  const directives = new Map();
  for (const part of String(value || '').split(',')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    const name = rawName.toLowerCase();
    if (!name) continue;
    directives.set(name, rawValue.join('=').replace(/^"|"$/gu, '').trim() || true);
  }
  const integer = (name) => {
    const candidate = directives.get(name);
    return typeof candidate === 'string' && /^\d+$/u.test(candidate)
      ? Number(candidate)
      : null;
  };
  return Object.freeze({
    public: directives.has('public'),
    private: directives.has('private'),
    noStore: directives.has('no-store'),
    immutable: directives.has('immutable'),
    staleWhileRevalidate: directives.has('stale-while-revalidate'),
    maxAge: integer('max-age'),
    sharedMaxAge: integer('s-maxage'),
  });
}

export function validateCacheControl(value, policy) {
  const cache = parseCacheControl(value);
  if (policy === 'og-unversioned') {
    return cache.public
      && !cache.private
      && !cache.noStore
      && !cache.immutable
      && cache.maxAge === 0
      && cache.sharedMaxAge === 300
      && cache.staleWhileRevalidate;
  }
  if (policy === 'og-versioned' || policy === 'hashed-asset') {
    return cache.public
      && !cache.private
      && !cache.noStore
      && cache.immutable
      && cache.maxAge === 31_536_000
      && cache.sharedMaxAge !== 300;
  }
  if (policy === 'dynamic-html') {
    return cache.public
      && !cache.private
      && !cache.noStore
      && !cache.immutable
      && cache.sharedMaxAge === 300;
  }
  throw new Error(`Unknown cache policy: ${policy}.`);
}

const REQUIRED_METADATA = Object.freeze({
  title: /<title\b[^>]*>([\s\S]*?)<\/title>/giu,
  description: /<meta\b(?=[^>]*\bname=["']description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  canonical: /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']*)["'][^>]*>/giu,
  ogTitle: /<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  ogDescription: /<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  ogUrl: /<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  ogImage: /<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  ogType: /<meta\b(?=[^>]*\bproperty=["']og:type["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  twitterCard: /<meta\b(?=[^>]*\bname=["']twitter:card["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  twitterTitle: /<meta\b(?=[^>]*\bname=["']twitter:title["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  twitterDescription: /<meta\b(?=[^>]*\bname=["']twitter:description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
  twitterImage: /<meta\b(?=[^>]*\bname=["']twitter:image["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/giu,
});

const SECURITY_MARKERS = Object.freeze([
  ['LanzoDB', /LanzoDB/u],
  ['PosPage', /PosPage/u],
  ['CajaPage', /CajaPage/u],
  ['processSale', /processSale/u],
  ['cashSync', /cashSync/u],
  ['posSync', /posSync/u],
  ['device_security_token', /device_security_token/u],
  ['staff_session_token', /staff_session_token/u],
  ['create_free_trial_license', /create_free_trial_license/u],
  ['releaseDeviceAnon', /releaseDeviceAnon|release_device_anon/u],
  ['googleDrive', /googleDrive/u],
  ['sb_secret_', /\bsb_secret_[A-Za-z0-9_-]{8,}\b/u],
  ['ghp_', /\bghp_[A-Za-z0-9]{12,}\b/u],
  ['github_pat_', /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u],
  ['vcp_', /\bvcp_[A-Za-z0-9_-]{12,}\b/u],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
]);

function valuesFor(html, pattern) {
  return Array.from(html.matchAll(new RegExp(pattern.source, pattern.flags)), (match) => match[1] || '');
}

function safeUrlHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.hostname : null;
  } catch {
    return null;
  }
}

export function validatePreviewUrl(value, { productionHosts = DEFAULT_PRODUCTION_HOSTS } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The preview URL is invalid.');
  }
  if (
    url.protocol !== 'https:'
    || !url.hostname.endsWith('.vercel.app')
    || url.hostname === 'vercel.app'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('Only an HTTPS Vercel preview origin is accepted.');
  }
  if (productionHosts.includes(url.hostname)) {
    throw new Error('Production deployments are forbidden.');
  }
  return url;
}

export function validatePreviewDeploymentPlan({
  projectName,
  deploymentType,
  production,
  previousPreviewDeployments,
  commandArgs,
} = {}) {
  if (projectName !== 'lanzo-store') throw new Error('The deployment project must be lanzo-store.');
  if (deploymentType !== 'preview' || production !== false) {
    throw new Error('Production deployments are forbidden.');
  }
  if (previousPreviewDeployments !== 0) {
    throw new Error('Only one preview deployment is allowed.');
  }
  if (JSON.stringify(commandArgs) !== JSON.stringify(['deploy', '--prebuilt', '--yes'])) {
    throw new Error('Only vercel deploy --prebuilt --yes is allowed.');
  }
  return Object.freeze({
    projectName,
    deploymentType,
    production,
    previousPreviewDeployments,
    commandArgs: Object.freeze([...commandArgs]),
  });
}

export function parseAuditArguments(argv = process.argv.slice(2)) {
  const allowed = new Set([
    '--base-url', '--slug', '--evidence-path', '--head', '--artifact-audit',
    '--deployment-id-hash', '--deployment-created-by-this-run',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value == null || value.startsWith('--')) {
      throw new Error('Expected --base-url, --slug and optional --evidence-path/--head.');
    }
    if (values[flag] != null) throw new Error(`Duplicate argument: ${flag}.`);
    values[flag] = value;
  }
  if (!values['--base-url'] || !values['--slug']) {
    throw new Error('--base-url and --slug are required.');
  }
  if (
    values['--deployment-created-by-this-run'] != null
    && !['true', 'false'].includes(values['--deployment-created-by-this-run'])
  ) {
    throw new Error('--deployment-created-by-this-run must be true or false.');
  }
  validateStoreSlug(values['--slug']);
  return Object.freeze({
    baseUrl: validatePreviewUrl(values['--base-url']),
    slug: values['--slug'],
    evidencePath: path.resolve(values['--evidence-path'] || DEFAULT_EVIDENCE_PATH),
    head: values['--head'] || null,
    artifactAuditPath: values['--artifact-audit']
      ? path.resolve(values['--artifact-audit'])
      : null,
    deploymentIdHash: values['--deployment-id-hash'] || null,
    deploymentCreatedByThisRun: values['--deployment-created-by-this-run'] == null
      ? null
      : values['--deployment-created-by-this-run'] === 'true',
  });
}

export function inspectSocialHtml(html) {
  if (typeof html !== 'string') throw new TypeError('HTML must be text.');
  const metadata = {};
  const counts = {};
  for (const [name, pattern] of Object.entries(REQUIRED_METADATA)) {
    const values = valuesFor(html, pattern);
    counts[name] = values.length;
    metadata[name] = values[0] || null;
  }
  const assetPaths = [
    ...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/giu),
  ].map((match) => match[1]);
  const canonicalPath = metadata.canonical ? new URL(metadata.canonical).pathname : null;
  const canonicalSlug = /^\/tienda\/([^/]+)$/u.exec(canonicalPath || '')?.[1] || null;
  return Object.freeze({
    bytes: Buffer.byteLength(html),
    sha256: sha256(html),
    doctype: /^\s*<!doctype html>/iu.test(html),
    langEsMx: /<html\b[^>]*\blang=["']es-MX["']/iu.test(html),
    rootCount: (html.match(/\bid=["']root["']/giu) || []).length,
    counts: Object.freeze(counts),
    valueHashes: Object.freeze(Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [name, value == null ? null : sha256(value)]),
    )),
    valueLengths: Object.freeze(Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [name, value == null ? 0 : value.length]),
    )),
    canonicalHost: safeUrlHost(metadata.canonical),
    ogImageHost: safeUrlHost(metadata.ogImage),
    canonicalPath,
    ogUrlPath: metadata.ogUrl ? new URL(metadata.ogUrl).pathname : null,
    effectiveSlug: canonicalSlug,
    slugValues: Object.freeze(canonicalSlug ? [canonicalSlug] : []),
    assetPaths: [...new Set(assetPaths)].sort(),
    forbiddenPrivateData: /(?:\b(?:wa\.me|whatsapp)\b|mailto:|@[\w.-]+\.[a-z]{2,}|(?:calle|domicilio|direcci[oó]n)\s*:|(?:\+?52)?\s*\d{10})/iu.test(html),
    stackTrace: /\b(?:Error:|at\s+\w+\s*\(|node:internal\/)/u.test(html),
    supabaseUrl: /https:\/\/[a-z0-9-]+\.supabase\.co/iu.test(html),
    fullHtml: undefined,
  });
}

function serviceRoleJwtMarkers(source, route) {
  const findings = [];
  for (const candidate of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu) || []) {
    try {
      const payload = JSON.parse(Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') {
        findings.push({
          marker: 'service_role JWT',
          classification: 'credential',
          relativeRoute: route,
          valueLength: candidate.length,
        });
      }
    } catch {
      // Invalid token-shaped vocabulary is not a credential.
    }
  }
  return findings;
}

export function inspectSecurityMarkers(source, relativeRoute) {
  if (typeof source !== 'string') return [];
  const findings = SECURITY_MARKERS.flatMap(([marker, pattern]) => {
    const match = pattern.exec(source);
    return match ? [{
      marker,
      classification: marker === 'LanzoDB' || marker.endsWith('Page')
        || ['processSale', 'cashSync', 'posSync', 'create_free_trial_license', 'releaseDeviceAnon', 'googleDrive']
          .includes(marker)
        ? 'administrative-code'
        : 'credential',
      relativeRoute,
      valueLength: match[0].length,
    }] : [];
  });
  return [...findings, ...serviceRoleJwtMarkers(source, relativeRoute)];
}

export function inspectPng(bytes) {
  const data = Buffer.from(bytes);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = data.length >= 24 && data.subarray(0, 8).equals(signature);
  return Object.freeze({
    png,
    width: png ? data.readUInt32BE(16) : null,
    height: png ? data.readUInt32BE(20) : null,
    bytes: data.length,
    sha256: sha256(data),
  });
}

function sanitizedHeaders(headers) {
  const location = headers.get('location') || '';
  let locationPath = '';
  try {
    const parsed = new URL(location, 'https://preview.invalid');
    locationPath = `${parsed.pathname}${parsed.search}`;
  } catch {
    locationPath = '';
  }
  return Object.freeze({
    contentType: headers.get('content-type') || '',
    cacheControl: headers.get('cache-control') || '',
    xRobotsTag: headers.get('x-robots-tag') || '',
    locationHost: safeUrlHost(location),
    locationPath,
  });
}

async function fetchBounded(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, redirect: 'manual' });
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength
    && /^\d+$/u.test(declaredLength)
    && Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    throw new Error('Remote response exceeds the audit limit.');
  }
  const chunks = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader?.();
    if (!reader) throw new Error('Remote response body cannot be read safely.');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Remote response exceeds the audit limit.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { response, bytes, headers: sanitizedHeaders(response.headers) };
}

function metadataPass(inspection, slug) {
  return inspection.doctype
    && inspection.langEsMx
    && inspection.rootCount === 1
    && Object.values(inspection.counts).every((count) => count === 1)
    && inspection.canonicalPath === `/tienda/${slug}`
    && inspection.ogUrlPath === `/tienda/${slug}`
    && inspection.canonicalHost
    && inspection.canonicalHost === inspection.ogImageHost
    && inspection.assetPaths.some((item) => item.endsWith('.js'))
    && inspection.assetPaths.some((item) => item.endsWith('.css'))
    && !inspection.forbiddenPrivateData
    && !inspection.stackTrace
    && !inspection.supabaseUrl;
}

function addCheck(checks, name, passed, detail = null) {
  checks.push(Object.freeze({ name, passed: Boolean(passed), detail }));
}

export async function auditRemoteStoreDeployment({
  baseUrl,
  slug,
  fetchImpl = globalThis.fetch,
  localIndexPath = path.join(projectRoot, 'store', 'dist', 'index.html'),
} = {}) {
  const origin = validatePreviewUrl(baseUrl instanceof URL ? baseUrl.href : baseUrl);
  validateStoreSlug(slug);
  const localIndex = await readFile(localIndexPath);
  const localIndexHash = sha256(localIndex);
  const localHtml = localIndex.toString('utf8');
  const assetPath = inspectSocialHtml(localHtml).assetPaths[0];
  if (!assetPath) throw new Error('The local store build has no hashed asset.');

  const paths = Object.freeze({
    root: '/',
    tienda: '/tienda',
    store: `/tienda/${slug}`,
    storeSlash: `/tienda/${slug}/`,
    storeUtm: `/tienda/${slug}?utm_source=whatsapp`,
    hostileSingle: `/tienda/${slug}?slug=externo`,
    hostileMultiple: `/tienda/${slug}?slug=externo&slug=otro`,
    tracking: `/tienda/${slug}/pedido/${TRACKING_TOKEN}`,
    nested: `/tienda/${slug}/ruta-desconocida`,
    apiStore: `/api/store-page?slug=${encodeURIComponent(slug)}`,
    og: `/api/og/store?slug=${encodeURIComponent(slug)}`,
    ogVersioned: `/api/og/store?slug=${encodeURIComponent(slug)}&v=1`,
    asset: assetPath,
    missingStore: `/tienda/${MISSING_SLUG}`,
    missingApi: `/api/store-page?slug=${MISSING_SLUG}`,
    invalidApi: `/api/store-page?slug=${INVALID_SLUG}`,
  });
  const checks = [];
  const requests = [];
  const securityFindings = [];

  async function request(name, requestPath, method = 'GET') {
    const { response, bytes, headers } = await fetchBounded(
      fetchImpl,
      new URL(requestPath, origin),
      { method },
    );
    const contentType = headers.contentType.split(';')[0].trim().toLowerCase();
    const text = method === 'HEAD' || contentType.startsWith('image/')
      ? null
      : Buffer.from(bytes).toString('utf8');
    if (text != null) securityFindings.push(...inspectSecurityMarkers(text, name));
    const item = {
      name,
      method,
      status: response.status,
      headers,
      bytes: bytes.byteLength,
      bodySha256: bytes.byteLength ? sha256(bytes) : null,
      contentType,
      text,
      rawBytes: bytes,
    };
    requests.push(item);
    return item;
  }

  const root = await request('root', paths.root);
  const tienda = await request('tienda', paths.tienda);
  for (const item of [root, tienda]) {
    addCheck(checks, `${item.name}:static`, item.status === 200
      && item.bodySha256 === localIndexHash
      && item.headers.cacheControl === STATIC_CACHE
      && item.headers.xRobotsTag === NOINDEX);
  }

  const store = await request('store', paths.store);
  const storeHtml = inspectSocialHtml(store.text || '');
  addCheck(checks, 'store:metadata', store.status === 200
    && store.contentType === 'text/html'
    && store.headers.xRobotsTag === NOINDEX
    && validateCacheControl(store.headers.cacheControl, 'dynamic-html')
    && metadataPass(storeHtml, slug));
  const storeHead = await request('store-head', paths.store, 'HEAD');
  addCheck(checks, 'store:head', storeHead.status === 200
    && storeHead.contentType === 'text/html'
    && validateCacheControl(storeHead.headers.cacheControl, 'dynamic-html'));

  const storeSlash = await request('store-slash', paths.storeSlash);
  addCheck(checks, 'store:trailing-slash', storeSlash.status === 308
    && storeSlash.headers.locationPath === `/tienda/${slug}`);

  const queryResults = [];
  for (const [name, requestPath] of [
    ['store-utm', paths.storeUtm],
    ['hostile-single', paths.hostileSingle],
    ['hostile-multiple', paths.hostileMultiple],
  ]) {
    const item = await request(name, requestPath);
    const inspection = inspectSocialHtml(item.text || '');
    queryResults.push({ name, inspection });
    addCheck(checks, `${name}:path-authoritative`, item.status === 200
      && inspection.valueHashes.title === storeHtml.valueHashes.title
      && inspection.valueHashes.canonical === storeHtml.valueHashes.canonical
      && inspection.canonicalPath === storeHtml.canonicalPath
      && inspection.valueHashes.ogUrl === storeHtml.valueHashes.ogUrl
      && inspection.valueHashes.ogImage === storeHtml.valueHashes.ogImage
      && inspection.valueHashes.twitterImage === storeHtml.valueHashes.twitterImage
      && inspection.canonicalHost === storeHtml.canonicalHost
      && inspection.ogImageHost === storeHtml.ogImageHost
      && JSON.stringify(inspection.slugValues) === JSON.stringify([slug]));
  }

  for (const [name, requestPath] of [['tracking', paths.tracking], ['nested', paths.nested]]) {
    const item = await request(name, requestPath);
    const inspection = inspectSocialHtml(item.text || '');
    addCheck(checks, `${name}:static-fallback`, item.status === 200
      && item.bodySha256 === localIndexHash
      && item.headers.cacheControl === STATIC_CACHE
      && inspection.counts.canonical === 0
      && inspection.counts.ogUrl === 0
      && !(item.text || '').includes(TRACKING_TOKEN));
  }

  const apiStore = await request('api-store', paths.apiStore);
  const apiHtml = inspectSocialHtml(apiStore.text || '');
  addCheck(checks, 'api-store:metadata', apiStore.status === 200
    && apiHtml.valueHashes.canonical === storeHtml.valueHashes.canonical);

  const missingStore = await request('missing-store', paths.missingStore);
  const missingApi = await request('missing-api', paths.missingApi);
  for (const item of [missingStore, missingApi]) {
    const inspection = inspectSocialHtml(item.text || '');
    addCheck(checks, `${item.name}:generic`, item.status === 200
      && item.contentType === 'text/html'
      && inspection.counts.title === 1
      && inspection.counts.canonical === 0
      && !inspection.stackTrace
      && validateCacheControl(item.headers.cacheControl, 'dynamic-html'));
  }

  const invalidApi = await request('invalid-api', paths.invalidApi);
  addCheck(checks, 'invalid-api:safe', invalidApi.status === 400
    && invalidApi.headers.cacheControl === 'no-store'
    && !/Error:|node:internal|supabase/iu.test(invalidApi.text || ''));

  let ogInspection = null;
  for (const [name, requestPath] of [['og', paths.og], ['og-versioned', paths.ogVersioned]]) {
    const item = await request(name, requestPath);
    const inspection = inspectPng(item.rawBytes);
    if (name === 'og') ogInspection = inspection;
    addCheck(checks, `${name}:png`, item.status === 200
      && item.contentType === 'image/png'
      && inspection.png
      && inspection.width === 1200
      && inspection.height === 630
      && inspection.bytes > 1_000
      && !item.headers.locationHost
      && validateCacheControl(
        item.headers.cacheControl,
        name === 'og' ? 'og-unversioned' : 'og-versioned',
      ));
  }
  const ogHead = await request('og-head', paths.og, 'HEAD');
  addCheck(checks, 'og:head', ogHead.status === 200 && ogHead.contentType === 'image/png');

  const asset = await request('asset', paths.asset);
  addCheck(checks, 'asset:immutable', asset.status === 200
    && validateCacheControl(asset.headers.cacheControl, 'hashed-asset')
    && asset.bodySha256 === sha256(await readFile(path.join(path.dirname(localIndexPath), paths.asset.slice(1)))));
  const assetHead = await request('asset-head', paths.asset, 'HEAD');
  addCheck(checks, 'asset:head', assetHead.status === 200
    && validateCacheControl(assetHead.headers.cacheControl, 'hashed-asset'));

  addCheck(checks, 'security:no-markers', securityFindings.length === 0);
  const failedChecks = checks.filter((item) => !item.passed).map((item) => item.name);
  return Object.freeze({
    status: failedChecks.length === 0 ? 'PASS' : 'BLOCKED',
    previewHost: origin.hostname,
    requests: requests.map(({ name, method, status, headers, bytes, bodySha256, contentType }) => ({
      name, method, status, headers, bytes, bodySha256, contentType,
    })),
    metadata: storeHtml,
    hostileQueries: queryResults.map(({ name, inspection }) => ({
      name,
      canonicalHash: inspection.valueHashes.canonical,
      ogUrlHash: inspection.valueHashes.ogUrl,
      ogImageHash: inspection.valueHashes.ogImage,
      twitterImageHash: inspection.valueHashes.twitterImage,
      canonicalPath: inspection.canonicalPath,
      canonicalHost: inspection.canonicalHost,
      ogImageHost: inspection.ogImageHost,
      slugValues: inspection.slugValues,
    })),
    ogImage: ogInspection,
    security: {
      passed: securityFindings.length === 0,
      findings: securityFindings,
      scannedResponses: requests.filter((item) => item.text != null).length,
    },
    checks,
    failedChecks,
  });
}

export function buildEvidenceReport({
  head,
  artifact,
  remote,
  deployment,
  timestamp = new Date().toISOString(),
} = {}) {
  if (!/^[a-f0-9]{40}$/u.test(head || '')) throw new Error('A full Git HEAD is required.');
  if (artifact?.status !== 'PASS') throw new Error('Artifact audit must be PASS.');
  if (artifact?.target !== 'store') throw new Error('Artifact target must be store.');
  if (!Array.isArray(artifact?.failedChecks) || artifact.failedChecks.length !== 0) {
    throw new Error('Artifact audit must have no failed checks.');
  }
  if (remote?.status !== 'PASS') throw new Error('Remote audit must be PASS.');
  if (!Array.isArray(remote?.failedChecks) || remote.failedChecks.length !== 0) {
    throw new Error('Remote audit must have no failed checks.');
  }
  if ('deploymentExecuted' in remote) {
    throw new Error('Deployment execution must come from deployment evidence.');
  }
  if (!deployment || typeof deployment !== 'object') {
    throw new Error('Deployment evidence is required.');
  }
  if (deployment.projectName !== 'lanzo-store') {
    throw new Error('Deployment project must be lanzo-store.');
  }
  if (deployment.type !== 'preview' || deployment.production !== false) {
    throw new Error('Deployment evidence must describe a non-production preview.');
  }
  if (typeof deployment.executed !== 'boolean') {
    throw new Error('Deployment execution evidence must be explicit.');
  }
  if (!/^[a-f0-9]{64}$/u.test(deployment.deploymentIdHash || '')) {
    throw new Error('Deployment ID hash is required.');
  }
  const previewUrl = validatePreviewUrl(`https://${deployment.previewHost || ''}`);
  if (previewUrl.hostname !== remote.previewHost) {
    throw new Error('Deployment and audited preview hosts must match.');
  }
  const detailedChecks = new Map(
    (remote.checks || []).map((check) => [check?.name, check?.passed === true]),
  );
  const passed = (...names) => names.every((name) => detailedChecks.get(name) === true);
  const metadataUnique = passed('store:metadata')
    && Object.values(remote.metadata?.counts || {}).length > 0
    && Object.values(remote.metadata.counts).every((count) => count === 1)
    && typeof remote.metadata.effectiveSlug === 'string'
    && remote.metadata.canonicalPath === `/tienda/${remote.metadata.effectiveSlug}`
    && remote.metadata.ogUrlPath === remote.metadata.canonicalPath;
  const ogImagePassed = passed('og:png', 'og-versioned:png', 'og:head')
    && remote.ogImage?.png === true
    && remote.ogImage?.width === 1200
    && remote.ogImage?.height === 630
    && Number.isSafeInteger(remote.ogImage?.bytes)
    && remote.ogImage.bytes > 0
    && /^[a-f0-9]{64}$/u.test(remote.ogImage?.sha256 || '');
  const checks = Object.freeze({
    metadataUnique,
    canonicalConsistent: passed(
      'store:metadata',
      'api-store:metadata',
      'store-utm:path-authoritative',
      'hostile-single:path-authoritative',
      'hostile-multiple:path-authoritative',
    ),
    ogImageConsistent: ogImagePassed
      && remote.metadata?.canonicalHost === remote.previewHost
      && remote.metadata?.ogImageHost === remote.previewHost,
    cachePassed: passed(
      'root:static',
      'tienda:static',
      'store:metadata',
      'store:head',
      'og:png',
      'og-versioned:png',
      'tracking:static-fallback',
      'nested:static-fallback',
      'asset:immutable',
      'asset:head',
      'invalid-api:safe',
    ),
    trackingPassed: passed('tracking:static-fallback'),
    hostileQueryPassed: passed(
      'store-utm:path-authoritative',
      'hostile-single:path-authoritative',
      'hostile-multiple:path-authoritative',
    ),
    missingStorePassed: passed('missing-store:generic', 'missing-api:generic'),
    invalidSlugPassed: passed('invalid-api:safe'),
    securityPassed: passed('security:no-markers')
      && remote.security?.passed === true
      && Array.isArray(remote.security?.findings)
      && remote.security.findings.length === 0,
  });
  if (Object.values(checks).some((check) => check !== true)) {
    throw new Error('Remote audit summary checks must all be derived as PASS.');
  }
  const report = {
    schemaVersion: 1,
    phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
    timestamp,
    HEAD: head,
    status: 'PASS',
    evidenceStatus: 'PASS',
    projectName: deployment.projectName,
    deploymentType: deployment.type,
    previewHost: previewUrl.hostname,
    deploymentIdHash: deployment.deploymentIdHash,
    artifactHashes: {
      config: artifact.hashes.outputConfig,
      static: artifact.hashes.outputStaticTree,
    },
    functions: artifact.output.functions,
    runtimes: artifact.functionAudit.bundles.map(({ route, runtime }) => ({ route, runtime })),
    handlers: artifact.functionAudit.bundles.map(({ route, handler }) => ({ route, handler })),
    routingChecks: artifact.routing.checks,
    httpStatuses: remote.requests.map(({ name, method, status }) => ({ name, method, status })),
    headerChecks: remote.requests.map(({ name, headers }) => ({
      name,
      headers: {
        contentType: headers.contentType,
        cacheControl: headers.cacheControl,
        xRobotsTag: headers.xRobotsTag,
        locationHost: headers.locationHost,
      },
    })),
    metadataTagCounts: remote.metadata.counts,
    canonicalHost: remote.metadata.canonicalHost,
    ogImageHost: remote.metadata.ogImageHost,
    ogImage: {
      passed: ogImagePassed,
      width: remote.ogImage.width,
      height: remote.ogImage.height,
      bytes: remote.ogImage.bytes,
    },
    ogImageSha256: remote.ogImage.sha256,
    checks,
    securityCheckSummary: {
      passed: remote.security.passed,
      scannedResponses: remote.security.scannedResponses,
      findings: remote.security.findings,
    },
    failedChecks: remote.failedChecks,
    deploymentExecuted: deployment.executed,
    deploymentCreatedByThisRun: deployment.executed,
    previewAudited: true,
    productionModified: false,
  };
  const serialized = JSON.stringify(report);
  if (/<(?:!doctype|html|head|body)\b|authorization|cookie|@[\w.-]+\.[a-z]{2,}/iu.test(serialized)) {
    throw new Error('Evidence contains forbidden response or private data.');
  }
  return Object.freeze(report);
}

export async function writeEvidenceReport(filePath, report) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return filePath;
}

async function main() {
  const input = parseAuditArguments();
  const remote = await auditRemoteStoreDeployment(input);
  let evidenceWritten = false;
  if (input.artifactAuditPath || input.head) {
    if (
      !input.artifactAuditPath
      || !input.head
      || !input.deploymentIdHash
      || input.deploymentCreatedByThisRun == null
    ) {
      throw new Error(
        '--artifact-audit, --head, --deployment-id-hash and '
        + '--deployment-created-by-this-run must be supplied together.',
      );
    }
    const artifact = JSON.parse(await readFile(input.artifactAuditPath, 'utf8'));
    const evidence = buildEvidenceReport({
      head: input.head,
      artifact,
      remote,
      deployment: {
        executed: input.deploymentCreatedByThisRun,
        type: 'preview',
        projectName: 'lanzo-store',
        production: false,
        deploymentIdHash: input.deploymentIdHash,
        previewHost: remote.previewHost,
      },
    });
    await writeEvidenceReport(input.evidencePath, evidence);
    evidenceWritten = true;
  }
  const summary = {
    phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
    status: remote.status,
    previewHost: remote.previewHost,
    requests: remote.requests,
    metadata: remote.metadata,
    ogImage: remote.ogImage,
    security: remote.security,
    failedChecks: remote.failedChecks,
    evidenceWritten,
    deploymentExecuted: input.deploymentCreatedByThisRun === true,
    productionModified: false,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (remote.status !== 'PASS') process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.7',
      status: 'BLOCKED',
      error: String(error?.message || error).slice(0, 500),
      deploymentExecuted: false,
      productionModified: false,
    })}\n`);
    process.exitCode = 1;
  });
}
