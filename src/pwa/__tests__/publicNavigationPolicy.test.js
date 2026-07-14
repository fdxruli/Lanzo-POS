// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_NAVIGATION_DENYLIST,
  isPublicNavigationPath,
  isPublicNavigationRequest,
} from '../publicNavigationPolicy';

const deniedByNavigationFallback = (value) => PUBLIC_NAVIGATION_DENYLIST.some((pattern) => pattern.test(value));

describe('public navigation policy', () => {
  it.each([
    '/tienda',
    '/tienda/',
    '/tienda/mi-negocio',
    '/tienda/mi-negocio/',
    '/tienda/mi-negocio/pedido/trk1_token-valido',
    '/tienda/mi-negocio/pedido/trk1_token-valido/',
    '/conoce-lanzo',
    '/conoce-lanzo/',
  ])('recognizes %s as public', (pathname) => {
    expect(isPublicNavigationPath(pathname)).toBe(true);
  });

  it.each([
    '/configuracion/tienda',
    '/mi-tienda',
    '/conoce-lanzo-admin',
    '/tiendas',
    '/pedidos/tienda/demo',
  ])('does not exclude the administrative path %s', (pathname) => {
    expect(isPublicNavigationPath(pathname)).toBe(false);
  });

  it.each([
    '/tienda?utm_source=test',
    '/tienda/demo/?q=uno#seccion',
    '/conoce-lanzo?tienda=demo',
    '/api/orders?x=1',
    '/auth/callback?code=fixture',
  ])('keeps %s out of the administrative navigation fallback', (value) => {
    expect(deniedByNavigationFallback(value)).toBe(true);
  });

  it('matches only same-origin GET navigation requests', () => {
    const url = new URL('http://127.0.0.1:4173/tienda/demo?x=1');
    const request = { method: 'GET', mode: 'navigate' };

    expect(isPublicNavigationRequest({ request, url, serviceWorkerOrigin: url.origin })).toBe(true);
    expect(isPublicNavigationRequest({ request: { ...request, method: 'POST' }, url, serviceWorkerOrigin: url.origin })).toBe(false);
    expect(isPublicNavigationRequest({ request: { ...request, mode: 'cors' }, url, serviceWorkerOrigin: url.origin })).toBe(false);
    expect(isPublicNavigationRequest({ request, url, serviceWorkerOrigin: 'http://127.0.0.1:9999' })).toBe(false);
  });
});
