import { describe, expect, it } from 'vitest';
import {
  PublicRequestOriginError,
  parsePublicStoreOrigins,
  resolvePublicRequestOrigin,
} from '../../api/_publicRequestOrigin.js';
import { buildStoreSocialMetadata } from '../../api/_socialMetadata.js';

const request = (url, headers = {}) => {
  let normalizedHeaders;
  try {
    normalizedHeaders = new Headers(headers);
  } catch {
    normalizedHeaders = {
      get(name) {
        const entry = Object.entries(headers)
          .find(([key]) => key.toLowerCase() === name.toLowerCase());
        return entry?.[1] ?? null;
      },
    };
  }
  return { url, headers: normalizedHeaders };
};

const expectRejected = (input) => {
  expect(() => resolvePublicRequestOrigin(input)).toThrow(PublicRequestOriginError);
};

describe('resolvePublicRequestOrigin', () => {
  it('acepta el origen HTTPS de la URL de plataforma', () => {
    expect(resolvePublicRequestOrigin({
      request: request('https://store.example.test/api/store-page?slug=mi-tienda'),
    })).toBe('https://store.example.test');
  });

  it('prioriza x-forwarded-host validado y exige protocolo HTTPS', () => {
    expect(resolvePublicRequestOrigin({
      request: request('https://internal.example.test/api/store-page', {
        'x-forwarded-host': 'preview.example.test',
        'x-forwarded-proto': 'https',
        host: 'ignored.example.test',
      }),
    })).toBe('https://preview.example.test');
  });

  it.each([
    [{ 'x-forwarded-host': 'one.example.test,two.example.test' }, 'varios hosts'],
    [{ host: 'example.test:8443' }, 'puerto no permitido'],
    [{ host: 'localhost' }, 'localhost'],
    [{ host: '127.0.0.1' }, 'IPv4'],
    [{ host: '[::1]' }, 'IPv6'],
    [{ host: 'user@example.test' }, 'credenciales'],
    [{ host: 'example.test/path?x=1#hash' }, 'path, query y hash'],
    [{ host: 'example.test\r\nx-injected: yes' }, 'CRLF'],
  ])('rechaza %s (%s)', (headers) => {
    expectRejected({
      request: request('https://safe.example.test/api/store-page', headers),
    });
  });

  it('rechaza HTTP incluso con hostname válido', () => {
    expectRejected({
      request: request('http://store.example.test/api/store-page'),
    });
    expectRejected({
      request: request('https://store.example.test/api/store-page', {
        'x-forwarded-proto': 'http',
      }),
    });
  });

  it('permite únicamente el puerto HTTPS predeterminado', () => {
    expect(resolvePublicRequestOrigin({
      request: request('https://internal.example.test/api/store-page', {
        host: 'store.example.test:443',
      }),
    })).toBe('https://store.example.test');
  });

  it('aplica allowlist exacta y rechaza orígenes externos', () => {
    const allowedOrigins = parsePublicStoreOrigins(
      'https://store.example.test,https://preview.example.test',
    );
    expect(resolvePublicRequestOrigin({
      request: request('https://store.example.test/api/store-page'),
      allowedOrigins,
    })).toBe('https://store.example.test');
    expectRejected({
      request: request('https://external.example.test/api/store-page'),
      allowedOrigins,
    });
  });

  it.each([
    'http://store.example.test',
    'https://user:pass@store.example.test',
    'https://store.example.test/path',
    'https://store.example.test?query=1',
    'https://store.example.test#hash',
    'https://127.0.0.1',
    'https://[::1]',
  ])('rechaza entrada inválida de allowlist: %s', (value) => {
    expect(() => parsePublicStoreOrigins(value)).toThrow(PublicRequestOriginError);
  });

  it('construye canonical exclusivamente en el mismo origen resuelto', () => {
    const publicOrigin = resolvePublicRequestOrigin({
      request: request('https://store.example.test/api/store-page'),
    });
    const metadata = buildStoreSocialMetadata({
      publicOrigin,
      slug: 'mi-tienda',
      portal: { name: 'Mi Tienda' },
    });
    expect(metadata.canonicalUrl).toBe('https://store.example.test/tienda/mi-tienda');
    expect(metadata.openGraph.url).toBe(metadata.canonicalUrl);
  });
});
