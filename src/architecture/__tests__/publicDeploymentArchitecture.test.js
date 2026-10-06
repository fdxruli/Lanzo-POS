// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateCompiledRoute } from '../../../scripts/audit-vercel-build-output.mjs';
import { classifyReservedSourceResponse } from '../../../scripts/audit-remote-store-deployment.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, root));
    else if (entry.isFile()) files.push(path.relative(root, absolutePath).replaceAll('\\', '/'));
  }
  return files.sort();
}

async function fileManifest(directory) {
  const files = await walk(directory);
  return Promise.all(files.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await readFile(path.join(directory, relativePath)))
  })));
}

const SOURCE_STATIC_PATHS = new Set([
  'home.html',
  'index.html',
  'robots.txt',
  'assets/index-ABC123.js',
  'assets/index-ABC123.css',
  'assets/logIcon-ABC123.svg',
]);

function evaluateSourceRoute(config, rawPath) {
  const pathname = new URL(rawPath, 'https://lanzo-store.vercel.app').pathname;
  return evaluateCompiledRoute(config.routes, pathname, SOURCE_STATIC_PATHS);
}

function rewriteFor(config, rawPath) {
  const result = evaluateSourceRoute(config, rawPath);
  return result.kind === 'rewrite' ? { destination: result.pathname, index: result.index } : null;
}

function redirectFor(config, rawPath) {
  const url = new URL(rawPath, 'https://lanzo-store.vercel.app');
  const result = evaluateSourceRoute(config, url.pathname);
  if (result.kind !== 'redirect') return null;
  const route = config.routes[result.index];
  const match = new RegExp(route.src).exec(url.pathname);
  let location = route.headers?.Location || '';
  for (let index = 1; match && index < match.length; index += 1) {
    location = location.replaceAll(`$${index}`, match[index] || '');
  }
  return { status: result.status, location: `${location}${url.search}` };
}

function headerValuesFor(config, rawPath, key) {
  return evaluateSourceRoute(config, rawPath).headers
    .flatMap(({ headers }) => Object.entries(headers))
    .filter(([name]) => name.toLowerCase() === key.toLowerCase())
    .map(([, value]) => value);
}

