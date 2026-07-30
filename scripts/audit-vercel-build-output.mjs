/**
 * Read-only audit for Vercel Build Output API artifacts.
 *
 * Usage:
 *   node scripts/audit-vercel-build-output.mjs store <temporary-workspace-store-root>
 *   node scripts/audit-vercel-build-output.mjs admin <temporary-package-root>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const NOINDEX = 'noindex, nofollow, noarchive';
const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const EXPECTED_STORE_FUNCTIONS = Object.freeze(['/api/og/store', '/api/store-page']);
const EXPECTED_TRANSITIVE_RUNTIME_MODULES = Object.freeze({
  '/api/og/store': Object.freeze([]),
  '/api/store-page': Object.freeze(['store/generated/storeHtmlTemplate.js']),
});
const EXPECTED_STORE_TARGET_ENVIRONMENT = 'preview';
const STORE_WORKSPACE_PREFIX = 'lanzo-store-social-preview-1-6-';
const targets = Object.freeze({
  store: {
    projectId: 'prj_AVq3FAQMrSmo5E7zkAE23dbBpZW4',
    organizationId: 'team_buvft2mAJErTNR8gDhXcZGfS',
    sourceConfig: path.join(projectRoot, 'store', 'vercel.json'),
    sourceStatic: path.join(projectRoot, 'store', 'dist'),
  },
  admin: {
    projectId: 'prj_tE5uWn6kLBYdS1eDFWVxRm449RUr',
    organizationId: 'team_buvft2mAJErTNR8gDhXcZGfS',
    sourceConfig: path.join(projectRoot, 'vercel.json'),
    sourceStatic: path.join(projectRoot, 'dist'),
  },
});

const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.mjs', '.svg', '.txt',
]);
const executableExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const fontExtensions = new Set(['.otf', '.ttf', '.woff', '.woff2']);
const normalizePath = (value) => value.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function walkOutputFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const metadata = await lstat(absolutePath);
    const relativePath = normalizePath(path.relative(root, absolutePath));
    if (metadata.isSymbolicLink()) throw new Error(`Symbolic link forbidden: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await walkOutputFiles(absolutePath, root));
    else if (entry.isFile()) files.push({ absolutePath, relativePath, bytes: metadata.size });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function manifest(files) {
  return Promise.all(files.map(async (file) => ({
    path: file.relativePath,
    bytes: file.bytes,
    sha256: sha256(await readFile(file.absolutePath)),
  })));
}

function treeHash(items) {
  return sha256(items.map((item) => `${item.sha256}  ${item.path}`).join('\n'));
}

function routeMatches(route, requestPath) {
  if (typeof route?.src !== 'string') return false;
  try {
    return new RegExp(route.src).test(requestPath);
  } catch {
    return false;
  }
}

function matchingRoute(routes, requestPath, predicate = () => true) {
  return routes.find((route) => routeMatches(route, requestPath) && predicate(route));
}

function routeHeader(route, name) {
  if (!route?.headers || typeof route.headers !== 'object') return undefined;
  const key = Object.keys(route.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? route.headers[key] : undefined;
}

function applyCompiledDestination(route, pathname, incomingSearch = '') {
  const match = new RegExp(route.src).exec(pathname);
  if (!match || typeof route.dest !== 'string') return null;
  let destination = route.dest;
  for (let index = 1; index < match.length; index += 1) {
    destination = destination.replaceAll(`$${index}`, match[index] || '');
  }
  if (match.groups) {
    for (const [name, value] of Object.entries(match.groups)) {
      destination = destination.replaceAll(`$${name}`, value || '');
    }
  }
  const parsedDestination = new URL(destination, 'https://store.invalid');
  const effectiveQuery = new URLSearchParams(incomingSearch);
  for (const [name, value] of parsedDestination.searchParams) effectiveQuery.set(name, value);
  return Object.freeze({
    pathname: parsedDestination.pathname,
    query: effectiveQuery,
  });
}

function outputStaticPathname(pathname) {
  return pathname.replace(/^\//u, '');
}

/**
 * Small, deliberately conservative model of the compiled Build Output routing
 * order.  Header routes continue; filesystem ends the request only for an
 * existing static file; redirects and destinations are terminal.
 */
export function evaluateCompiledRoute(routes, pathname, staticPaths = new Set()) {
  const headers = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    if (route.handle === 'filesystem') {
      if (staticPaths.has(outputStaticPathname(pathname))) {
        return { kind: 'filesystem', pathname, index, headers };
      }
      continue;
    }
    if (route.handle === 'error') return { kind: 'error', pathname, index, headers };
    if (!routeMatches(route, pathname)) continue;
    if (route.headers) headers.push({ index, headers: route.headers });
    if (route.status && route.status >= 300 && route.status < 400) {
      return { kind: 'redirect', pathname, index, status: route.status, headers };
    }
    if (typeof route.dest === 'string') {
      const destination = applyCompiledDestination(route, pathname);
      return { kind: 'rewrite', pathname: destination?.pathname || null, index, headers };
    }
  }
  return { kind: 'unmatched', pathname, index: -1, headers };
}

export function inspectCompiledStoreRoutes(outputConfig, { staticPaths = [] } = {}) {
  const routes = Array.isArray(outputConfig?.routes) ? outputConfig.routes : [];
  const staticPathSet = new Set(staticPaths.map(outputStaticPathname));
  const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
  const errorIndex = routes.findIndex((route) => route.handle === 'error');
  const realAsset = [...staticPathSet].find((item) => /^assets\/.*-[A-Za-z0-9_-]{6,}\.js$/u.test(item)) || null;
  const assetPathname = realAsset ? `/${realAsset}` : null;
  const dynamicEvaluation = evaluateCompiledRoute(routes, '/tienda/mi-tienda', staticPathSet);
  const trackingEvaluation = evaluateCompiledRoute(routes, '/tienda/mi-tienda/pedido/token-ficticio', staticPathSet);
  const nestedEvaluation = evaluateCompiledRoute(routes, '/tienda/mi-tienda/ruta-anidada', staticPathSet);
  const assetEvaluation = assetPathname
    ? evaluateCompiledRoute(routes, assetPathname, staticPathSet)
    : null;
  const apiEvaluation = evaluateCompiledRoute(routes, '/api/store-page', staticPathSet);
  const canonicalRoute = routes.find((route) => (
    route.status === 308
    && routeHeader(route, 'Location') === '/$1'
    && typeof route.src === 'string'
    && route.src.includes('(.*)/$')
  ));
  const assetHeader = assetPathname && matchingRoute(
    routes,
    assetPathname,
    (route) => routeHeader(route, 'Cache-Control') === IMMUTABLE_CACHE,
  );
  const htmlImmutable = routes.some((route) => (
    routeHeader(route, 'Cache-Control')?.includes('immutable')
    && (
      routeMatches(route, '/')
      || routeMatches(route, '/index.html')
      || routeMatches(route, '/tienda/mi-tienda')
    )
  ));
  const staticIndexHeader = matchingRoute(
    routes,
    '/index.html',
    (route) => routeHeader(route, 'Cache-Control') === STATIC_CACHE,
  );

  const cases = [
    ['/tienda/mi-tienda', ''],
    ['/tienda/mi-tienda', '?utm_source=whatsapp'],
    ['/tienda/mi-tienda', '?slug=externo'],
    ['/tienda/mi-tienda', '?slug=externo&slug=otro'],
  ].map(([pathname, search]) => {
    const result = dynamicEvaluation.kind === 'rewrite'
      ? applyCompiledDestination(routes[dynamicEvaluation.index], pathname, search)
      : null;
    return {
      request: `${pathname}${search}`,
      destination: result?.pathname || null,
      slugValues: result?.query.getAll('slug') || [],
      utmSource: result?.query.get('utm_source') || null,
    };
  });

  const checks = {
    configVersion3: outputConfig?.version === 3,
    routesPresent: routes.length > 1,
    filesystemPresent: filesystemIndex >= 0,
    errorAfterFilesystem: errorIndex > filesystemIndex,
    dynamicStoreRoute: dynamicEvaluation.kind === 'rewrite',
    dynamicAfterFilesystem: dynamicEvaluation.index > filesystemIndex,
    dynamicDestination: cases.every((item) => item.destination === '/api/store-page'),
    pathSlugExactlyOnce: cases.every((item) => (
      item.slugValues.length === 1 && item.slugValues[0] === 'mi-tienda'
    )),
    trackingStatic: trackingEvaluation.kind === 'rewrite' && trackingEvaluation.pathname === '/index.html',
    nestedStoreStatic: nestedEvaluation.kind === 'rewrite' && nestedEvaluation.pathname === '/index.html',
    realAssetExists: Boolean(realAsset),
    filesystemPrecedesFallback: Boolean(assetEvaluation) && filesystemIndex >= 0
      && assetEvaluation.kind === 'filesystem' && assetEvaluation.index === filesystemIndex,
    assetsNotIntercepted: Boolean(assetEvaluation) && assetEvaluation.kind === 'filesystem',
    apiNotIntercepted: apiEvaluation.kind !== 'rewrite' || apiEvaluation.pathname !== '/index.html',
    trailingSlashCanonical: Boolean(canonicalRoute),
    trailingSlashNoindex: routeHeader(canonicalRoute, 'X-Robots-Tag') === NOINDEX,
    globalNoindex: routes.some((route) => routeHeader(route, 'X-Robots-Tag') === NOINDEX),
    immutableAssets: Boolean(assetHeader),
    staticHtmlRevalidated: Boolean(staticIndexHeader),
    htmlNeverImmutable: !htmlImmutable,
    noExternalDestination: routes.every((route) => (
      typeof route.dest !== 'string' || route.dest.startsWith('/')
    )),
    noRouteLoop: routes.every((route) => (
      typeof route.dest !== 'string' || route.dest.split('?')[0] !== route.src
    )),
  };
  return Object.freeze({
    checks,
    cases,
    routes: routes.length,
    filesystemIndex,
    errorIndex,
    dynamicRoute: dynamicEvaluation.kind === 'rewrite'
      ? { src: routes[dynamicEvaluation.index].src, dest: routes[dynamicEvaluation.index].dest }
      : null,
    compiled: {
      asset: assetPathname ? { request: assetPathname, result: assetEvaluation } : null,
      store: { request: '/tienda/mi-tienda', result: dynamicEvaluation },
      tracking: { request: '/tienda/mi-tienda/pedido/token-ficticio', result: trackingEvaluation },
      nested: { request: '/tienda/mi-tienda/ruta-anidada', result: nestedEvaluation },
      api: { request: '/api/store-page', result: apiEvaluation },
    },
  });
}

