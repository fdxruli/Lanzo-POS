import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateCompiledRoute } from '../../../scripts/audit-vercel-build-output.mjs';

const projectRoot = new URL('../../../', import.meta.url);
const configPath = new URL('store/vercel.json', projectRoot);
const routerPath = new URL('src/router/publicStoreRoutes.jsx', projectRoot);
const homePath = new URL('store/home.html', projectRoot);
const indexPath = new URL('store/index.html', projectRoot);
const rawConfig = readFileSync(configPath, 'utf8');
const homeHtml = readFileSync(homePath, 'utf8');
const indexHtml = readFileSync(indexPath, 'utf8');
const config = JSON.parse(rawConfig);

const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NOINDEX = 'noindex, nofollow, noarchive';
const staticPaths = new Set([
  'home.html',
  'index.html',
  'robots.txt',
  'assets/index-prueba.js',
]);

function resolve(pathname) {
  return evaluateCompiledRoute(config.routes, pathname, staticPaths);
}

function headerValues(pathname, key) {
  return resolve(pathname).headers
    .flatMap(({ headers }) => Object.entries(headers))
    .filter(([name]) => name.toLowerCase() === key.toLowerCase())
    .map(([, value]) => value);
}

function routeIndex(predicate) {
  return config.routes.findIndex(predicate);
}

