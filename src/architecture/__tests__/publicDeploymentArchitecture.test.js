// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

function matchesSource(source, pathname) {
  if (source === '/(.*)') return pathname.startsWith('/');
  if (source.endsWith('/:path*')) {
    const base = source.slice(0, -7);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return source === pathname;
}

function canonicalUrlFor(config, rawPath) {
  const url = new URL(rawPath, 'https://lanzo-store.vercel.app');
  if (config.trailingSlash === false && url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return `${url.pathname}${url.search}`;
}

function rewriteFor(config, rawPath) {
  const pathname = new URL(rawPath, 'https://lanzo-store.vercel.app').pathname;
  return config.rewrites.find((rewrite) => matchesSource(rewrite.source, pathname)) || null;
}

function headersFor(config, pathname) {
  return config.headers
    .filter((rule) => matchesSource(rule.source, pathname))
    .flatMap((rule) => rule.headers);
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
    config = JSON.parse(await readProjectFile('vercel.store.json'));
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
    expect(config.trailingSlash).toBe(false);
    expect(config).not.toHaveProperty('builds');
    expect(config).not.toHaveProperty('buildCommand');
    expect(config).not.toHaveProperty('functions');
    expect(config).not.toHaveProperty('crons');
    expect(config).not.toHaveProperty('redirects');
    expect(config).not.toHaveProperty('domains');
    expect(config).not.toHaveProperty('github');
    expect(JSON.stringify(config)).not.toMatch(/serviceWorker|workbox|manifest\.webmanifest|service_role/i);
  });

  it('uses the no-trailing-slash canonical policy without hardcoded storefront slugs', () => {
    const serialized = JSON.stringify(config);
    expect(config.trailingSlash).toBe(false);
    expect(serialized).not.toMatch(/demo-seguro|slug-inexistente-seguro|token-invalido-seguro/);
    expect(config.rewrites.filter((rule) => rule.source.startsWith('/tienda'))).toEqual([
      { source: '/tienda', destination: '/index.html' },
      { source: '/tienda/:path*', destination: '/index.html' }
    ]);
  });

  it('does not reuse or modify the administrative vercel.json', async () => {
    const publicConfig = await readProjectFile('vercel.store.json');
    expect(publicConfig).not.toBe(adminConfigBefore);
    expect(await readProjectFile('vercel.json')).toBe(adminConfigBefore);
  });

  it.each([
    '/',
    '/tienda',
    '/tienda/demo-seguro',
    '/tienda/demo-seguro/pedido/token-seguro',
    '/tienda/demo-seguro?pagina=2#catalogo',
    '/conoce-lanzo',
    '/conoce-lanzo?tienda=demo-seguro#inicio'
  ])('rewrites the canonical public route %s to index.html', (pathname) => {
    expect(rewriteFor(config, pathname)?.destination).toBe('/index.html');
  });

  it.each([
    ['/tienda/', '/tienda'],
    ['/tienda/demo-seguro/', '/tienda/demo-seguro'],
    ['/tienda/demo-seguro/pedido/token-seguro/', '/tienda/demo-seguro/pedido/token-seguro'],
    ['/conoce-lanzo/', '/conoce-lanzo'],
    ['/tienda/demo-seguro/?arch=deploy-1-1', '/tienda/demo-seguro?arch=deploy-1-1']
  ])('canonicalizes %s once to %s before the SPA rewrite', (source, expected) => {
    const canonical = canonicalUrlFor(config, source);
    expect(canonical).toBe(expected);
    expect(canonicalUrlFor(config, canonical)).toBe(expected);
    expect(rewriteFor(config, canonical)?.destination).toBe('/index.html');
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
    '/ruta-arbitraria'
  ])('does not rewrite the forbidden, reserved, or out-of-contract route %s', (pathname) => {
    expect(rewriteFor(config, pathname)).toBeNull();
  });

  it('leaves real assets outside the SPA rewrites', () => {
    expect(rewriteFor(config, '/assets/index-ABC123.js')).toBeNull();
    expect(rewriteFor(config, '/assets/index-ABC123.css')).toBeNull();
    expect(rewriteFor(config, '/assets/logIcon-ABC123.svg')).toBeNull();
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
    const globalHeaders = headersFor(config, '/package.json');
    expect(globalHeaders).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' });

    for (const pathname of ['/', '/index.html', '/tienda', '/tienda/demo', '/conoce-lanzo']) {
      const cache = headersFor(config, pathname).find((header) => header.key === 'Cache-Control');
      expect(cache?.value).toContain('must-revalidate');
      expect(cache?.value).not.toContain('immutable');
    }
    expect(headersFor(config, '/assets/index-ABC123.js')).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable'
    });
  });

  it('prepares only dist-store plus robots.txt and the public config', async () => {
    const distFiles = await walk(path.join(projectRoot, 'dist-store'));
    const packageFiles = await walk(packageRoot);
    expect(packageFiles).toEqual([...distFiles, 'robots.txt', 'vercel.json'].sort());
    expect(await readFile(path.join(packageRoot, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
    expect(await readFile(path.join(packageRoot, 'vercel.json'), 'utf8')).toBe(await readProjectFile('vercel.store.json'));
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
