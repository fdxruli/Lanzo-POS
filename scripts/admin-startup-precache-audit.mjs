import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const STARTUP_ASSET_PATTERN = /["'](assets\/[^"']+\.(?:js|css))["']/g;

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

async function findSingleBootstrapAsset(outDir) {
  const assetsDir = path.join(outDir, 'assets');
  const matches = (await readdir(assetsDir))
    .filter((filename) => /^PosApplicationBootstrap-[^.]+\.js$/.test(filename));

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one PosApplicationBootstrap asset, found ${matches.length}: ${matches.join(', ')}`
    );
  }

  return path.join(assetsDir, matches[0]);
}

export async function auditAdminStartupPrecache({ outDir }) {
  const bootstrapPath = await findSingleBootstrapAsset(outDir);
  const workerPath = path.join(outDir, 'sw.js');
  const [bootstrapSource, workerSource] = await Promise.all([
    readFile(bootstrapPath, 'utf8'),
    readFile(workerPath, 'utf8'),
  ]);

  const referenced = extractReferencedStartupAssets(bootstrapSource);
  await Promise.all(referenced.map((asset) => access(path.join(outDir, asset))));

  const missing = findMissingStartupPrecacheAssets({
    bootstrapSource,
    workerSource,
  });

  if (missing.length > 0) {
    throw new Error(
      `Administrative startup assets are missing from the Service Worker precache: ${missing.join(', ')}`
    );
  }

  return {
    bootstrapAsset: path.relative(outDir, bootstrapPath).replaceAll('\\', '/'),
    referenced,
    missing,
  };
}

export function createAdminStartupPrecacheAuditPlugin() {
  let resolvedOutDir = '';

  return {
    name: 'lanzo-admin-startup-precache-audit',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await auditAdminStartupPrecache({ outDir: resolvedOutDir });
    },
  };
}