describe('store/vercel.json', () => {
  it('conserva el contrato general y usa routing ordenado sin mezclar APIs modernas', () => {
    expect(() => JSON.parse(rawConfig)).not.toThrow();
    expect(config).toMatchObject({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      installCommand: 'cd .. && npm ci',
      buildCommand: 'cd .. && npm run build:store:vercel',
      outputDirectory: 'dist',
    });
    expect(config).not.toHaveProperty('rewrites');
    expect(config).not.toHaveProperty('headers');
    expect(config).not.toHaveProperty('redirects');
    expect(config).not.toHaveProperty('trailingSlash');
    expect(Array.isArray(config.routes)).toBe(true);
    expect(config.routes.every(({ dest }) => dest === undefined || dest.startsWith('/'))).toBe(true);
    expect(rawConfig.replace(config.$schema, '')).not.toMatch(
      /https?:\/\/|(?:^|[/"'])[A-Za-z0-9.-]+\.(?:app|com|net|org)(?:[/"']|$)/iu,
    );
  });

  it('aísla la metadata comercial de la raíz del shell público compartido', () => {
    expect(homeHtml).toContain('<title>Lanzo Tienda Online | Vende por internet con Lanzo</title>');
    expect(homeHtml).toContain('<link rel="canonical" href="https://lanzo-store.vercel.app/" />');
    expect(homeHtml).toContain('<meta property="og:url" content="https://lanzo-store.vercel.app/" />');
    expect(indexHtml).toContain('<title>Tienda en línea | Lanzo</title>');
    expect(indexHtml).not.toContain('rel="canonical"');
    expect(indexHtml).toContain('LANZO_SOCIAL_HEAD_START');
  });

  it('fuerza la raíz comercial antes del filesystem que resolvería index.html', () => {
    const filesystem = routeIndex((route) => route.handle === 'filesystem');
    const root = routeIndex((route) => route.src === '^/$' && route.dest === '/home.html');
    expect(root).toBeGreaterThanOrEqual(0);
    expect(root).toBeLessThan(filesystem);
    expect(resolve('/')).toMatchObject({
      kind: 'rewrite',
      pathname: '/home.html',
      index: root,
    });
  });

  it('mantiene filesystem antes de rutas virtuales, tienda dinámica antes del fallback y tracking antes de tienda', () => {
    const filesystem = routeIndex((route) => route.handle === 'filesystem');
    const tracking = routeIndex((route) => route.src === '^/tienda/([^/]+)/pedido/([^/]+)$');
    const dynamicStore = routeIndex((route) => route.src === '^/tienda/([^/]+)$');
    const fallback = routeIndex((route) => route.dest === '/index.html' && route.src.includes('(?!(?:api|assets)'));
    const error = routeIndex((route) => route.handle === 'error');

    expect(filesystem).toBeGreaterThanOrEqual(0);
    expect(tracking).toBeGreaterThan(filesystem);
    expect(dynamicStore).toBeGreaterThan(tracking);
    expect(fallback).toBeGreaterThan(dynamicStore);
    expect(error).toBeGreaterThan(fallback);
  });

  it.each([
    ['/', '/home.html'],
    ['/tienda', '/index.html'],
    ['/tienda/farmacia-gary', '/api/store-page'],
    ['/tienda/farmacia-gary/pedido/token-ficticio', '/index.html'],
    ['/conoce-lanzo', '/index.html'],
    ['/tienda/farmacia-gary/ruta-desconocida', '/index.html'],
    ['/esto-no-existe', '/index.html'],
  ])('resuelve %s hacia %s con el orden efectivo', (pathname, destination) => {
    expect(resolve(pathname)).toMatchObject({ kind: 'rewrite', pathname: destination });
  });

  it('deja assets, documentos físicos y rutas reservadas fuera del fallback público', () => {
    expect(resolve('/assets/index-prueba.js')).toMatchObject({
      kind: 'filesystem',
      pathname: '/assets/index-prueba.js',
    });
    expect(resolve('/home.html')).toMatchObject({ kind: 'filesystem', pathname: '/home.html' });
    expect(resolve('/index.html')).toMatchObject({ kind: 'filesystem', pathname: '/index.html' });
    expect(resolve('/api/store-page').kind).toBe('error');
    expect(resolve('/api/og/store').kind).toBe('error');
    expect(resolve('/package.json').kind).toBe('error');
    expect(resolve('/_src').kind).toBe('error');
    expect(resolve('/api/store-page')).not.toMatchObject({ pathname: '/index.html' });
  });

  it('canonicaliza trailing slash antes de entrar al shell', () => {
    const result = resolve('/tienda/farmacia-gary/');
    expect(result.kind).toBe('redirect');
    expect(result.status).toBe(308);
    const route = config.routes[result.index];
    expect(route.headers.Location).toBe('/$1');
    expect(route.headers['X-Robots-Tag']).toBe(NOINDEX);
  });

  it('no propaga el token de seguimiento a ningún destino', () => {
    const trackingRoute = config.routes.find(
      ({ src }) => src === '^/tienda/([^/]+)/pedido/([^/]+)$',
    );
    expect(trackingRoute?.dest).toBe('/index.html');
    for (const { dest } of config.routes) {
      expect(dest || '').not.toMatch(/trackingToken|pedido\/.*\?/u);
    }
  });

  it('preserva noindex, caché estática e inmutabilidad sólo donde corresponden', () => {
    for (const pathname of [
      '/',
      '/index.html',
      '/home.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/farmacia-gary/pedido/token-ficticio',
      '/tienda/farmacia-gary',
      '/esto-no-existe',
      '/api/store-page',
    ]) {
      expect(headerValues(pathname, 'X-Robots-Tag')).toContain(NOINDEX);
    }

    for (const pathname of [
      '/',
      '/index.html',
      '/home.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/farmacia-gary/pedido/token-ficticio',
    ]) {
      expect(headerValues(pathname, 'Cache-Control')).toContain(STATIC_CACHE);
    }

    expect(headerValues('/assets/index-prueba.js', 'Cache-Control')).toContain(IMMUTABLE_CACHE);
    expect(headerValues('/tienda/farmacia-gary', 'Cache-Control')).toEqual([]);
    expect(headerValues('/api/store-page', 'Cache-Control')).toEqual([]);
  });

  it('mantiene las rutas públicas de React sin modificarlas', () => {
    const routerSource = readFileSync(routerPath, 'utf8');
    expect(routerSource).toContain("path: '/tienda/:slug/pedido/:trackingToken'");
    expect(routerSource).toContain("path: '/tienda/:slug'");
    expect(routerSource).toContain("path: '/tienda'");
    expect(routerSource).toContain("path: '*'");
  });
});