function canonicalFunctionRoute(relative, config, outputConfig) {
  const rawRoute = `/${relative.slice(0, -'.func'.length)}`;
  const extension = path.extname(rawRoute);
  if (!['.js', '.jsx', '.ts', '.tsx'].includes(extension)) return { rawRoute, route: rawRoute, normalized: false };
  const canonicalRoute = rawRoute.slice(0, -extension.length);
  const expectedInput = new Map([
    ['/api/store-page', '/api/store-page.js'],
    ['/api/og/store', '/api/og/store.js'],
  ]).get(canonicalRoute);
  const validRuntime = /^nodejs\d+(?:\.x)?$/u.test(config?.runtime || '');
  const validHandler = typeof config?.handler === 'string' && config.handler.length > 0;
  const extensionMatches = expectedInput === rawRoute;
  return {
    rawRoute,
    route: extensionMatches && validRuntime && validHandler ? canonicalRoute : rawRoute,
    normalized: extensionMatches && validRuntime && validHandler,
  };
}

async function discoverFunctionBundles(functionsRoot, outputConfig) {
  if (!await pathExists(functionsRoot)) return [];
  const bundles = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.name.endsWith('.func')) {
        const relative = normalizePath(path.relative(functionsRoot, absolutePath));
        const configPath = path.join(absolutePath, '.vc-config.json');
        if (!await pathExists(configPath)) {
        bundles.push({ absolutePath, relative, route: null, rawRoute: null, config: null, missingConfig: true });
          continue;
        }
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const resolved = canonicalFunctionRoute(relative, config, outputConfig);
        bundles.push({
          absolutePath,
          relative,
          route: resolved.route,
          rawRoute: resolved.rawRoute,
          normalized: resolved.normalized,
          config,
          missingConfig: false,
        });
      } else {
        await visit(absolutePath);
      }
    }
  }
  await visit(functionsRoot);
  return bundles.sort((left, right) => String(left.route).localeCompare(String(right.route)));
}

function decodeJwtPayload(candidate) {
  const segments = candidate.split('.');
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

function inspectPrivilegedJwt(source) {
  const violations = [];
  const candidates = source.match(
    /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}(?![A-Za-z0-9_-])/gu,
  ) || [];
  for (const candidate of candidates) {
    if (decodeJwtPayload(candidate)?.role === 'service_role') {
      violations.push('privilegedJwt');
    }
  }
  return violations;
}

function inspectCredentialValues(source) {
  const patterns = Object.freeze({
    supabaseSecret: /\bsb_secret_[A-Za-z0-9_-]{8,}\b/u,
    vercelToken: /\b(?:vcp|vercel)_[A-Za-z0-9_-]{20,}\b/u,
    githubToken: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/u,
    privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  });
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(source))
    .map(([name]) => name);
}

const credentialAssignmentPattern = /\b(client_secret|refresh_token|access_token)\b\s*[:=]\s*["']([^"'\r\n]*)["']/giu;

export function classifyCredentialAssignment(key, value) {
  const normalizedKey = String(key || '').trim().toLowerCase();
  const normalizedValue = String(value || '').trim();
  const lowerValue = normalizedValue.toLowerCase();
  if (!normalizedValue || lowerValue === normalizedKey) return 'oauth-vocabulary';
  if (['access_token', 'refresh_token', 'client_secret'].includes(lowerValue)) {
    return 'oauth-protocol';
  }
  if (/^(?:your[_-]?|<|\[|\{|redacted|placeholder|example|changeme|replace[_-]?me)/iu.test(normalizedValue)) {
    return 'placeholder';
  }
  if (/^https?:\/\//iu.test(normalizedValue) || /\s/u.test(normalizedValue)) return 'non-secret-value';
  if (/^[A-Za-z_$][\w$.-]*$/u.test(normalizedValue) && !/[0-9_-]/u.test(normalizedValue)) {
    return 'symbolic-value';
  }
  const categories = [/[a-z]/u, /[A-Z]/u, /\d/u, /[_-]/u]
    .filter((pattern) => pattern.test(normalizedValue)).length;
  const tokenLike = /^[A-Za-z0-9_-]+$/u.test(normalizedValue);
  return tokenLike && normalizedValue.length >= 24 && categories >= 3
    ? 'credential-like'
    : 'low-entropy-value';
}

function inspectGenericCredentialAssignments(source, relativePath) {
  const records = [];
  const violations = [];
  for (const match of source.matchAll(credentialAssignmentPattern)) {
    const [, key, value] = match;
    const classification = classifyCredentialAssignment(key, value);
    const record = Object.freeze({
      key: key.toLowerCase(),
      value: '<redacted>',
      valueLength: value.length,
      classification,
      relativePath,
    });
    records.push(record);
    if (classification === 'credential-like') {
      violations.push(`credentialValue:${record.key}:length=${record.valueLength}:${relativePath}`);
    }
  }
  return { records, violations };
}

function inspectCredentialAssignments(source) {
  const violations = [];
  const patterns = Object.freeze({
    supabaseServiceRoleEnvironment:
      /(?:^|[\r\n;])\s*(?:process\.env\.)?SUPABASE_SERVICE_ROLE\s*=\s*(?![=])(?:["'][^"'\r\n]+["']|[^\s;\r\n]+)/gimu,
    supabaseServiceRoleDeclaration:
      /\b(?:const|let|var)\s+SUPABASE_SERVICE_ROLE\s*=\s*["'][^"'\r\n]+["']/gimu,
    supabaseServiceRoleProperty:
      /["']?SUPABASE_SERVICE_ROLE["']?\s*:\s*["'][^"'\r\n]+["']/gimu,
  });
  for (const [name, pattern] of Object.entries(patterns)) {
    if (pattern.test(source)) violations.push(name);
  }
  const privilegedRoleDeclarations = source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']service_role["']/gimu,
  );
  for (const match of privilegedRoleDeclarations) {
    if (/(?:key|secret|token|role|credential)/iu.test(match[1])) {
      violations.push('privilegedRoleDeclaration');
    }
  }
  return violations;
}

function inspectDefensiveVocabulary(source) {
  const occurrences = [];
  for (const marker of ['service_role', 'supabase_service_role', 'SUPABASE_SERVICE_ROLE']) {
    if (source.includes(marker)) occurrences.push(marker);
  }
  return occurrences;
}

function administrativeMarkersForTarget(targetName) {
  const commonMarkers = {
    LanzoDB: /\bLanzoDB\b/u,
    PosPage: /\bPosPage\b/u,
    Dashboard: /\bDashboard\b/u,
    processSale: /\bprocessSale\b/u,
    cashSync: /\bcashSync\b/u,
    posSync: /\bposSync\b/u,
    deviceSecurityToken: /\bdevice_security_token\b/u,
    staffSessionToken: /\bstaff_session_token\b/u,
    createFreeTrialLicense: /\bcreate_free_trial_license\b/u,
    releaseDeviceAnon: /\breleaseDeviceAnon|release_device_anon/u,
    googleDrive: /\bgoogleDrive\b/u,
  };
  if (targetName !== 'store') {
    return Object.freeze({
      ...commonMarkers,
      Dexie: /\bDexie\b/u,
      Caja: /\bCaja\b/u,
    });
  }
  return Object.freeze({
    ...commonMarkers,
    CajaPage: /\bCajaPage\b/u,
    cajaService: /\bcajaService\b|(?:from\s*|import\s*\()["'][^"']*(?:components\/caja|pages\/CajaPage)[^"']*["']/iu,
    useCaja: /\buseCaja\b/u,
    CajaStatusCard: /\bCajaStatusCard\b/u,
    CajaActionsCard: /\bCajaActionsCard\b/u,
    CajaMovementsList: /\bCajaMovementsList\b/u,
  });
}

function inspectTextForSafety(filesWithSource, targetName = 'store') {
  const secretViolations = [];
  const credentialVocabulary = {};
  const credentialAssignments = [];
  const administrativeViolations = [];
  const pwaViolations = [];
  const administrativeMarkers = administrativeMarkersForTarget(targetName);
  const pwaMarkers = Object.freeze({
    serviceWorker: /serviceWorker\.register|service-worker|registerSW/iu,
    workbox: /\bworkbox\b|__WB_MANIFEST/iu,
    manifest: /manifest\.webmanifest/iu,
  });
  for (const { relativePath, source } of filesWithSource) {
    const genericCredentials = inspectGenericCredentialAssignments(source, relativePath);
    for (const name of [
      ...inspectCredentialValues(source),
      ...inspectPrivilegedJwt(source),
      ...inspectCredentialAssignments(source),
    ]) {
      secretViolations.push(`${name}:${relativePath}`);
    }
    secretViolations.push(...genericCredentials.violations);
    credentialAssignments.push(...genericCredentials.records);
    const defensiveVocabulary = inspectDefensiveVocabulary(source);
    if (defensiveVocabulary.length > 0) {
      credentialVocabulary.defensive ||= [];
      credentialVocabulary.defensive.push(
        ...defensiveVocabulary.map((marker) => `${marker}:${relativePath}`),
      );
    }
    for (const marker of ['client_secret', 'refresh_token', 'access_token']) {
      if (new RegExp(`\\b${marker}\\b`, 'iu').test(source)) {
        credentialVocabulary[marker] ||= [];
        credentialVocabulary[marker].push(relativePath);
      }
    }
    for (const [name, pattern] of Object.entries(administrativeMarkers)) {
      if (pattern.test(source)) administrativeViolations.push(`${name}:${relativePath}`);
    }
    for (const [name, pattern] of Object.entries(pwaMarkers)) {
      if (pattern.test(source)) pwaViolations.push(`${name}:${relativePath}`);
    }
  }
  return {
    secretViolations: [...new Set(secretViolations)].sort(),
    credentialVocabulary,
    credentialAssignments,
    administrativeViolations: [...new Set(administrativeViolations)].sort(),
    pwaViolations: [...new Set(pwaViolations)].sort(),
  };
}

function readJavaScriptString(source, index, quote) {
  let value = '';
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '\\') {
      const next = source[cursor + 1];
      if (next === undefined) return { value, end: cursor + 1 };
      value += next;
      cursor += 1;
      continue;
    }
    if (character === quote) return { value, end: cursor + 1 };
    value += character;
  }
  return { value, end: source.length };
}

/**
 * A deliberately small lexer for import constructs. It ignores comments and
 * strings so error messages, JSON and source-map comments cannot look like an
 * executable import. Template literals are opaque by policy for this audit.
 */
function tokenizeJavaScript(source) {
  const tokens = [];
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) break;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const string = readJavaScriptString(source, index, character);
      tokens.push({ type: 'string', value: string.value });
      index = string.end;
      continue;
    }
    if (character === '`') {
      const string = readJavaScriptString(source, index, character);
      index = string.end;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/u.test(source[end])) end += 1;
      tokens.push({ type: 'word', value: source.slice(index, end) });
      index = end;
      continue;
    }
    tokens.push({ type: 'punctuation', value: character });
    index += 1;
  }
  return tokens;
}

