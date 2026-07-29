/**
 * Read-only audit for Vercel Build Output API artifacts.
 *
 * Usage:
 *   node scripts/audit-vercel-build-output.mjs store <temporary-workspace-store-root>
 *   node scripts/audit-vercel-build-output.mjs admin <temporary-package-root>
 */
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

export function inspectCompiledStoreRoutes(outputConfig) {
  const routes = Array.isArray(outputConfig?.routes) ? outputConfig.routes : [];
  const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
  const errorIndex = routes.findIndex((route) => route.handle === 'error');
  const dynamicRoute = matchingRoute(
    routes,
    '/tienda/mi-tienda',
    (route) => typeof route.dest === 'string' && route.dest.startsWith('/api/store-page'),
  );
  const trackingRoute = matchingRoute(
    routes,
    '/tienda/mi-tienda/pedido/token-ficticio',
    (route) => typeof route.dest === 'string',
  );
  const nestedRoute = matchingRoute(
    routes,
    '/tienda/mi-tienda/ruta-anidada',
    (route) => typeof route.dest === 'string',
  );
  const canonicalRoute = routes.find((route) => (
    route.status === 308
    && routeHeader(route, 'Location') === '/$1'
    && typeof route.src === 'string'
    && route.src.includes('(.*)/$')
  ));
  const assetHeader = matchingRoute(
    routes,
    '/assets/example-AbCd1234.js',
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
    const result = dynamicRoute
      ? applyCompiledDestination(dynamicRoute, pathname, search)
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
    dynamicStoreRoute: Boolean(dynamicRoute),
    dynamicAfterFilesystem: dynamicRoute ? routes.indexOf(dynamicRoute) > filesystemIndex : false,
    dynamicDestination: cases.every((item) => item.destination === '/api/store-page'),
    pathSlugExactlyOnce: cases.every((item) => (
      item.slugValues.length === 1 && item.slugValues[0] === 'mi-tienda'
    )),
    trackingStatic: Boolean(trackingRoute)
      && trackingRoute.dest.startsWith('/index.html')
      && !trackingRoute.dest.includes('tracking'),
    nestedStoreStatic: Boolean(nestedRoute) && nestedRoute.dest.startsWith('/index.html'),
    assetsNotIntercepted: !matchingRoute(
      routes.slice(filesystemIndex + 1),
      '/assets/example-AbCd1234.js',
      (route) => typeof route.dest === 'string',
    ),
    apiNotIntercepted: !matchingRoute(
      routes.slice(filesystemIndex + 1),
      '/api/store-page',
      (route) => typeof route.dest === 'string' && route.dest.startsWith('/index.html'),
    ),
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
    dynamicRoute: dynamicRoute
      ? { src: dynamicRoute.src, dest: dynamicRoute.dest }
      : null,
  });
}

async function discoverFunctionBundles(functionsRoot) {
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
          bundles.push({ absolutePath, relative, route: null, config: null, missingConfig: true });
          continue;
        }
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        bundles.push({
          absolutePath,
          relative,
          route: `/${relative.slice(0, -'.func'.length)}`,
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
    credentialValue: /\b(?:client_secret|refresh_token|access_token)\b\s*[:=]\s*["'][^"'${}<>\s]{8,}["']/iu,
  });
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(source))
    .map(([name]) => name);
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

