import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectRoot = new URL('../../../', import.meta.url);
const configPath = new URL('store/vercel.json', projectRoot);
const routerPath = new URL('src/router/publicStoreRoutes.jsx', projectRoot);
const rawConfig = readFileSync(configPath, 'utf8');
const config = JSON.parse(rawConfig);

const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const NOINDEX = 'noindex, nofollow, noarchive';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compileSource(source) {
  if (source === '/(.*)') return /^\/.*$/u;
  if (source === '/') return /^\/$/u;
  const segments = source.slice(1).split('/');
  const pattern = segments.map((segment) => {
    if (/^:[A-Za-z][A-Za-z0-9_]*\*$/u.test(segment)) return '.*';
    if (/^:[A-Za-z][A-Za-z0-9_]*$/u.test(segment)) return '[^/]+';
    return escapeRegex(segment);
  }).join('/');
  return new RegExp(`^/${pattern}$`, 'u');
}

function matchingRewrite(pathname) {
  return config.rewrites.find((rewrite) => compileSource(rewrite.source).test(pathname));
}

function matchingHeaders(pathname) {
  return config.headers
    .filter((rule) => compileSource(rule.source).test(pathname))
    .flatMap((rule) => rule.headers);
}

function headerValues(pathname, key) {
  return matchingHeaders(pathname)
    .filter((header) => header.key.toLowerCase() === key.toLowerCase())
    .map((header) => header.value);
}

describe('store/vercel.json', () => {
  it('conserva el contrato general del proyecto', () => {
    expect(() => JSON.parse(rawConfig)).not.toThrow();
    expect(config).toMatchObject({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      installCommand: 'cd .. && npm ci',
      buildCommand: 'cd .. && npm run build:store:vercel',
      outputDirectory: 'dist',
      trailingSlash: false,
    });
    expect(config).not.toHaveProperty('routes');
    expect(config).not.toHaveProperty('redirects');
    expect(config.rewrites.every(({ destination }) => destination.startsWith('/'))).toBe(true);
    expect(config.rewrites.every(({ destination }) => !destination.startsWith('//'))).toBe(true);
    expect(rawConfig.replace(config.$schema, '')).not.toMatch(
      /https?:\/\/|(?:^|[/"'])[A-Za-z0-9.-]+\.(?:app|com|net|org)(?:[/"']|$)/iu,
    );
  });

  it('mantiene la precedencia tracking, tienda exacta y fallback anidado', () => {
    const sources = config.rewrites.map(({ source }) => source);
    const tracking = sources.indexOf('/tienda/:slug/pedido/:trackingToken');
    const dynamicStore = sources.indexOf('/tienda/:slug');
    const nestedFallback = sources.indexOf('/tienda/:path*');
    expect(tracking).toBeGreaterThanOrEqual(0);
    expect(dynamicStore).toBeGreaterThan(tracking);
    expect(nestedFallback).toBeGreaterThan(dynamicStore);
  });

  it.each([
    ['/', '/index.html'],
    ['/tienda', '/index.html'],
    ['/tienda/farmacia-gary', '/api/store-page?slug=:slug'],
    ['/tienda/farmacia-gary/pedido/token-ficticio', '/index.html'],
    ['/conoce-lanzo', '/index.html'],
    ['/tienda/farmacia-gary/ruta-desconocida', '/index.html'],
  ])('resuelve %s hacia %s', (pathname, destination) => {
    expect(matchingRewrite(pathname)?.destination).toBe(destination);
  });

  it('aísla funciones, assets, tracking y rutas con segmentos adicionales', () => {
    expect(matchingRewrite('/api/store-page')).toBeUndefined();
    expect(matchingRewrite('/api/og/store')).toBeUndefined();
    expect(matchingRewrite('/assets/index-prueba.js')).toBeUndefined();
    expect(matchingRewrite('/tienda/farmacia-gary/pedido/token-ficticio')?.destination)
      .toBe('/index.html');
    expect(matchingRewrite('/tienda/farmacia-gary/ruta-desconocida')?.destination)
      .not.toContain('/api/store-page');

    for (const rewrite of config.rewrites) {
      const destinationPath = rewrite.destination.split('?')[0];
      expect(destinationPath).not.toBe(rewrite.source);
      expect(matchingRewrite(destinationPath)?.destination).not.toBe(rewrite.source);
    }
  });

  it('no propaga el token de seguimiento a ningún destino', () => {
    const trackingRule = config.rewrites.find(
      ({ source }) => source === '/tienda/:slug/pedido/:trackingToken',
    );
    expect(trackingRule?.destination).toBe('/index.html');
    for (const { destination } of config.rewrites) {
      expect(destination).not.toMatch(/trackingToken|:trackingToken|pedido\/:trackingToken/u);
    }
  });

  it('preserva noindex, caché estática e inmutabilidad solo donde corresponden', () => {
    for (const pathname of [
      '/',
      '/index.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/farmacia-gary/pedido/token-ficticio',
      '/tienda/farmacia-gary',
      '/api/store-page',
    ]) {
      expect(headerValues(pathname, 'X-Robots-Tag')).toContain(NOINDEX);
    }

    for (const pathname of [
      '/',
      '/index.html',
      '/tienda',
      '/conoce-lanzo',
      '/tienda/farmacia-gary/pedido/token-ficticio',
    ]) {
      expect(headerValues(pathname, 'Cache-Control')).toEqual([STATIC_CACHE]);
    }

    expect(headerValues('/assets/index-prueba.js', 'Cache-Control')).toEqual([IMMUTABLE_CACHE]);
    expect(headerValues('/tienda/farmacia-gary', 'Cache-Control')).toEqual([]);
    expect(headerValues('/api/store-page', 'Cache-Control')).toEqual([]);
    expect(config.headers.some(({ source }) => source === '/tienda/:path*')).toBe(false);
    expect(config.headers
      .filter(({ source }) => source !== '/assets/:path*')
      .flatMap(({ headers }) => headers)
      .filter(({ key, value }) => key === 'Cache-Control' && /immutable/u.test(value))).toEqual([]);
  });

  it('mantiene las rutas públicas de React sin modificarlas', () => {
    const routerSource = readFileSync(routerPath, 'utf8');
    expect(routerSource).toContain("path: '/tienda/:slug/pedido/:trackingToken'");
    expect(routerSource).toContain("path: '/tienda/:slug'");
    expect(routerSource).toContain("path: '/tienda'");
  });
});