export function classifyGeneratedHandlerSyntax(source) {
  const tokens = tokenizeJavaScript(source);
  let commonJs = false;
  let esm = false;
  const isProperty = (index) => tokens[index - 1]?.value === '.';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'word' || isProperty(index)) continue;
    if (
      token.value === 'require'
      && tokens[index + 1]?.value === '('
    ) commonJs = true;
    if (
      token.value === 'exports'
      && ['.', '[', '='].includes(tokens[index + 1]?.value)
    ) commonJs = true;
    if (
      token.value === 'module'
      && tokens[index + 1]?.value === '.'
      && tokens[index + 2]?.value === 'exports'
    ) commonJs = true;
    if (
      token.value === 'export'
      || (token.value === 'import' && tokens[index + 1]?.value !== '(')
    ) esm = true;
  }
  if (commonJs && esm) return 'mixed';
  if (commonJs) return 'commonjs';
  if (esm) return 'module';
  return 'unknown';
}

async function effectivePackageScope(handlerPath, bundleRoot) {
  let directory = path.dirname(handlerPath);
  const root = path.resolve(bundleRoot);
  while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
    const packagePath = path.join(directory, 'package.json');
    if (await pathExists(packagePath)) {
      try {
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
        const packageType = packageJson?.type === 'module' ? 'module' : 'commonjs';
        return {
          packageType,
          packageScope: normalizePath(path.relative(root, packagePath)),
          packageReadable: true,
        };
      } catch {
        return {
          packageType: null,
          packageScope: normalizePath(path.relative(root, packagePath)),
          packageReadable: false,
        };
      }
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return { packageType: 'commonjs', packageScope: null, packageReadable: true };
}

function interpretedModuleFormat(extension, packageType) {
  if (extension === '.cjs') return 'commonjs';
  if (extension === '.mjs') return 'module';
  if (extension === '.js') return packageType;
  return null;
}

const handlerSmokeSource = String.raw`
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_DURING_HANDLER_LOAD'); };
try {
  const loaded = await import(pathToFileURL(path.resolve(process.argv[1])).href);
  const invocable = (value) => typeof value === 'function'
    || typeof value?.fetch === 'function'
    || typeof value?.handler === 'function';
  const candidate = invocable(loaded.default)
    ? loaded.default
    : invocable(loaded.default?.default)
      ? loaded.default.default
      : invocable(loaded)
        ? loaded
        : null;
  if (!candidate) throw Object.assign(new TypeError('HANDLER_INTERFACE_NOT_INVOKABLE'), {
    code: 'HANDLER_INTERFACE_NOT_INVOKABLE',
  });
  process.stdout.write(JSON.stringify({ loaded: true, invocable: true }));
} catch (error) {
  process.stderr.write(JSON.stringify({
    loaded: false,
    invocable: false,
    name: String(error?.name || 'Error'),
    code: String(error?.code || ''),
    message: String(error?.message || 'handler load failed').slice(0, 500),
  }));
  process.exit(1);
}
`;

function sanitizeHandlerSmokeError(value, bundleRoot) {
  const normalizedRoot = normalizePath(path.resolve(bundleRoot));
  return String(value || '')
    .replaceAll(normalizedRoot, '<function-bundle>')
    .replaceAll('\\', '/')
    .slice(0, 1000);
}

function smokeLoadGeneratedHandler(handlerPath, bundleRoot, runtime) {
  const runtimeMajor = Number(/^nodejs(\d+)(?:\.x)?$/u.exec(runtime || '')?.[1]);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', handlerSmokeSource, handlerPath], {
    cwd: bundleRoot,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      NODE_ENV: 'test',
      PUBLIC_STORE_ORIGINS: 'https://store.invalid',
      VITE_SUPABASE_URL: 'https://supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runtime_smoke_fixture',
    },
  });
  let payload = null;
  const rawPayload = result.status === 0 ? result.stdout : result.stderr;
  try { payload = JSON.parse(rawPayload || '{}'); } catch { /* represented as a failed smoke */ }
  return Object.freeze({
    nodeMajor,
    runtimeMajor: Number.isInteger(runtimeMajor) ? runtimeMajor : null,
    nodeMajorMatchesRuntime: nodeMajor === runtimeMajor,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    loaded: result.status === 0 && payload?.loaded === true,
    invocable: result.status === 0 && payload?.invocable === true,
    error: result.status === 0 ? null : sanitizeHandlerSmokeError(rawPayload, bundleRoot),
  });
}

const runtimeModuleSmokeSource = String.raw`
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_DURING_MODULE_LOAD'); };
try {
  await import(pathToFileURL(path.resolve(process.argv[1])).href);
  process.stdout.write('__LANZO_SMOKE__' + JSON.stringify({ loaded: true }));
} catch (error) {
  process.stderr.write('__LANZO_SMOKE__' + JSON.stringify({
    loaded: false,
    name: String(error?.name || 'Error'),
    code: String(error?.code || ''),
    message: String(error?.message || 'runtime module load failed').slice(0, 500),
  }));
  process.exit(1);
}
`;

