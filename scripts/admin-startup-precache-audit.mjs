import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTUP_ASSET_PATTERN = /["'](assets\/[^"']+\.(?:js|css))["']/g;

export const CORE_LOCAL_ROUTE_PREFIXES = Object.freeze([
  'PosPage',
  'CajaPage',
  'OrderPage',
  'ProductsPage',
  'CustomersPage',
  'DashboardPage',
  'SettingsPage',
  'AboutPage',
]);

export function extractReferencedStartupAssets(source = '') {
  return [...new Set(
    Array.from(String(source).matchAll(STARTUP_ASSET_PATTERN), (match) => match[1])
  )].sort();
}

export function extractPrecachedAssetUrls(workerSource = '') {
  return [...new Set(
    Array.from(
      String(workerSource).matchAll(/(?:\burl|"url")\s*:\s*["'](assets\/[^"']+\.(?:js|css))["']/g),
      (match) => match[1]
    )
  )].sort();
}

export function findMissingStartupPrecacheAssets({
  bootstrapSource = '',
  workerSource = '',
} = {}) {
  const referenced = extractReferencedStartupAssets(bootstrapSource);
  const precached = new Set(extractPrecachedAssetUrls(workerSource));
  return referenced.filter((asset) => !precached.has(asset));
}

export function extractViteDependencyMap(appSource = '') {
  const source = String(appSource);
  const markerIndex = source.indexOf('m.f=[');
  if (markerIndex < 0) return [];

  const arrayStart = source.indexOf('[', markerIndex);
  if (arrayStart < 0) return [];

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '[') depth += 1;
    if (char !== ']') continue;

    depth -= 1;
    if (depth !== 0) continue;

    const rawArray = source.slice(arrayStart, index + 1);
    try {
      return JSON.parse(rawArray);
    } catch (error) {
      throw new Error('Unable to parse Vite dependency map: ' + error.message);
    }
  }

  return [];
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

export function extractCoreLocalRouteAssets(
  appSource = '',
  routePrefixes = CORE_LOCAL_ROUTE_PREFIXES,
) {
  const source = String(appSource);
  const dependencyMap = extractViteDependencyMap(source);
  if (dependencyMap.length === 0) return [];

  const assets = new Set();

  for (const prefix of routePrefixes) {
    const routePattern = new RegExp(
      'import\\("\\.\\/(' + escapeRegExp(prefix) + '-[^"]+\\.js)"\\),__vite__mapDeps\\(\\[([^\\]]*)\\]\\)'
    );
    const match = source.match(routePattern);

    // Las rutas Local esenciales pueden ser imports estáticos. En ese caso no
    // existe un import() lazy que auditar aquí: forman parte del cierre de
    // arranque y quedan cubiertas por la arquitectura/evidencia de build.
    if (!match) continue;

    assets.add('assets/' + match[1]);

    const indexes = match[2]
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isInteger);

    for (const index of indexes) {
      const asset = dependencyMap[index];
      if (typeof asset === 'string' && /\.(?:js|css)$/.test(asset)) {
        assets.add(asset);
      }
    }
  }

  return [...assets].sort();
}

export function findMissingCoreLocalRoutePrecacheAssets({
  appSource = '',
  workerSource = '',
  routePrefixes = CORE_LOCAL_ROUTE_PREFIXES,
} = {}) {
  const referenced = extractCoreLocalRouteAssets(appSource, routePrefixes);
  const precached = new Set(extractPrecachedAssetUrls(workerSource));
  return referenced.filter((asset) => !precached.has(asset));
}

async function findSingleAsset(outDir, pattern, label) {
  const assetsDir = path.join(outDir, 'assets');
  const matches = (await readdir(assetsDir)).filter((filename) => pattern.test(filename));

  if (matches.length !== 1) {
    throw new Error(
      'Expected exactly one ' + label + ' asset, found ' + matches.length + ': ' + matches.join(', ')
    );
  }

  return path.join(assetsDir, matches[0]);
}

const findSingleBootstrapAsset = (outDir) => (
  findSingleAsset(outDir, /^PosApplicationBootstrap-[^.]+\.js$/, 'PosApplicationBootstrap')
);

const findSingleAppAsset = (outDir) => (
  findSingleAsset(outDir, /^App-[^.]+\.js$/, 'App')
);

export async function auditAdminStartupPrecache({ outDir }) {
  const [bootstrapPath, appPath] = await Promise.all([
    findSingleBootstrapAsset(outDir),
    findSingleAppAsset(outDir),
  ]);
  const workerPath = path.join(outDir, 'sw.js');

  const [bootstrapSource, appSource, workerSource] = await Promise.all([
    readFile(bootstrapPath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(workerPath, 'utf8'),
  ]);

  const referenced = extractReferencedStartupAssets(bootstrapSource);
  const coreLocalRouteAssets = extractCoreLocalRouteAssets(appSource);

  await Promise.all([
    ...referenced,
    ...coreLocalRouteAssets,
  ].map((asset) => access(path.join(outDir, asset))));

  const missing = findMissingStartupPrecacheAssets({
    bootstrapSource,
    workerSource,
  });

  if (missing.length > 0) {
    throw new Error(
      'Administrative startup assets are missing from the Service Worker precache: ' + missing.join(', ')
    );
  }

  const missingCoreLocalRoutes = findMissingCoreLocalRoutePrecacheAssets({
    appSource,
    workerSource,
  });

  if (missingCoreLocalRoutes.length > 0) {
    throw new Error(
      'Core Local route assets are missing from the Service Worker precache: ' + missingCoreLocalRoutes.join(', ')
    );
  }

  return {
    bootstrapAsset: path.relative(outDir, bootstrapPath).replaceAll('\\', '/'),
    appAsset: path.relative(outDir, appPath).replaceAll('\\', '/'),
    referenced,
    coreLocalRouteAssets,
    missing,
    missingCoreLocalRoutes,
  };
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedPath === modulePath) {
  const outDir = path.resolve(process.cwd(), 'dist');
  try {
    const result = await auditAdminStartupPrecache({ outDir });
    console.info(
      '[lanzo-admin-startup-precache-audit] Verified ' +
      result.referenced.length +
      ' startup assets and ' +
      result.coreLocalRouteAssets.length +
      ' core Local route assets.'
    );
  } catch (error) {
    console.error('[lanzo-admin-startup-precache-audit] Failed:', error);
    process.exitCode = 1;
  }
}