function inspectTextForSafety(filesWithSource) {
  const secretViolations = [];
  const credentialVocabulary = {};
  const administrativeViolations = [];
  const pwaViolations = [];
  const localImportViolations = [];
  const administrativeMarkers = Object.freeze({
    LanzoDB: /\bLanzoDB\b/u,
    Dexie: /\bDexie\b/u,
    PosPage: /\bPosPage\b/u,
    Caja: /\bCaja\b/u,
    Dashboard: /\bDashboard\b/u,
    processSale: /\bprocessSale\b/u,
    cashSync: /\bcashSync\b/u,
    posSync: /\bposSync\b/u,
    deviceSecurityToken: /\bdevice_security_token\b/u,
    staffSessionToken: /\bstaff_session_token\b/u,
    createFreeTrialLicense: /\bcreate_free_trial_license\b/u,
    releaseDeviceAnon: /\breleaseDeviceAnon|release_device_anon/u,
    googleDrive: /\bgoogleDrive\b/u,
  });
  const pwaMarkers = Object.freeze({
    serviceWorker: /serviceWorker\.register|service-worker|registerSW/iu,
    workbox: /\bworkbox\b|__WB_MANIFEST/iu,
    manifest: /manifest\.webmanifest/iu,
  });
  for (const { relativePath, source } of filesWithSource) {
    for (const name of [
      ...inspectCredentialValues(source),
      ...inspectPrivilegedJwt(source),
      ...inspectCredentialAssignments(source),
    ]) {
      secretViolations.push(`${name}:${relativePath}`);
    }
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
    if (
      /(?:from\s*|import\s*\()\s*["'](?:\.\.\/)+(?:src|supabase)\//u.test(source)
      || /(?:file:\/\/|\/workspace\/|[A-Za-z]:\\)/u.test(source)
    ) localImportViolations.push(relativePath);
  }
  return {
    secretViolations: [...new Set(secretViolations)].sort(),
    credentialVocabulary,
    administrativeViolations: [...new Set(administrativeViolations)].sort(),
    pwaViolations: [...new Set(pwaViolations)].sort(),
    localImportViolations: [...new Set(localImportViolations)].sort(),
  };
}

async function inspectFunctions(functionsRoot, sourceStaticPath) {
  const bundles = await discoverFunctionBundles(functionsRoot);
  const routes = bundles.map((bundle) => bundle.route).filter(Boolean).sort();
  const details = [];
  const allViolations = {
    secretViolations: [],
    administrativeViolations: [],
    pwaViolations: [],
    localImportViolations: [],
    credentialVocabulary: {},
  };
  const currentHtml = await readFile(path.join(sourceStaticPath, 'index.html'), 'utf8');
  const currentAssets = [...currentHtml.matchAll(/\/assets\/[^"' ]+-[A-Za-z0-9_-]{6,}\.(?:js|css)/gu)]
    .map((match) => match[0]);

  for (const bundle of bundles) {
    const files = await walkOutputFiles(bundle.absolutePath);
    const paths = files.map((file) => file.relativePath);
    const sources = await Promise.all(files
      .filter((file) => textExtensions.has(path.extname(file.relativePath).toLowerCase()))
      .map(async (file) => ({ ...file, source: await readFile(file.absolutePath, 'utf8') })));
    const joined = sources.map(({ source }) => source).join('\n');
    const safety = inspectTextForSafety(sources);
    for (const key of [
      'secretViolations',
      'administrativeViolations',
      'pwaViolations',
      'localImportViolations',
    ]) allViolations[key].push(...safety[key].map((item) => `${bundle.route}:${item}`));
    for (const [name, occurrences] of Object.entries(safety.credentialVocabulary)) {
      allViolations.credentialVocabulary[name] ||= [];
      allViolations.credentialVocabulary[name].push(
        ...occurrences.map((item) => `${bundle.route}:${item}`),
      );
    }
    const configReadable = Boolean(bundle.config && typeof bundle.config === 'object');
    const handler = bundle.config?.handler;
    details.push({
      route: bundle.route,
      runtime: bundle.config?.runtime || null,
      handler: handler || null,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      configReadable,
      handlerPresent: typeof handler === 'string' && paths.includes(handler),
      sourceMaps: paths.filter((item) => item.endsWith('.map')),
      fonts: paths.filter((item) => /\.(?:otf|ttf|woff2?)$/iu.test(item)),
      environmentFiles: paths.filter((item) => /(^|\/)\.env(?:\.|$)/iu.test(item)),
      dependencies: {
        vercelOg: /@vercel\/og/u.test(joined),
        react: /(?:node_modules\/react|["']react["']|react\.production)/u.test(joined),
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

  const htmlFunction = details.find((item) => item.route === '/api/store-page');
  const ogFunction = details.find((item) => item.route === '/api/og/store');
  const checks = {
    exactlyExpectedFunctions: JSON.stringify(routes) === JSON.stringify(EXPECTED_STORE_FUNCTIONS),
    readableConfigs: details.every((item) => item.configReadable),
    validRuntime: details.every((item) => /^nodejs\d+(?:\.x)?$/u.test(item.runtime || '')),
    validHandlers: details.every((item) => item.handlerPresent),
    noSourceMaps: details.every((item) => item.sourceMaps.length === 0),
    noFonts: details.every((item) => item.fonts.length === 0),
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
  return { bundles: details, routes, checks, safety: allViolations };
}

export async function inspectStatic(staticRoot, targetName) {
  const files = await walkOutputFiles(staticRoot);
  const items = await manifest(files);
  const paths = items.map((item) => item.path);
  const sources = await Promise.all(files
    .filter((file) => textExtensions.has(path.extname(file.relativePath).toLowerCase()))
    .map(async (file) => ({ ...file, source: await readFile(file.absolutePath, 'utf8') })));
  const safety = inspectTextForSafety(sources);
  const indexHtml = await readFile(path.join(staticRoot, 'index.html'), 'utf8');
  const assetPaths = paths.filter((item) => item.startsWith('assets/'));
  const checks = {
    indexPresent: paths.includes('index.html'),
    hashedJavascript: assetPaths.some((item) => /-[A-Za-z0-9_-]{6,}\.js$/u.test(item)),
    hashedCss: assetPaths.some((item) => /-[A-Za-z0-9_-]{6,}\.css$/u.test(item)),
    rootPresent: /\bid=["']root["']/u.test(indexHtml),
    noSourceMaps: !paths.some((item) => item.endsWith('.map')),
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

function verifyTemporaryStoreRoot(packageRoot) {
  const resolved = path.resolve(packageRoot);
  const workspaceRoot = path.dirname(resolved);
  return path.basename(resolved) === 'store'
    && path.dirname(workspaceRoot) === path.resolve(os.tmpdir())
    && path.basename(workspaceRoot).startsWith(STORE_WORKSPACE_PREFIX);
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
  const packageRoot = path.resolve(packageRootArgument);
  const projectLinkPath = path.join(packageRoot, '.vercel', 'project.json');
  const outputRoot = path.join(packageRoot, '.vercel', 'output');
  const outputConfigPath = path.join(outputRoot, 'config.json');
  const outputStaticPath = path.join(outputRoot, 'static');
  const outputFunctionsPath = path.join(outputRoot, 'functions');
  for (const requiredPath of [
    target.sourceConfig,
    target.sourceStatic,
    projectLinkPath,
    outputConfigPath,
    outputStaticPath,
  ]) {
    if (!await pathExists(requiredPath)) throw new Error(`Missing prebuilt input: ${path.basename(requiredPath)}`);
  }

  const [sourceConfigBytes, outputConfigBytes, projectLinkBytes] = await Promise.all([
    readFile(target.sourceConfig),
    readFile(outputConfigPath),
    readFile(projectLinkPath),
  ]);
  const sourceConfig = JSON.parse(sourceConfigBytes.toString('utf8'));
  const outputConfig = JSON.parse(outputConfigBytes.toString('utf8'));
  const projectLink = JSON.parse(projectLinkBytes.toString('utf8'));
  const [sourceStaticFiles, staticAudit] = await Promise.all([
    walkOutputFiles(target.sourceStatic),
    inspectStatic(outputStaticPath, targetName),
  ]);
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
    ...(targetName === 'store' ? inspectCompiledStoreRoutes(outputConfig).checks : {}),
    ...staticAudit.checks,
  };

  let functionAudit = null;
  let routeAudit = null;
  if (targetName === 'store') {
    routeAudit = inspectCompiledStoreRoutes(outputConfig);
    functionAudit = await inspectFunctions(outputFunctionsPath, target.sourceStatic);
    Object.assign(checks, functionAudit.checks);
    checks.noSourceMaps = staticAudit.checks.noSourceMaps && functionAudit.checks.noSourceMaps;
    checks.noFonts = staticAudit.checks.noFonts && functionAudit.checks.noFonts;
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
    checks.temporaryWorkspace = verifyTemporaryStoreRoot(packageRoot);
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
      sourceStaticTree: treeHash(sourceStaticManifest),
      outputStaticTree: treeHash(staticAudit.manifest),
    },
    output: {
      configVersion: outputConfig.version,
      routes: outputConfig.routes?.length || 0,
      staticFiles: staticAudit.files.length,
      staticBytes: staticAudit.files.reduce((total, file) => total + file.bytes, 0),
      functions: functionAudit?.routes || [],
    },
    routing: routeAudit,
    functionAudit,
    staticAudit: {
      checks: staticAudit.checks,
      safety: staticAudit.safety,
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