const requestSmokeSource = String.raw`
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const handlerPath = path.resolve(process.argv[1]);
const route = process.argv[2];
let controlledFetchCalls = 0;
globalThis.fetch = async () => {
  controlledFetchCalls += 1;
  throw Object.assign(new Error('CONTROLLED_EXTERNAL_FETCH_BLOCKED'), {
    code: 'CONTROLLED_EXTERNAL_FETCH_BLOCKED',
  });
};
const invocable = (value) => typeof value === 'function'
  || typeof value?.fetch === 'function'
  || typeof value?.handler === 'function';
const candidateFrom = (loaded) => invocable(loaded.default)
  ? loaded.default
  : invocable(loaded.default?.default)
    ? loaded.default.default
    : invocable(loaded)
      ? loaded
      : null;
const invoke = async (candidate, request) => {
  if (typeof candidate === 'function') return candidate(request);
  if (typeof candidate?.fetch === 'function') return candidate.fetch(request);
  return candidate.handler(request);
};
try {
  const loaded = await import(pathToFileURL(handlerPath).href);
  const candidate = candidateFrom(loaded);
  if (!candidate) throw Object.assign(new TypeError('HANDLER_INTERFACE_NOT_INVOKABLE'), {
    code: 'HANDLER_INTERFACE_NOT_INVOKABLE',
  });
  const requestUrl = route === '/api/store-page'
    ? 'https://preview.invalid/api/store-page?slug=farmaciagary'
    : 'https://preview.invalid/api/og/store?slug=farmaciagary';
  const response = await invoke(candidate, new Request(requestUrl, { method: 'GET' }));
  if (!response || typeof response.status !== 'number' || typeof response.arrayBuffer !== 'function') {
    throw Object.assign(new TypeError('HANDLER_RESPONSE_NOT_RESPONSE_LIKE'), {
      code: 'HANDLER_RESPONSE_NOT_RESPONSE_LIKE',
    });
  }
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  const payload = {
    loaded: true,
    invocable: true,
    fetchExists: typeof globalThis.fetch === 'function',
    requestFinished: true,
    status: response.status,
    contentType,
    controlledFetchCalls,
    externalNetworkDisabled: true,
  };
  if (route === '/api/store-page') {
    const body = await response.text();
    payload.html = contentType.includes('text/html');
    payload.fallback500Absent = !body.includes('Store page temporarily unavailable.');
    payload.doctype = /^\s*<!doctype html>/iu.test(body);
    payload.rootCount = (body.match(/\bid=["']root["']/giu) || []).length;
    payload.transitiveTemplateLoaded = payload.html
      && payload.fallback500Absent
      && payload.doctype
      && payload.rootCount === 1;
    payload.failureReason = payload.fallback500Absent
      ? null
      : 'FINAL_TEMPLATE_FALLBACK_500';
    payload.passed = response.status !== 500
      && payload.fetchExists
      && payload.transitiveTemplateLoaded;
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    payload.png = contentType.includes('image/png')
      && bytes.length >= 8
      && bytes[0] === 137
      && bytes[1] === 80
      && bytes[2] === 78
      && bytes[3] === 71
      && bytes[4] === 13
      && bytes[5] === 10
      && bytes[6] === 26
      && bytes[7] === 10;
    payload.bytes = bytes.length;
    payload.passed = response.status !== 500
      && payload.fetchExists
      && payload.png;
  }
  const output = '__LANZO_SMOKE__' + JSON.stringify(payload);
  (payload.passed ? process.stdout : process.stderr).write(output);
  if (!payload.passed) process.exit(1);
} catch (error) {
  process.stderr.write('__LANZO_SMOKE__' + JSON.stringify({
    loaded: false,
    invocable: false,
    fetchExists: typeof globalThis.fetch === 'function',
    requestFinished: false,
    controlledFetchCalls,
    externalNetworkDisabled: true,
    passed: false,
    name: String(error?.name || 'Error'),
    code: String(error?.code || ''),
    message: String(error?.message || 'handler request failed').slice(0, 500),
  }));
  process.exit(1);
}
`;

function parseMarkedSmokePayload(value) {
  const marker = '__LANZO_SMOKE__';
  const raw = String(value || '');
  const markerIndex = raw.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  try {
    return JSON.parse(raw.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

function runtimeSmokeProcess(source, args, bundleRoot, runtime, timeout = 15_000) {
  const runtimeMajor = Number(/^nodejs(\d+)(?:\.x)?$/u.exec(runtime || '')?.[1]);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, ...args], {
    cwd: bundleRoot,
    encoding: 'utf8',
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: {
      NODE_ENV: 'test',
      PUBLIC_STORE_ORIGINS: 'https://preview.invalid',
      VITE_SUPABASE_URL: 'https://supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_runtime_smoke_fixture',
    },
  });
  const rawPayload = result.status === 0 ? result.stdout : result.stderr;
  return {
    result,
    payload: parseMarkedSmokePayload(rawPayload),
    rawPayload,
    nodeMajor,
    runtimeMajor: Number.isInteger(runtimeMajor) ? runtimeMajor : null,
  };
}

function smokeLoadGeneratedRuntimeModule(modulePath, bundleRoot, runtime) {
  const smoke = runtimeSmokeProcess(
    runtimeModuleSmokeSource,
    [modulePath],
    bundleRoot,
    runtime,
  );
  return Object.freeze({
    nodeMajor: smoke.nodeMajor,
    runtimeMajor: smoke.runtimeMajor,
    nodeMajorMatchesRuntime: smoke.nodeMajor === smoke.runtimeMajor,
    exitCode: Number.isInteger(smoke.result.status) ? smoke.result.status : null,
    signal: smoke.result.signal || null,
    timedOut: smoke.result.error?.code === 'ETIMEDOUT',
    loaded: smoke.result.status === 0 && smoke.payload?.loaded === true,
    error: smoke.result.status === 0
      ? null
      : sanitizeHandlerSmokeError(smoke.rawPayload, bundleRoot),
  });
}

function smokeInvokeGeneratedHandler(handlerPath, bundleRoot, runtime, route) {
  const smoke = runtimeSmokeProcess(
    requestSmokeSource,
    [handlerPath, route],
    bundleRoot,
    runtime,
    30_000,
  );
  return Object.freeze({
    nodeMajor: smoke.nodeMajor,
    runtimeMajor: smoke.runtimeMajor,
    nodeMajorMatchesRuntime: smoke.nodeMajor === smoke.runtimeMajor,
    exitCode: Number.isInteger(smoke.result.status) ? smoke.result.status : null,
    signal: smoke.result.signal || null,
    timedOut: smoke.result.error?.code === 'ETIMEDOUT',
    loaded: smoke.payload?.loaded === true,
    invocable: smoke.payload?.invocable === true,
    fetchExists: smoke.payload?.fetchExists === true,
    requestFinished: smoke.payload?.requestFinished === true,
    status: Number.isInteger(smoke.payload?.status) ? smoke.payload.status : null,
    contentType: smoke.payload?.contentType || null,
    controlledFetchCalls: Number.isInteger(smoke.payload?.controlledFetchCalls)
      ? smoke.payload.controlledFetchCalls
      : null,
    externalNetworkDisabled: smoke.payload?.externalNetworkDisabled === true,
    html: smoke.payload?.html === true,
    fallback500Absent: smoke.payload?.fallback500Absent === true,
    doctype: smoke.payload?.doctype === true,
    rootCount: Number.isInteger(smoke.payload?.rootCount) ? smoke.payload.rootCount : null,
    transitiveTemplateLoaded: smoke.payload?.transitiveTemplateLoaded === true,
    failureReason: smoke.payload?.failureReason || null,
    png: smoke.payload?.png === true,
    bytes: Number.isInteger(smoke.payload?.bytes) ? smoke.payload.bytes : null,
    passed: smoke.result.status === 0 && smoke.payload?.passed === true,
    error: smoke.result.status === 0
      ? null
      : sanitizeHandlerSmokeError(smoke.rawPayload, bundleRoot),
  });
}

function executableImportSpecifiers(source) {
  const tokens = tokenizeJavaScript(source);
  const specifiers = [];
  const isProperty = (index) => tokens[index - 1]?.value === '.';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'word' || isProperty(index)) continue;
    if (token.value === 'require' && tokens[index + 1]?.value === '(' && tokens[index + 2]?.type === 'string') {
      specifiers.push(tokens[index + 2].value);
      continue;
    }
    if (token.value === 'import') {
      if (tokens[index + 1]?.value === '(' && tokens[index + 2]?.type === 'string') {
        specifiers.push(tokens[index + 2].value);
        continue;
      }
      if (tokens[index + 1]?.type === 'string') {
        specifiers.push(tokens[index + 1].value);
        continue;
      }
    }
    if (token.value !== 'import' && token.value !== 'export') continue;
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ';'; cursor += 1) {
      if (tokens[cursor].value === 'from' && tokens[cursor + 1]?.type === 'string') {
        specifiers.push(tokens[cursor + 1].value);
        break;
      }
    }
  }
  return [...new Set(specifiers)];
}

