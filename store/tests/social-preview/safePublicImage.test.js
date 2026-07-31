import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  createSafePublicImageLoader,
  hasValidImageSignature,
  resolveSafePublicImageUrl,
} from '../../api/_safePublicImage.js';

const SUPABASE_URL = 'https://public-project.supabase.test';
const PUBLIC_IMAGE = `${SUPABASE_URL}/storage/v1/object/public/branding/logo.png`;

const responseWith = ({
  // This fixture is the complete PNG signature used to test format recognition,
  // not a complete decodable PNG. Real PNG rendering is covered separately.
  bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  contentType = 'image/png',
  contentLength = String(bytes.byteLength),
  status = 200,
  location = null,
} = {}) => {
  let sent = false;
  const reader = {
    read: vi.fn(async () => {
      if (sent) return { done: true, value: undefined };
      sent = true;
      return { done: false, value: bytes };
    }),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: vi.fn((name) => ({
          'content-type': contentType,
          'content-length': contentLength,
          location,
        })[name.toLowerCase()] ?? null),
      },
      body: { getReader: vi.fn(() => reader) },
    },
    reader,
  };
};

const responseWithoutStream = ({
  bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  contentType = 'image/png',
  contentLength = String(bytes.byteLength),
} = {}) => {
  const arrayBuffer = vi.fn(async () => (
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  ));
  return {
    ok: true,
    status: 200,
    headers: {
      get: vi.fn((name) => ({
        'content-type': contentType,
        'content-length': contentLength,
      })[name.toLowerCase()] ?? null),
    },
    body: null,
    arrayBuffer,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('resolveSafePublicImageUrl', () => {
  it.each([
    [`${SUPABASE_URL}/storage/v1/object/public/branding/logo.png`, 'objeto público'],
    [`${SUPABASE_URL}/storage/v1/render/image/public/branding/cover.webp?width=1200`, 'render público'],
  ])('acepta hostname exacto y ruta %s', (candidate) => {
    expect(resolveSafePublicImageUrl(candidate, SUPABASE_URL)).toBe(candidate);
  });

  it.each([
    ['https://public-project.supabase.test.evil.test/storage/v1/object/public/a.png', 'hostname parecido'],
    ['https://cdn.public-project.supabase.test/storage/v1/object/public/a.png', 'subdominio inesperado'],
    ['http://public-project.supabase.test/storage/v1/object/public/a.png', 'HTTP'],
    ['https://user:pass@public-project.supabase.test/storage/v1/object/public/a.png', 'credenciales'],
    ['https://public-project.supabase.test:8443/storage/v1/object/public/a.png', 'puerto no estándar'],
    ['https://public-project.supabase.test/rest/v1/private', 'ruta no pública'],
    ['data:image/png;base64,AAAA', 'data'],
    ['blob:https://public-project.supabase.test/id', 'blob'],
    ['file:///tmp/image.png', 'file'],
    ['javascript:alert(1)', 'javascript'],
  ])('rechaza %s', (candidate) => {
    expect(resolveSafePublicImageUrl(candidate, SUPABASE_URL)).toBeNull();
  });

  it.each([
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://[::1]',
    'https://[fd00::1]',
  ])('rechaza un origen Supabase local, IPv4 o IPv6: %s', (supabaseUrl) => {
    const candidate = `${supabaseUrl}/storage/v1/object/public/a.png`;
    expect(resolveSafePublicImageUrl(candidate, supabaseUrl)).toBeNull();
  });
});

describe('createSafePublicImageLoader', () => {
  it('descarga una imagen válida y la convierte a data URI', async () => {
    const streamed = responseWith();
    const fetchImpl = vi.fn(async () => streamed.response);
    const loader = createSafePublicImageLoader({ supabaseUrl: SUPABASE_URL, fetchImpl });

    await expect(loader(PUBLIC_IMAGE)).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_IMAGE, {
      method: 'GET',
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(streamed.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])(
    'rechaza Content-Type %s',
    async (contentType) => {
      const streamed = responseWith({ contentType });
      const loader = createSafePublicImageLoader({
        supabaseUrl: SUPABASE_URL,
        fetchImpl: vi.fn(async () => streamed.response),
      });
      await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
      expect(streamed.response.body.getReader).not.toHaveBeenCalled();
    },
  );

  it('rechaza bytes JPEG cuando el servidor declara image/png', async () => {
    const streamed = responseWith({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      contentType: 'image/png',
    });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => streamed.response),
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
  });

  it('rechaza Content-Length excesivo sin leer el stream', async () => {
    const streamed = responseWith({ contentLength: String(MAX_IMAGE_BYTES + 1) });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => streamed.response),
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
    expect(streamed.response.body.getReader).not.toHaveBeenCalled();
  });

  it('cancela un stream que supera el límite', async () => {
    const streamed = responseWith({
      bytes: new Uint8Array(9),
      contentLength: null,
    });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => streamed.response),
      maximumBytes: 8,
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
    expect(streamed.reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('permite fallback sin stream cuando Content-Length es válido', async () => {
    const response = responseWithoutStream();
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => response),
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toMatch(/^data:image\/png;base64,/u);
    expect(response.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, 'ausente'],
    ['invalid', 'inválido'],
    ['-1', 'negativo'],
    ['9', 'excesivo'],
  ])('rechaza fallback sin stream con Content-Length %s', async (contentLength) => {
    const response = responseWithoutStream({ contentLength });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => response),
      maximumBytes: 8,
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
    expect(response.arrayBuffer).not.toHaveBeenCalled();
  });

  it('rechaza fallback cuya longitud declarada es segura pero el cuerpo real excede', async () => {
    const response = responseWithoutStream({
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      contentLength: '8',
    });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => response),
      maximumBytes: 8,
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
    expect(response.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('acepta fallback exactamente igual al máximo configurado', async () => {
    const response = responseWithoutStream({ contentLength: '8' });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => response),
      maximumBytes: 8,
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toMatch(/^data:image\/png;base64,/u);
  });

  it.each([301, 302, 307, 308])('rechaza redirección HTTP %s', async (status) => {
    const streamed = responseWith({ status, location: 'https://evil.test/image.png' });
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => streamed.response),
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
  });

  it('devuelve fallback ante error de red', async () => {
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => {
        throw new Error('network details');
      }),
    });
    await expect(loader(PUBLIC_IMAGE)).resolves.toBeNull();
  });

  it('aplica timeout independiente y aborta', async () => {
    vi.useFakeTimers();
    let signal;
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      timeoutMs: 10,
      fetchImpl: vi.fn((url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    });
    const pending = loader(PUBLIC_IMAGE);

    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it('omite candidatos inválidos sin ejecutar red', async () => {
    const fetchImpl = vi.fn();
    const loader = createSafePublicImageLoader({ supabaseUrl: SUPABASE_URL, fetchImpl });
    await expect(loader('https://evil.test/logo.png')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no envía cookies, Authorization, apikey ni headers privados', async () => {
    const streamed = responseWith();
    const fetchImpl = vi.fn(async () => streamed.response);
    await createSafePublicImageLoader({ supabaseUrl: SUPABASE_URL, fetchImpl })(PUBLIC_IMAGE);
    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers).toEqual({ Accept: 'image/png,image/jpeg,image/webp' });
    expect(JSON.stringify(headers)).not.toMatch(/cookie|authorization|apikey/i);
    expect(IMAGE_TIMEOUT_MS).toBe(2_500);
  });
});

describe('hasValidImageSignature', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]);

  it.each([
    ['image/png', png, 'PNG'],
    ['image/jpeg', jpeg, 'JPEG'],
    ['image/webp', webp, 'WebP'],
  ])('acepta firma válida %s', (contentType, bytes) => {
    expect(hasValidImageSignature(contentType, bytes)).toBe(true);
  });

  it.each([
    ['image/png', jpeg, 'PNG declarado con JPEG'],
    ['image/jpeg', new Uint8Array([1, 2, 3, 4]), 'JPEG con bytes aleatorios'],
    ['image/webp', webp.slice(0, 11), 'WebP truncado'],
    ['image/png', new Uint8Array([0x89, 0x50]), 'cuerpo demasiado corto'],
    ['image/png', new Uint8Array(), 'contenido vacío'],
  ])('rechaza %s', (contentType, bytes) => {
    expect(hasValidImageSignature(contentType, bytes)).toBe(false);
  });
});
