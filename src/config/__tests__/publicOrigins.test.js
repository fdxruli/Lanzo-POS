import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_APP_ORIGIN,
  PUBLIC_STORE_ORIGIN,
  appendPublicTrackingToWhatsappUrl,
  buildAdminWelcomeUrl,
  buildPublicLandingUrl,
  buildPublicStoreUrl,
  buildPublicTrackingUrl,
  isPublicStoreOrigin,
  normalizePublicOrigin
} from '../publicOrigins';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('public application origins', () => {
  it('uses lanzo-store as the default public origin', () => {
    expect(PUBLIC_STORE_ORIGIN).toBe('https://lanzo-store.vercel.app');
  });

  it('uses lanzo-pos as the default administrative origin', () => {
    expect(ADMIN_APP_ORIGIN).toBe('https://lanzo-pos.vercel.app');
  });

  it('accepts Vite overrides and removes their trailing slash', async () => {
    vi.stubEnv('VITE_PUBLIC_STORE_ORIGIN', 'https://store.example.test/');
    vi.stubEnv('VITE_ADMIN_APP_ORIGIN', 'https://admin.example.test/');
    vi.resetModules();

    const overridden = await import('../publicOrigins');
    expect(overridden.PUBLIC_STORE_ORIGIN).toBe('https://store.example.test');
    expect(overridden.ADMIN_APP_ORIGIN).toBe('https://admin.example.test');
  });

  it('accepts loopback overrides in a non-production Vite mode', async () => {
    vi.stubEnv('VITE_PUBLIC_STORE_ORIGIN', 'http://127.0.0.1:4174/');
    vi.stubEnv('VITE_ADMIN_APP_ORIGIN', 'http://127.0.0.1:4173/');
    vi.resetModules();

    const overridden = await import('../publicOrigins');
    expect(overridden.PUBLIC_STORE_ORIGIN).toBe('http://127.0.0.1:4174');
    expect(overridden.ADMIN_APP_ORIGIN).toBe('http://127.0.0.1:4173');
  });

  it('normalizes a valid HTTPS origin', () => {
    expect(normalizePublicOrigin('https://example.test/')).toBe('https://example.test');
  });

  it('accepts loopback HTTP during development', () => {
    expect(normalizePublicOrigin('http://127.0.0.1:4174/'))
      .toBe('http://127.0.0.1:4174');
    expect(normalizePublicOrigin('http://localhost:4173'))
      .toBe('http://localhost:4173');
  });

  it('rejects HTTP in production, including loopback', () => {
    expect(() => normalizePublicOrigin('http://127.0.0.1:4174', { production: true }))
      .toThrow(/HTTP/);
  });

  it('rejects non-loopback HTTP during development', () => {
    expect(() => normalizePublicOrigin('http://example.test'))
      .toThrow(/loopback/);
  });

  it('rejects an origin with an additional path', () => {
    expect(() => normalizePublicOrigin('https://example.test/app'))
      .toThrow(/ruta/);
  });

  it('rejects an origin with query parameters', () => {
    expect(() => normalizePublicOrigin('https://example.test/?source=test'))
      .toThrow(/query/);
  });

  it('rejects an origin with a hash', () => {
    expect(() => normalizePublicOrigin('https://example.test/#inicio'))
      .toThrow(/hash/);
  });

  it('rejects credentials', () => {
    expect(() => normalizePublicOrigin('https://user:secret@example.test'))
      .toThrow(/credenciales/);
  });

  it.each(['javascript:alert(1)', 'data:text/plain,hi', 'file:///tmp/store']) (
    'rejects the unsafe scheme in %s',
    (value) => expect(() => normalizePublicOrigin(value)).toThrow(/HTTPS/)
  );
});

describe('public URL builders', () => {
  it('builds the canonical public store URL', () => {
    expect(buildPublicStoreUrl('negocio-ejemplo'))
      .toBe('https://lanzo-store.vercel.app/tienda/negocio-ejemplo');
  });

  it('encodes the slug as one path segment', () => {
    expect(buildPublicStoreUrl('//otro host?x=1'))
      .toBe('https://lanzo-store.vercel.app/tienda/%2F%2Fotro%20host%3Fx%3D1');
  });

  it('builds the canonical public tracking URL', () => {
    expect(buildPublicTrackingUrl('negocio-ejemplo', 'token-seguro'))
      .toBe('https://lanzo-store.vercel.app/tienda/negocio-ejemplo/pedido/token-seguro');
  });

  it('encodes the tracking token without changing it', () => {
    expect(buildPublicTrackingUrl('negocio', 'token/?# exacto'))
      .toBe('https://lanzo-store.vercel.app/tienda/negocio/pedido/token%2F%3F%23%20exacto');
  });

  it('builds the public landing without a trailing slash', () => {
    expect(buildPublicLandingUrl()).toBe('https://lanzo-store.vercel.app/conoce-lanzo');
  });

  it('adds a safely encoded store query to the public landing', () => {
    expect(buildPublicLandingUrl('negocio ejemplo&plan=pro'))
      .toBe('https://lanzo-store.vercel.app/conoce-lanzo?tienda=negocio+ejemplo%26plan%3Dpro');
  });

  it('builds the administrative welcome URL', () => {
    expect(buildAdminWelcomeUrl()).toBe('https://lanzo-pos.vercel.app/?welcome=1');
  });

  it('never generates double or final slashes', () => {
    const store = buildPublicStoreUrl('negocio');
    const tracking = buildPublicTrackingUrl('negocio', 'token');
    expect(new URL(store).pathname).toBe('/tienda/negocio');
    expect(new URL(tracking).pathname).toBe('/tienda/negocio/pedido/token');
    expect(store.endsWith('/')).toBe(false);
    expect(tracking.endsWith('/')).toBe(false);
  });

  it('recognizes only the configured public store origin', () => {
    expect(isPublicStoreOrigin('https://lanzo-store.vercel.app/tienda/demo')).toBe(true);
    expect(isPublicStoreOrigin('https://lanzo-pos.vercel.app/tienda/demo')).toBe(false);
    expect(isPublicStoreOrigin('not a URL')).toBe(false);
  });

  it('adds the public tracking URL to a safe WhatsApp message', () => {
    const trackingUrl = buildPublicTrackingUrl('negocio', 'token');
    const result = appendPublicTrackingToWhatsappUrl(
      'https://wa.me/525500000000?text=Pedido%20confirmado',
      trackingUrl
    );
    expect(new URL(result).searchParams.get('text')).toContain(trackingUrl);
  });

  it('rejects unsafe WhatsApp destinations', () => {
    expect(appendPublicTrackingToWhatsappUrl(
      'https://example.test/?text=Pedido',
      buildPublicTrackingUrl('negocio', 'token')
    )).toBe('');
  });
});