function localImportClassification(specifier, file, bundleRoot) {
  const normalized = normalizePath(specifier);
  if (normalized.startsWith('file://')) return 'file-url';
  if (/^[A-Za-z]:\//u.test(normalized)) return 'absolute-windows';
  if (normalized.startsWith('/')) return 'absolute-posix';
  if (/(?:^|\/)(?:src|supabase|tests|docs)(?:\/|$)/iu.test(normalized)) return 'protected-source';
  if (!normalized.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(file.absolutePath), specifier);
  const relativeResolved = normalizePath(path.relative(bundleRoot, resolved));
  if (relativeResolved.startsWith('../') || path.isAbsolute(relativeResolved)) return 'escapes-bundle';
  return null;
}

async function localImportExists(resolvedPath) {
  const candidates = [
    resolvedPath,
    ...['.js', '.jsx', '.mjs', '.cjs', '.json', '.node'].map((extension) => `${resolvedPath}${extension}`),
    ...['index.js', 'index.jsx', 'index.mjs', 'index.cjs', 'index.json', 'index.node']
      .map((name) => path.join(resolvedPath, name)),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return true;
    } catch { /* try the next Node-compatible local resolution candidate */ }
  }
  return false;
}

async function resolveRuntimeLocalModule(specifier, fromPath, bundleRoot) {
  if (!String(specifier).startsWith('.')) return null;
  const resolvedPath = path.resolve(path.dirname(fromPath), specifier);
  const relativeResolved = normalizePath(path.relative(bundleRoot, resolvedPath));
  if (relativeResolved.startsWith('../') || path.isAbsolute(relativeResolved)) return null;
  const candidates = [
    resolvedPath,
    ...['.js', '.jsx', '.mjs', '.cjs'].map((extension) => `${resolvedPath}${extension}`),
    ...['index.js', 'index.jsx', 'index.mjs', 'index.cjs']
      .map((name) => path.join(resolvedPath, name)),
  ];
  for (const candidate of candidates) {
    try {
      if (
        (await stat(candidate)).isFile()
        && executableExtensions.has(path.extname(candidate).toLowerCase())
      ) return candidate;
    } catch { /* try the next Node-compatible executable candidate */ }
  }
  return null;
}

function requiredGeneratedPackageScope(route, relativePath, extension) {
  if (extension !== '.js') return null;
  if (relativePath.startsWith('store/api/')) return 'store/api/package.json';
  if ((EXPECTED_TRANSITIVE_RUNTIME_MODULES[route] || []).includes(relativePath)) {
    return 'store/generated/package.json';
  }
  if (relativePath.startsWith('store/generated/')) return '__UNAPPROVED_GENERATED_SCOPE__';
  return null;
}

async function inspectGeneratedRuntimeModules({
  handlerPath,
  bundleRoot,
  route,
  runtime,
  handler,
}) {
  const pending = [handlerPath];
  const visited = new Set();
  const modules = [];
  while (pending.length > 0) {
    const modulePath = pending.shift();
    const absolutePath = path.resolve(modulePath);
    if (visited.has(absolutePath)) continue;
    visited.add(absolutePath);
    const relativePath = normalizePath(path.relative(bundleRoot, absolutePath));
    let source;
    try {
      source = await readFile(absolutePath, 'utf8');
    } catch {
      modules.push({
        path: relativePath,
        exists: false,
        readable: false,
        extension: path.extname(relativePath).toLowerCase(),
        syntax: null,
        packageType: null,
        packageScope: null,
        packageReadable: false,
        requiredPackageScope: null,
        scopeNarrow: false,
        interpretedAs: null,
        compatible: false,
        smoke: null,
      });
      continue;
    }
    const extension = path.extname(relativePath).toLowerCase();
    const syntax = classifyGeneratedHandlerSyntax(source);
    const packageScope = await effectivePackageScope(absolutePath, bundleRoot);
    const interpretedAs = interpretedModuleFormat(extension, packageScope.packageType);
    const compatible = (
      syntax === 'commonjs' && interpretedAs === 'commonjs'
    ) || (
      syntax === 'module' && interpretedAs === 'module'
    );
    const requiredPackageScope = requiredGeneratedPackageScope(route, relativePath, extension);
    const scopeNarrow = requiredPackageScope === null
      || packageScope.packageScope === requiredPackageScope;
    modules.push({
      path: relativePath,
      exists: true,
      readable: true,
      extension,
      syntax,
      packageType: packageScope.packageType,
      packageScope: packageScope.packageScope,
      packageReadable: packageScope.packageReadable,
      requiredPackageScope,
      scopeNarrow,
      interpretedAs,
      compatible,
      smoke: smokeLoadGeneratedRuntimeModule(absolutePath, bundleRoot, runtime),
    });
    for (const specifier of executableImportSpecifiers(source)) {
      const resolved = await resolveRuntimeLocalModule(specifier, absolutePath, bundleRoot);
      if (resolved && !visited.has(path.resolve(resolved))) pending.push(resolved);
    }
  }
  modules.sort((left, right) => left.path.localeCompare(right.path));
  const expectedTransitiveModules = handler === 'store/api/store-page.js'
    ? EXPECTED_TRANSITIVE_RUNTIME_MODULES[route] || []
    : [];
  const paths = modules.map((item) => item.path);
  return Object.freeze({
    expectedTransitiveModules: Object.freeze([...expectedTransitiveModules]),
    expectedTransitiveModulesPresent: expectedTransitiveModules.every((item) => paths.includes(item)),
    modules: Object.freeze(modules.map((item) => Object.freeze(item))),
  });
}

/** Audit only real executable import syntax; sourcemap text is intentionally excluded. */
export async function inspectExecutableLocalImports(filesWithSource, bundleRoot) {
  const violations = [];
  for (const file of filesWithSource) {
    for (const specifier of executableImportSpecifiers(file.source)) {
      let classification = localImportClassification(specifier, file, bundleRoot);
      if (!classification && specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file.absolutePath), specifier);
        if (!await localImportExists(resolved)) classification = 'missing-local-file';
      }
      if (classification) violations.push({
        path: normalizePath(file.relativePath),
        classification,
      });
    }
  }
  return violations.sort((left, right) => (
    left.path.localeCompare(right.path) || left.classification.localeCompare(right.classification)
  ));
}

function sourceMapReferenceClassification(reference) {
  const normalized = normalizePath(reference.replace(/^file:\/\/+/iu, ''));
  if (/(?:^|\/)(?:src|supabase|tests|docs)(?:\/|$)/iu.test(normalized)) return 'protected-source-reference';
  if (/(?:^|\/)\.\.(?:\/|$)/u.test(normalized)) return 'closure-escape';
  if (/^[A-Za-z]:\//u.test(normalized) || reference.startsWith('file://') || normalized.startsWith('/')) {
    return 'absolute-source-reference';
  }
  return 'bundle-source-reference';
}

async function ogClosurePackages(bundleRoot) {
  const packages = new Set();
  const pending = ['@vercel/og'];
  while (pending.length > 0) {
    const packageName = pending.pop();
    if (packages.has(packageName)) continue;
    const packageJsonPath = path.join(bundleRoot, 'node_modules', ...packageName.split('/'), 'package.json');
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      packages.add(packageName);
      for (const dependency of Object.keys({
        ...(packageJson.dependencies || {}),
        ...(packageJson.optionalDependencies || {}),
      })) pending.push(dependency);
    } catch { /* a missing package cannot authorize a font */ }
  }
  return packages;
}

function originPackageForPath(relativePath) {
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/|$)/u.exec(relativePath);
  return match?.[1] || null;
}

async function inspectFunctionFonts(bundle, paths) {
  const allowedPackages = await ogClosurePackages(bundle.absolutePath);
  const configText = JSON.stringify(bundle.config || {});
  return paths
    .filter((relativePath) => /\.(?:otf|ttf|woff2?)$/iu.test(relativePath))
    .map((relativePath) => {
      const originPackage = originPackageForPath(relativePath);
      const extension = path.extname(relativePath).toLowerCase();
      const referencedFromConfig = configText.includes(relativePath);
      const protectedSource = /(?:^|\/)(?:src|supabase|tests|docs)(?:\/|$)/iu.test(relativePath);
      const allowed = bundle.route === '/api/og/store'
        && /^node_modules\//u.test(relativePath)
        && !protectedSource
        && !referencedFromConfig
        && ['.otf', '.ttf', '.woff', '.woff2'].includes(extension)
        && originPackage !== null
        && allowedPackages.has(originPackage);
      return {
        relativePath,
        extension,
        originPackage,
        insideFunctionBundle: true,
        public: false,
        referencedFromConfig,
        allowed,
      };
    });
}