describe('standalone public Vercel deployment architecture', () => {
  let config;
  let adminConfigBefore;
  let distBefore;
  let rootVercelBefore;
  let preparation;
  let packageRoot;
  let temporaryRoot;
  let localIndex;
  let localIndexSha256;

  beforeAll(async () => {
    config = JSON.parse(await readProjectFile('store/vercel.json'));
    adminConfigBefore = await readProjectFile('vercel.json');
    distBefore = await fileManifest(path.join(projectRoot, 'dist-store'));
    rootVercelBefore = await pathExists(path.join(projectRoot, '.vercel'));
    localIndex = await readFile(path.join(projectRoot, 'dist-store', 'index.html'));
    localIndexSha256 = sha256(localIndex);

    const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'prepare-store-deployment.mjs')], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Preparation failed.');
    preparation = JSON.parse(result.stdout);
    packageRoot = preparation.packageDirectory;
    temporaryRoot = packageRoot;
  }, 60_000);

  afterAll(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (preparation?.auditManifestPath) await rm(preparation.auditManifestPath, { force: true });
  });

  it('keeps a dedicated static public config without server, PWA, Git, domain, or paid resources', () => {
    expect(config.$schema).toBe('https://openapi.vercel.sh/vercel.json');
    expect(config).not.toHaveProperty('trailingSlash');
    expect(config).not.toHaveProperty('rewrites');
    expect(config).not.toHaveProperty('headers');
    expect(config).not.toHaveProperty('redirects');
    expect(config).not.toHaveProperty('builds');
    expect(config.installCommand).toBe('cd .. && npm ci');
    expect(config.buildCommand).toBe('cd .. && npm run build:store:vercel');
    expect(config.outputDirectory).toBe('dist');
    expect(config).not.toHaveProperty('functions');
    expect(config).not.toHaveProperty('crons');
    expect(config).not.toHaveProperty('domains');
    expect(config).not.toHaveProperty('github');
    expect(Array.isArray(config.routes)).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/serviceWorker|service_role/i);
  });

  it('uses an explicit no-trailing-slash route without hardcoded storefront slugs', () => {
    const serialized = JSON.stringify(config);
    const canonical = config.routes.find((route) => (
      route.status === 308
      && route.headers?.Location === '/$1'
      && route.src === '^/(.*)/$'
    ));
    expect(canonical).toBeTruthy();
    expect(canonical.headers['X-Robots-Tag']).toBe('noindex, nofollow, noarchive');
    expect(serialized).not.toMatch(/demo-seguro|slug-inexistente-seguro|token-invalido-seguro/);

    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    const root = config.routes.findIndex((route) => route.src === '^/$' && route.dest === '/home.html');
    const tracking = config.routes.findIndex(
      (route) => route.src === '^/tienda/([^/]+)/pedido/([^/]+)$',
    );
    const dynamicStore = config.routes.findIndex((route) => route.src === '^/tienda/([^/]+)$');
    const fallback = config.routes.findIndex(
      (route) => route.dest === '/index.html' && route.src.includes('(?!(?:api|assets)'),
    );
    expect(root).toBeLessThan(filesystem);
    expect(tracking).toBeGreaterThan(filesystem);
    expect(dynamicStore).toBeGreaterThan(tracking);
    expect(fallback).toBeGreaterThan(dynamicStore);
  });

  it('does not reuse or modify the administrative vercel.json', async () => {
    const publicConfig = await readProjectFile('store/vercel.json');
    expect(publicConfig).not.toBe(adminConfigBefore);
    expect(await readProjectFile('vercel.json')).toBe(adminConfigBefore);
  });

  it('resolves the acquisition root to home.html before implicit index.html', () => {
    expect(rewriteFor(config, '/')?.destination).toBe('/home.html');
    const result = evaluateSourceRoute(config, '/');
    const filesystem = config.routes.findIndex((route) => route.handle === 'filesystem');
    expect(result.kind).toBe('rewrite');
    expect(result.index).toBeLessThan(filesystem);
  });

  it.each([
    '/tienda',
    '/tienda/demo-seguro/pedido/token-seguro',
    '/tienda/demo-seguro/ruta-anidada',
    '/conoce-lanzo',
    '/esto-no-existe',
  ])('keeps the shared or fallback public route %s on index.html', (pathname) => {
    expect(rewriteFor(config, pathname)?.destination).toBe('/index.html');
  });

  it('keeps the one-segment storefront route on the HTML function', () => {
    expect(rewriteFor(config, '/tienda/demo-seguro')?.destination).toBe('/api/store-page');
  });

  it.each([
    ['/tienda/', '/tienda'],
    ['/tienda/demo-seguro/', '/tienda/demo-seguro'],
    ['/tienda/demo-seguro/pedido/token-seguro/', '/tienda/demo-seguro/pedido/token-seguro'],
    ['/conoce-lanzo/', '/conoce-lanzo'],
    ['/tienda/demo-seguro/?arch=deploy-1-1', '/tienda/demo-seguro?arch=deploy-1-1'],
  ])('canonicalizes %s once to %s before public routing', (source, expected) => {
    const redirect = redirectFor(config, source);
    expect(redirect).toEqual({ status: 308, location: expected });
    expect(redirectFor(config, expected)).toBeNull();
  });

  it.each([
    '/sw.js',
    '/manifest.webmanifest',
    '/registerSW.js',
    '/workbox-fixture.js',
    '/.env',
    '/.env.local',
    '/package.json',
    '/package-lock.json',
    '/src/main-store.jsx',
    '/vite.store.config.js',
    '/vercel.json',
    '/_src',
    '/robots-no-existente.txt',
    '/api/ruta-inexistente',
    '/assets/ruta-inexistente.js',
  ])('does not rewrite the forbidden, reserved, API, or asset route %s', (pathname) => {
    expect(rewriteFor(config, pathname)).toBeNull();
  });

  it('leaves real assets on filesystem before the SPA fallback', () => {
    for (const pathname of [
      '/assets/index-ABC123.js',
      '/assets/index-ABC123.css',
      '/assets/logIcon-ABC123.svg',
    ]) {
      expect(evaluateSourceRoute(config, pathname)).toMatchObject({
        kind: 'filesystem',
        pathname,
      });
    }
  });

  it('classifies a 404 /_src response as an acceptable reserved platform route', () => {
    const result = classifyReservedSourceResponse({
      status: 404,
      contentType: 'text/plain',
      bytes: Buffer.from('Not Found'),
      localIndexSha256
    });
    expect(result.accepted).toBe(true);
    expect(result.classification).toBe('platform-reserved-not-found');
  });

  it.each([
    'https://vercel.com/deployments/lanzo-store.vercel.app/source',
    'https://www.vercel.com/deployments/lanzo-store.vercel.app/source'
  ])('accepts a guarded /_src redirect only to an official Vercel host: %s', (location) => {
    const result = classifyReservedSourceResponse({
      status: 307,
      location,
      contentType: 'text/plain',
      bytes: Buffer.alloc(0),
      localIndexSha256
    });
    expect(result.accepted).toBe(true);
    expect(result.classification).toBe('platform-reserved-redirect');
  });

  it('rejects a /_src redirect to an unauthorized hostname', () => {
    const result = classifyReservedSourceResponse({
      status: 307,
      location: 'https://example.com/source',
      contentType: 'text/plain',
      bytes: Buffer.alloc(0),
      localIndexSha256
    });
    expect(result.accepted).toBe(false);
    expect(result.violations).toContain('reserved-src-location-not-vercel');
  });

  it('rejects a 200 /_src response that serves the public Lanzo index', () => {
    const result = classifyReservedSourceResponse({
      status: 200,
      contentType: 'text/html',
      bytes: localIndex,
      localIndexSha256
    });
    expect(result.accepted).toBe(false);
    expect(result.violations).toContain('reserved-src-returned-public-index');
    expect(result.violations).toContain('reserved-src-status:200');
  });

  it('rejects /_src when a redirect body exposes package or source content', () => {
    const result = classifyReservedSourceResponse({
      status: 308,
      location: 'https://vercel.com/source',
      contentType: 'text/plain',
      bytes: Buffer.from('package.json src/main-store.jsx'),
      localIndexSha256
    });
    expect(result.accepted).toBe(false);
    expect(result.violations).toContain('reserved-src-exposed-package-content');
  });

  it('applies noindex globally, revalidation to canonical HTML, and immutable caching only to hashed assets', () => {
    for (const pathname of [
      '/',
      '/index.html',
      '/home.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/demo/pedido/token',
      '/tienda/demo',
      '/esto-no-existe',
      '/package.json',
    ]) {
      expect(headerValuesFor(config, pathname, 'X-Robots-Tag'))
        .toContain('noindex, nofollow, noarchive');
    }

    for (const pathname of [
      '/',
      '/index.html',
      '/home.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/demo/pedido/token',
    ]) {
      expect(headerValuesFor(config, pathname, 'Cache-Control'))
        .toContain('public, max-age=0, must-revalidate');
    }

    expect(headerValuesFor(config, '/tienda/demo', 'Cache-Control')).toEqual([]);
    expect(headerValuesFor(config, '/assets/index-ABC123.js', 'Cache-Control')).toContain(
      'public, max-age=31536000, immutable',
    );
  });

  it('prepares only dist-store plus robots.txt and the public config', async () => {
    const distFiles = await walk(path.join(projectRoot, 'dist-store'));
    const packageFiles = await walk(packageRoot);
    expect(packageFiles).toEqual([...distFiles, 'robots.txt', 'vercel.json'].sort());
    expect(await readFile(path.join(packageRoot, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
    expect(await readFile(path.join(packageRoot, 'vercel.json'), 'utf8')).toBe(await readProjectFile('store/vercel.json'));
    expect(packageFiles).not.toContain('sha256-manifest.json');
  });

  it('stores a path-safe SHA-256 manifest outside the deployable directory', async () => {
    const manifest = JSON.parse(await readFile(preparation.auditManifestPath, 'utf8'));
    expect(path.dirname(preparation.auditManifestPath)).toBe(path.dirname(temporaryRoot));
    expect(manifest.files).toHaveLength(preparation.deploymentPackage.files);
    expect(manifest.files.every((file) => !path.isAbsolute(file.path))).toBe(true);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(manifest.treeSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('contains no forbidden files, PWA, administrative code, or detected secrets', () => {
    expect(preparation.deploymentPackage.forbiddenPaths).toEqual([]);
    expect(preparation.deploymentPackage.pwaViolations).toEqual([]);
    expect(preparation.deploymentPackage.administrativeViolations).toEqual([]);
    expect(preparation.deploymentPackage.secretViolations).toEqual([]);
    expect(preparation.publicConfiguration.trailingSlash).toBe(false);
    expect(preparation.publicConfiguration.serviceRolePresent).toBe(false);
    expect(preparation.publicConfiguration.publishableCredentialPresent).toBe(true);
    expect(preparation.publicConfiguration.persistSessionFalse).toBe(true);
  });

  it('keeps the package free of PWA and administrative files', async () => {
    const packageFiles = await walk(packageRoot);
    expect(packageFiles).not.toContain('manifest.webmanifest');
    expect(packageFiles).not.toContain('sw.js');
    expect(packageFiles.some((file) => /workbox|registerSW|(?:^|\/)App|PosPage|Dashboard|Caja/i.test(file))).toBe(false);
  });

  it('never deploys and never creates a root Vercel link', async () => {
    expect(preparation.deployCommandExecuted).toBe(false);
    expect(preparation.protectedRoot.rootVercelDirectoryPresentBefore).toBe(rootVercelBefore);
    expect(preparation.protectedRoot.rootVercelDirectoryPresentAfter).toBe(rootVercelBefore);
    expect(await pathExists(path.join(projectRoot, '.vercel'))).toBe(rootVercelBefore);
  });

  it('leaves dist-store byte-identical and keeps Git absent', async () => {
    expect(await fileManifest(path.join(projectRoot, 'dist-store'))).toEqual(distBefore);
    expect(await pathExists(path.join(projectRoot, '.git'))).toBe(false);
  });
});