/** Evidence of packages that can execute in a generated function bundle. */
export function inspectExecutableDependencies(filesWithSource) {
  const evidence = { vercelOg: [], react: [] };
  const importsPackage = (source, packageName) => new RegExp(
    `(?:\\bimport\\s+(?:[^'\"]*?\\s+from\\s+)?|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)['\"]${packageName.replace('/', '\\/')}['\"]`,
    'u',
  ).test(source);
  for (const { relativePath, source } of filesWithSource) {
    const normalizedPath = normalizePath(relativePath);
    if (/^node_modules\/@vercel\/og\//u.test(normalizedPath)) evidence.vercelOg.push(normalizedPath);
    if (/^node_modules\/react\//u.test(normalizedPath)) evidence.react.push(normalizedPath);
    if (importsPackage(source, '@vercel/og')) evidence.vercelOg.push(normalizedPath);
    if (importsPackage(source, 'react')) evidence.react.push(normalizedPath);
  }
  return Object.freeze({
    vercelOg: evidence.vercelOg.length > 0,
    react: evidence.react.length > 0,
    evidence: Object.freeze({
      vercelOg: [...new Set(evidence.vercelOg)].sort(),
      react: [...new Set(evidence.react)].sort(),
    }),
  });
}

export function formatSafetyFailureDetails(safety, failedChecks, limit = 5) {
  const details = [];
  if (failedChecks.includes('noSecrets')) {
    details.push(`noSecrets[${(safety.secretViolations || []).slice(0, limit).join(', ') || 'unknown'}]`);
  }
  if (failedChecks.includes('noAdministrativeCode')) {
    details.push(`noAdministrativeCode[${(safety.administrativeViolations || []).slice(0, limit).join(', ') || 'unknown'}]`);
  }
  return details;
}

async function inspectFunctions(functionsRoot, sourceStaticPath, outputConfig) {
  const bundles = await discoverFunctionBundles(functionsRoot, outputConfig);
  const routes = bundles.map((bundle) => bundle.route).filter(Boolean).sort();
  const details = [];
  const allViolations = {
    secretViolations: [],
    administrativeViolations: [],
    pwaViolations: [],
    localImportViolations: [],
    localImportClassification: {},
    credentialVocabulary: {},
    credentialAssignments: [],
  };
  const currentHtml = await readFile(path.join(sourceStaticPath, 'index.html'), 'utf8');
  const currentAssets = [...currentHtml.matchAll(/\/assets\/[^"' ]+-[A-Za-z0-9_-]{6,}\.(?:js|css)/gu)]
    .map((match) => match[0]);

  for (const bundle of bundles) {
    const files = await walkOutputFiles(bundle.absolutePath);
    const paths = files.map((file) => file.relativePath);
    const sources = await Promise.all(files
      .filter((file) => {
        const extension = path.extname(file.relativePath).toLowerCase();
        return textExtensions.has(extension) || fontExtensions.has(extension) || file.relativePath.endsWith('.map');
      })
      .map(async (file) => ({ ...file, source: await readFile(file.absolutePath, 'utf8') })));
    const joined = sources.map(({ source }) => source).join('\n');
    const executableSources = sources.filter((file) => executableExtensions.has(
      path.extname(file.relativePath).toLowerCase(),
    ));
    const dependencies = inspectExecutableDependencies(executableSources);
    // Sourcemaps remain in safety scanning for secrets and admin code, but only
    // executable source participates in local-import detection.
    const safety = inspectTextForSafety(sources, 'store');
    const localImportViolations = await inspectExecutableLocalImports(executableSources, bundle.absolutePath);
    const sourceMapPaths = paths.filter((item) => item.endsWith('.map'));
    const sourceMaps = await Promise.all(sourceMapPaths.map(async (relativePath) => {
      const source = await readFile(path.join(bundle.absolutePath, relativePath), 'utf8');
      let parsed = null;
      try { parsed = JSON.parse(source); } catch { /* rejected below */ }
      const references = Array.isArray(parsed?.sources) ? parsed.sources.map(String) : [];
      const classifications = references.map((reference) => ({
        reference,
        classification: sourceMapReferenceClassification(reference),
      }));
      const outsideClosure = classifications.some(({ classification }) => (
        classification === 'protected-source-reference' || classification === 'closure-escape'
      ));
      return {
        path: relativePath,
        generatedBy: /^nodejs\d+(?:\.x)?$/u.test(bundle.config?.runtime || '') ? '@vercel/node (inferred)' : 'unknown',
        insideFunctionBundle: true,
        public: false,
        referencedFromConfig: false,
        validJson: Boolean(parsed),
        sources: references,
        sourceClassifications: classifications.map(({ classification }) => classification),
        closureSafe: !outsideClosure,
      };
    }));
    for (const key of [
      'secretViolations',
      'administrativeViolations',
      'pwaViolations',
    ]) allViolations[key].push(...safety[key].map((item) => `${bundle.route}:${item}`));
    for (const violation of localImportViolations) {
      allViolations.localImportViolations.push({ route: bundle.route, ...violation });
      allViolations.localImportClassification[violation.classification] ||= 0;
      allViolations.localImportClassification[violation.classification] += 1;
    }
    allViolations.credentialAssignments.push(...safety.credentialAssignments.map((item) => ({
      ...item,
      relativePath: `${bundle.route}:${item.relativePath}`,
    })));
    for (const [name, occurrences] of Object.entries(safety.credentialVocabulary)) {
      allViolations.credentialVocabulary[name] ||= [];
      allViolations.credentialVocabulary[name].push(
        ...occurrences.map((item) => `${bundle.route}:${item}`),
      );
    }
    const configReadable = Boolean(bundle.config && typeof bundle.config === 'object');
    const handler = bundle.config?.handler;
    const handlerPresent = typeof handler === 'string' && paths.includes(handler);
    const handlerPath = handlerPresent ? path.join(bundle.absolutePath, handler) : null;
    const handlerSource = handlerPath ? await readFile(handlerPath, 'utf8') : '';
    const handlerExtension = handlerPath ? path.extname(handlerPath).toLowerCase() : null;
    const packageScope = handlerPath
      ? await effectivePackageScope(handlerPath, bundle.absolutePath)
      : { packageType: null, packageScope: null, packageReadable: false };
    const syntax = handlerPath ? classifyGeneratedHandlerSyntax(handlerSource) : null;
    const interpretedAs = interpretedModuleFormat(handlerExtension, packageScope.packageType);
    const moduleFormatCompatible = (
      syntax === 'commonjs' && interpretedAs === 'commonjs'
    ) || (
      syntax === 'module' && interpretedAs === 'module'
    );
    const runtimeSmoke = handlerPath
      ? smokeLoadGeneratedHandler(handlerPath, bundle.absolutePath, bundle.config?.runtime)
      : Object.freeze({
        nodeMajor: Number(process.versions.node.split('.')[0]),
        runtimeMajor: null,
        nodeMajorMatchesRuntime: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        loaded: false,
        invocable: false,
        error: 'DECLARED_HANDLER_NOT_FOUND',
      });
    const runtimeModules = handlerPath
      ? await inspectGeneratedRuntimeModules({
          handlerPath,
          bundleRoot: bundle.absolutePath,
          route: bundle.route,
          runtime: bundle.config?.runtime,
          handler,
        })
      : Object.freeze({
          expectedTransitiveModules: Object.freeze([]),
          expectedTransitiveModulesPresent: false,
          modules: Object.freeze([]),
        });
    const requestSmoke = handlerPath
      ? smokeInvokeGeneratedHandler(
          handlerPath,
          bundle.absolutePath,
          bundle.config?.runtime,
          bundle.route,
        )
      : Object.freeze({
          nodeMajor: Number(process.versions.node.split('.')[0]),
          runtimeMajor: null,
          nodeMajorMatchesRuntime: false,
          exitCode: null,
          signal: null,
          timedOut: false,
          loaded: false,
          invocable: false,
          fetchExists: false,
          requestFinished: false,
          status: null,
          contentType: null,
          controlledFetchCalls: null,
          externalNetworkDisabled: false,
          html: false,
          fallback500Absent: false,
          doctype: false,
          rootCount: null,
          transitiveTemplateLoaded: false,
          png: false,
          bytes: null,
          passed: false,
          error: 'DECLARED_HANDLER_NOT_FOUND',
        });
    details.push({
      route: bundle.route,
      rawRoute: bundle.rawRoute,
      bundle: bundle.relative,
      normalized: bundle.normalized === true,
      runtime: bundle.config?.runtime || null,
      handler: handler || null,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      configReadable,
      handlerPresent,
      module: {
        extension: handlerExtension,
        syntax,
        packageType: packageScope.packageType,
        packageScope: packageScope.packageScope,
        packageReadable: packageScope.packageReadable,
        interpretedAs,
        compatible: moduleFormatCompatible,
        smoke: runtimeSmoke,
      },
      runtimeModules,
      requestSmoke,
      sourceMaps: sourceMaps.map((item) => item.path),
      internalFunctionSourceMaps: sourceMaps,
      fonts: await inspectFunctionFonts(bundle, paths),
      localImportViolations,
      environmentFiles: paths.filter((item) => /(^|\/)\.env(?:\.|$)/iu.test(item)),
      dependencies: {
        vercelOg: dependencies.vercelOg,
        react: dependencies.react,
        evidence: dependencies.evidence,
      },
      template: {
        markerPresent: /LANZO_SOCIAL_HEAD_START/u.test(joined),
        symbolPresent: /STORE_HTML_TEMPLATE/u.test(joined),
        rootPresent: /id=(?:\\?["'])root/u.test(joined),
        currentAssetsPresent: currentAssets.length > 0
          && currentAssets.every((asset) => joined.includes(asset)),
      },
    });
  }

  const duplicateRoutes = routes.some((route, index) => routes.indexOf(route) !== index);
  const htmlFunction = details.find((item) => item.route === '/api/store-page');
  const ogFunction = details.find((item) => item.route === '/api/og/store');
  const checks = {
    exactlyExpectedFunctions: !duplicateRoutes
      && JSON.stringify(routes) === JSON.stringify(EXPECTED_STORE_FUNCTIONS),
    readableConfigs: details.every((item) => item.configReadable),
    validRuntime: details.every((item) => /^nodejs\d+(?:\.x)?$/u.test(item.runtime || '')),
    validHandlers: details.every((item) => item.handlerPresent),
    functionPackageScopesReadable: details.every((item) => (
      item.module.packageReadable
      && item.runtimeModules.modules.every((module) => module.packageReadable)
    )),
    functionModuleFormatsCompatible: details.every((item) => (
      item.module.compatible
      && item.runtimeModules.modules.every((module) => module.compatible)
    )),
    functionRuntimeModulesPresent: details.every((item) => (
      item.runtimeModules.expectedTransitiveModulesPresent
      && item.runtimeModules.modules.every((module) => module.exists && module.readable)
    )),
    functionRuntimeModuleScopesNarrow: details.every((item) => (
      item.runtimeModules.modules.every((module) => module.scopeNarrow)
    )),
    functionRuntimeModulesLoadable: details.every((item) => (
      item.runtimeModules.modules.length > 0
      && item.runtimeModules.modules.every((module) => (
        module.smoke?.exitCode === 0
        && module.smoke.loaded
        && !module.smoke.timedOut
      ))
    )),
    functionNodeMajorMatchesRuntime: details.every((item) => (
      item.module.smoke.nodeMajorMatchesRuntime
      && item.requestSmoke.nodeMajorMatchesRuntime
      && item.runtimeModules.modules.every((module) => module.smoke?.nodeMajorMatchesRuntime)
    )),
    functionHandlersLoadable: details.every((item) => (
      item.module.smoke.exitCode === 0
      && item.module.smoke.loaded
      && !item.module.smoke.timedOut
    )),
    functionHandlersInvocable: details.every((item) => item.module.smoke.invocable),
    functionRequestsCompleted: details.every((item) => (
      item.requestSmoke.exitCode === 0
      && item.requestSmoke.loaded
      && item.requestSmoke.invocable
      && item.requestSmoke.fetchExists
      && item.requestSmoke.requestFinished
      && item.requestSmoke.externalNetworkDisabled
      && item.requestSmoke.passed
    )),
    storePageEndToEndSmokePassed: htmlFunction?.requestSmoke.passed === true
      && htmlFunction.requestSmoke.status !== 500
      && htmlFunction.requestSmoke.html
      && htmlFunction.requestSmoke.fallback500Absent
      && htmlFunction.requestSmoke.doctype
      && htmlFunction.requestSmoke.rootCount === 1
      && htmlFunction.requestSmoke.transitiveTemplateLoaded,
    ogEndToEndSmokePassed: ogFunction?.requestSmoke.passed === true
      && ogFunction.requestSmoke.status !== 500
      && ogFunction.requestSmoke.png
      && Number.isInteger(ogFunction.requestSmoke.bytes)
      && ogFunction.requestSmoke.bytes >= 8,
    noExternalSmokeRequests: details.every((item) => (
      item.requestSmoke.externalNetworkDisabled === true
    )),
    independentFunctionSmokePassed: details.length === EXPECTED_STORE_FUNCTIONS.length
      && details.every((item) => (
        item.module.smoke.exitCode === 0
        && item.module.smoke.loaded
        && item.module.smoke.invocable
        && item.requestSmoke.passed
      )),
    internalFunctionSourceMapsSafe: details.every((item) => item.internalFunctionSourceMaps.every((map) => (
      map.generatedBy === '@vercel/node (inferred)'
      && map.insideFunctionBundle
      && !map.public
      && !map.referencedFromConfig
      && map.validJson
      && map.closureSafe
    ))),
    noPublicFonts: details.every((item) => item.fonts.every((font) => font.public === false)),
    htmlFunctionHasNoFonts: htmlFunction?.fonts.length === 0,
    ogFunctionFontsAllowed: ogFunction?.fonts.every((font) => font.allowed === true) === true,
    noEnvironmentFiles: details.every((item) => item.environmentFiles.length === 0),
    ogResolvesVercelOg: ogFunction?.dependencies.vercelOg === true,
    ogResolvesReact: ogFunction?.dependencies.react === true,
    htmlExcludesVercelOg: htmlFunction?.dependencies.vercelOg === false,
    htmlResolvesTemplate: Boolean(
      htmlFunction?.template.markerPresent
      && htmlFunction?.template.rootPresent
      && htmlFunction?.template.currentAssetsPresent,
    ),
    noSecrets: allViolations.secretViolations.length === 0,
    noAdministrativeCode: allViolations.administrativeViolations.length === 0,
    noPwa: allViolations.pwaViolations.length === 0,
    noBrokenLocalImports: allViolations.localImportViolations.length === 0,
  };
  checks.fontsPolicyValid = checks.noPublicFonts
    && checks.htmlFunctionHasNoFonts
    && checks.ogFunctionFontsAllowed;
  // Compatibility name for the aggregate gate; the granular checks remain in
  // the report so an OG closure font is never accepted generically.
  checks.noFonts = checks.fontsPolicyValid;
  return { bundles: details, routes, checks, safety: allViolations };
}

export async function inspectStatic(staticRoot, targetName) {
  const files = await walkOutputFiles(staticRoot);
  const items = await manifest(files);
  const paths = items.map((item) => item.path);
  const sources = await Promise.all(files
    .filter((file) => textExtensions.has(path.extname(file.relativePath).toLowerCase()))
    .map(async (file) => ({ ...file, source: await readFile(file.absolutePath, 'utf8') })));
  const safety = inspectTextForSafety(sources, targetName);
  const indexHtml = await readFile(path.join(staticRoot, 'index.html'), 'utf8');
  const assetPaths = paths.filter((item) => item.startsWith('assets/'));
  const checks = {
    indexPresent: paths.includes('index.html'),
    hashedJavascript: assetPaths.some((item) => /-[A-Za-z0-9_-]{6,}\.js$/u.test(item)),
    hashedCss: assetPaths.some((item) => /-[A-Za-z0-9_-]{6,}\.css$/u.test(item)),
    rootPresent: /\bid=["']root["']/u.test(indexHtml),
    noPublicSourceMaps: !paths.some((item) => item.endsWith('.map')),
    noFonts: !paths.some((item) => /\.(?:otf|ttf|woff2?)$/iu.test(item)),
    noSourceFiles: !paths.some((item) => /^(?:src|scripts|docs|tests|supabase)\//iu.test(item)),
    noPackages: !paths.some((item) => /^package(?:-lock)?\.json$/iu.test(item)),
    noEnvironmentFiles: !paths.some((item) => /(^|\/)\.env(?:\.|$)/iu.test(item)),
    noSecrets: safety.secretViolations.length === 0,
    noAdministrativeCode: safety.administrativeViolations.length === 0,
    noPwaContent: safety.pwaViolations.length === 0,
  };
  if (targetName === 'store') {
    checks.robotsPresent = paths.includes('robots.txt');
    checks.socialMarkersPresent = /LANZO_SOCIAL_HEAD_START/u.test(indexHtml)
      && /LANZO_SOCIAL_HEAD_END/u.test(indexHtml);
    checks.noPwaFiles = !paths.some((item) => (
      /(^|\/)(?:sw|service-worker|registerSW)[^/]*\.js$/iu.test(item)
      || /(^|\/)manifest\.webmanifest$/iu.test(item)
      || /(^|\/)workbox[^/]*\.js$/iu.test(item)
    ));
  } else {
    delete checks.noAdministrativeCode;
    delete checks.noPwaContent;
    checks.adminPwaPresent = paths.includes('manifest.webmanifest') && paths.includes('sw.js');
  }
  return { files, manifest: items, checks, safety };
}

export function verifyTemporaryStoreRoot({ workspaceRoot, effectiveStoreRoot, temporaryRoot = os.tmpdir(), prefix = STORE_WORKSPACE_PREFIX }) {
  const workspace = path.resolve(workspaceRoot);
  const store = path.resolve(effectiveStoreRoot);
  const temporary = path.resolve(temporaryRoot);
  const workspaceRelative = path.relative(temporary, workspace);
  const storeRelative = path.relative(workspace, store);
  return path.dirname(workspace) === temporary
    && !workspaceRelative.startsWith('..')
    && !path.isAbsolute(workspaceRelative)
    && path.basename(workspace).startsWith(prefix)
    && store === path.join(workspace, 'store')
    && storeRelative === 'store'
    && !normalizePath(store).includes('/store/store')
    && !storeRelative.startsWith('..')
    && !path.isAbsolute(storeRelative);
}

export function inspectPrebuiltBuildTarget(buildsJson) {
  const targetEnvironment = typeof buildsJson?.target === 'string'
    ? buildsJson.target.trim().toLowerCase()
    : null;
  const argv = Array.isArray(buildsJson?.argv)
    ? buildsJson.argv.filter((value) => typeof value === 'string')
    : [];
  const productionFlagPresent = argv.some((value) => (
    value === '--prod'
    || value === '--target=production'
    || value === '--target'
  )) && (
    argv.includes('--prod')
    || argv.includes('--target=production')
    || argv.some((value, index) => value === '--target' && argv[index + 1] === 'production')
  );
  return Object.freeze({
    targetEnvironment,
    deploymentType: targetEnvironment,
    production: targetEnvironment === 'production',
    argv,
    checks: Object.freeze({
      targetEnvironmentPresent: targetEnvironment !== null,
      targetEnvironmentPreview: targetEnvironment === EXPECTED_STORE_TARGET_ENVIRONMENT,
      noProductionBuildFlags: !productionFlagPresent,
    }),
  });
}

export async function auditPrebuiltOutput(targetName, packageRootArgument, options = {}) {
  const baseTarget = targets[targetName];
  if (!baseTarget) throw new Error('Target must be store or admin.');
  const target = {
    ...baseTarget,
    sourceConfig: options.sourceConfigPath || baseTarget.sourceConfig,
    sourceStatic: options.sourceStaticPath || baseTarget.sourceStatic,
    projectId: options.expectedProjectId || baseTarget.projectId,
    organizationId: options.expectedOrganizationId || baseTarget.organizationId,
  };
  const workspaceRoot = path.resolve(packageRootArgument);
  const effectiveStoreRoot = path.resolve(options.effectiveStoreRoot || path.join(workspaceRoot, 'store'));
  const projectLinkPath = path.join(workspaceRoot, '.vercel', 'project.json');
  const outputRoot = path.join(workspaceRoot, '.vercel', 'output');
  const outputConfigPath = path.join(outputRoot, 'config.json');
  const outputBuildsPath = path.join(outputRoot, 'builds.json');
  const outputStaticPath = path.join(outputRoot, 'static');
  const outputFunctionsPath = path.join(outputRoot, 'functions');
  for (const requiredPath of [
    target.sourceConfig,
    target.sourceStatic,
    projectLinkPath,
    outputConfigPath,
    outputStaticPath,
    ...(targetName === 'store' ? [outputBuildsPath] : []),
  ]) {
    if (!await pathExists(requiredPath)) throw new Error(`Missing prebuilt input: ${path.basename(requiredPath)}`);
  }

  const [sourceConfigBytes, outputConfigBytes, projectLinkBytes, outputBuildsBytes] = await Promise.all([
    readFile(target.sourceConfig),
    readFile(outputConfigPath),
    readFile(projectLinkPath),
    targetName === 'store' ? readFile(outputBuildsPath) : Promise.resolve(null),
  ]);
  const sourceConfig = JSON.parse(sourceConfigBytes.toString('utf8'));
  const outputConfig = JSON.parse(outputConfigBytes.toString('utf8'));
  const projectLink = JSON.parse(projectLinkBytes.toString('utf8'));
  const prebuiltBuild = outputBuildsBytes
    ? inspectPrebuiltBuildTarget(JSON.parse(outputBuildsBytes.toString('utf8')))
    : null;
  const [sourceStaticFiles, staticAudit] = await Promise.all([
    walkOutputFiles(target.sourceStatic),
    inspectStatic(outputStaticPath, targetName),
  ]);
  const outputFiles = await walkOutputFiles(outputRoot);
  const outputSourceMaps = outputFiles
    .map((file) => file.relativePath)
    .filter((item) => item.endsWith('.map'));
  const sourceStaticManifest = await manifest(sourceStaticFiles);
  const outputByPath = new Map(staticAudit.manifest.map((item) => [item.path, item]));
  const artifactMatches = sourceStaticManifest.length === staticAudit.manifest.length
    && sourceStaticManifest.every((item) => {
      const output = outputByPath.get(item.path);
      return output?.sha256 === item.sha256 && output.bytes === item.bytes;
    });

  const checks = {
    validJson: Boolean(sourceConfig && outputConfig && projectLink),
    projectLinkMatches: projectLink.projectId === target.projectId
      && projectLink.orgId === target.organizationId,
    artifactMatches,
    noDomainsOrAliases: !outputConfig.domains && !outputConfig.alias,
    noMiddleware: !outputConfig.middleware
      && !(outputConfig.routes || []).some((route) => route.middlewarePath),
    ...(targetName === 'store' ? inspectCompiledStoreRoutes(outputConfig, {
      staticPaths: staticAudit.manifest.map((item) => item.path),
    }).checks : {}),
    ...(targetName === 'store' ? prebuiltBuild.checks : {}),
    ...staticAudit.checks,
  };

  let functionAudit = null;
  let routeAudit = null;
  if (targetName === 'store') {
    routeAudit = inspectCompiledStoreRoutes(outputConfig, {
      staticPaths: staticAudit.manifest.map((item) => item.path),
    });
    functionAudit = await inspectFunctions(outputFunctionsPath, target.sourceStatic, outputConfig);
    Object.assign(checks, functionAudit.checks);
    checks.noPublicSourceMaps = staticAudit.checks.noPublicSourceMaps
      && outputSourceMaps.every((item) => item.startsWith('functions/') && item.includes('.func/'));
    checks.noPublicFonts = staticAudit.checks.noFonts && functionAudit.checks.noPublicFonts;
    checks.htmlFunctionHasNoFonts = functionAudit.checks.htmlFunctionHasNoFonts;
    checks.ogFunctionFontsAllowed = functionAudit.checks.ogFunctionFontsAllowed;
    checks.fontsPolicyValid = checks.noPublicFonts
      && checks.htmlFunctionHasNoFonts
      && checks.ogFunctionFontsAllowed;
    checks.noFonts = checks.fontsPolicyValid;
    checks.noSecrets = staticAudit.checks.noSecrets && functionAudit.checks.noSecrets;
    checks.noAdministrativeCode = staticAudit.checks.noAdministrativeCode
      && functionAudit.checks.noAdministrativeCode;
    checks.noPwa = staticAudit.checks.noPwaFiles
      && staticAudit.checks.noPwaContent
      && functionAudit.checks.noPwa;
  } else {
    checks.noFunctions = !await pathExists(outputFunctionsPath);
  }
  if (options.enforceTemporaryRoot !== false && targetName === 'store') {
    checks.temporaryWorkspace = verifyTemporaryStoreRoot({ workspaceRoot, effectiveStoreRoot });
  }
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
    .sort();
  return {
    phase: 'ECOM.PUBLIC.SOCIAL.PREVIEW.1.6',
    target: targetName,
    status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
    hashes: {
      sourceConfig: sha256(sourceConfigBytes),
      outputConfig: sha256(outputConfigBytes),
      ...(outputBuildsBytes ? { outputBuilds: sha256(outputBuildsBytes) } : {}),
      sourceStaticTree: treeHash(sourceStaticManifest),
      outputStaticTree: treeHash(staticAudit.manifest),
    },
    output: {
      configVersion: outputConfig.version,
      routes: outputConfig.routes?.length || 0,
      staticFiles: staticAudit.files.length,
      staticBytes: staticAudit.files.reduce((total, file) => total + file.bytes, 0),
      functions: functionAudit?.routes || [],
      outputRoot: normalizePath(path.relative(workspaceRoot, outputRoot)),
      sourceMaps: outputSourceMaps,
      ...(prebuiltBuild ? {
        targetEnvironment: prebuiltBuild.targetEnvironment,
        deploymentType: prebuiltBuild.deploymentType,
        production: prebuiltBuild.production,
      } : {}),
    },
    ...(prebuiltBuild ? {
      targetEnvironment: prebuiltBuild.targetEnvironment,
      deploymentType: prebuiltBuild.deploymentType,
      production: prebuiltBuild.production,
      deploymentExecuted: false,
    } : {}),
    routing: routeAudit,
    functionAudit,
    staticAudit: {
      checks: staticAudit.checks,
      safety: staticAudit.safety,
      sourceMaps: staticAudit.manifest.filter((item) => item.path.endsWith('.map')).map((item) => item.path),
    },
    checks,
    failedChecks,
  };
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  auditPrebuiltOutput(process.argv[2], process.argv[3])
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.status !== 'PASS') process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        status: 'FAIL',
        error: String(error?.message || error).slice(0, 500),
      }));
      process.exitCode = 1;
    });
}
