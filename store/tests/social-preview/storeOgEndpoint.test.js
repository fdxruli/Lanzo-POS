import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOT_FOUND_CACHE,
  REVALIDATED_CACHE,
  TEMPORARY_CACHE,
  VERSIONED_CACHE,
  createStoreOgHandler,
} from '../../api/og/store.js';

const SLUG = 'tienda-segura';
const ENDPOINT = `https://tienda.lanzo.test/api/og/store?slug=${SLUG}`;
const PNG_BYTES = new Uint8Array(1_001);
PNG_BYTES.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let imageCalls;

class FakeImageResponse {
  constructor(element, options) {
    imageCalls.push({ element, options });
    return new Response(PNG_BYTES, {
      status: options.status,
    });
  }
}

const okResult = {
  status: 'ok',
  portal: {
    slug: SLUG,
    name: 'Tienda Segura',
    headline: 'Compra en línea',
    description: 'Descripción pública',
    theme: {
      primaryColor: '#112233',
      secondaryColor: '#aabbcc',
      cornerStyle: 'rounded',
      fontStyle: 'system',
    },
    logoUrl: 'https://public-project.supabase.test/storage/v1/object/public/logo.png',
    coverImageUrl: 'https://public-project.supabase.test/storage/v1/object/public/cover.png',
  },
  siteVersionNumber: 7,
};

const createHandler = ({
  result = okResult,
  portalClient,
  imageLoader = vi.fn(async () => null),
  environment = {},
} = {}) => {
  const client = portalClient || {
    getPortalBySlug: vi.fn(async () => result),
  };
  return {
    client,
    imageLoader,
    handler: createStoreOgHandler({
      portalClient: client,
      imageLoader,
      ImageResponseImpl: FakeImageResponse,
      environment,
      fetchImpl: vi.fn(),
    }),
  };
};

beforeEach(() => {
  imageCalls = [];
});

describe('métodos, query y respuesta', () => {
  it('genera GET PNG 1200 × 630 con headers seguros', async () => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(ENDPOINT));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...response.headers.keys()].filter((name) => name === 'content-type')).toHaveLength(1);
    expect([...response.headers.keys()].filter((name) => name === 'cache-control')).toHaveLength(1);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(client.getPortalBySlug).toHaveBeenCalledWith(SLUG);
    expect(imageCalls[0].options).toMatchObject({ width: 1200, height: 630, status: 200 });
  });

  it('responde HEAD con headers correctos y sin render ni descarga', async () => {
    const { handler, imageLoader } = createHandler();
    const response = await handler(new Request(ENDPOINT, { method: 'HEAD' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await response.text()).toBe('');
    expect(imageLoader).not.toHaveBeenCalled();
    expect(imageCalls).toHaveLength(0);
  });

  it('rechaza POST con 405 y Allow sin consultar el portal', async () => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(ENDPOINT, { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
  });

  it.each([
    ['https://tienda.lanzo.test/api/og/store', 'slug ausente'],
    ['https://tienda.lanzo.test/api/og/store?slug=../privado', 'slug inválido'],
    [`${ENDPOINT}&slug=otra-tienda`, 'slug duplicado'],
  ])('devuelve PNG controlado 400 para %s', async (url) => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(url));
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
    expect(JSON.stringify(imageCalls[0])).not.toContain('../privado');
  });
});

describe('estados, imágenes y privacidad', () => {
  it('carga logo y portada únicamente desde el resultado público', async () => {
    const imageLoader = vi.fn(async (url) => (
      url.includes('logo') ? 'data:image/png;base64,bG9nbw==' : 'data:image/png;base64,Y292ZXI='
    ));
    const { handler } = createHandler({ imageLoader });
    await handler(new Request(ENDPOINT));
    expect(imageLoader).toHaveBeenNthCalledWith(1, okResult.portal.logoUrl);
    expect(imageLoader).toHaveBeenNthCalledWith(2, okResult.portal.coverImageUrl);
  });

  it.each([
    ['logo', (url) => (url.includes('logo') ? null : 'data:image/png;base64,Y292ZXI=')],
    ['portada', (url) => (url.includes('cover') ? null : 'data:image/png;base64,bG9nbw==')],
  ])('mantiene el PNG cuando falla la %s', async (label, implementation) => {
    const { handler } = createHandler({
      imageLoader: vi.fn(async (url) => implementation(url)),
    });
    const response = await handler(new Request(ENDPOINT));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it.each([
    [{ status: 'not_found' }, 'Tienda no disponible'],
    [{ status: 'unavailable', reason: 'timeout' }, 'Tienda en línea'],
  ])('genera fallback profesional para %s', async (result, expectedText) => {
    const { handler, imageLoader } = createHandler({ result });
    await handler(new Request(ENDPOINT));
    expect(JSON.stringify(imageCalls[0].element)).toContain(expectedText);
    expect(imageLoader).not.toHaveBeenCalled();
  });

  it('configuración faltante produce fallback temporal sin credenciales', async () => {
    const handler = createStoreOgHandler({
      ImageResponseImpl: FakeImageResponse,
      environment: {},
      fetchImpl: vi.fn(),
    });
    const response = await handler(new Request(ENDPOINT));
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_CACHE);
    expect(JSON.stringify(imageCalls[0])).not.toMatch(/publishable|supabase|configuration_missing/i);
  });

  it('omite datos privados del modelo y de la imagen', async () => {
    const privateValues = [
      '+52 999 000 0000',
      'private@example.test',
      'Calle Privada',
      'licencia-privada',
      'tracking-privado',
    ];
    const result = structuredClone(okResult);
    Object.assign(result.portal, {
      phone: privateValues[0],
      email: privateValues[1],
      address: privateValues[2],
      license: privateValues[3],
      trackingToken: privateValues[4],
    });
    const { handler } = createHandler({ result });
    await handler(new Request(ENDPOINT));
    const serialized = JSON.stringify(imageCalls[0]);
    privateValues.forEach((value) => expect(serialized).not.toContain(value));
  });
});

describe('resiliencia del renderer', () => {
  it('conserva el render personalizado cuando ImageResponse funciona', async () => {
    const { handler } = createHandler({
      imageLoader: vi.fn(async (url) => (
        url.includes('logo')
          ? 'data:image/png;base64,iVBORw0KGgo='
          : 'data:image/jpeg;base64,/9j/4A=='
      )),
    });
    const response = await handler(new Request(ENDPOINT));
    expect(response.status).toBe(200);
    expect(imageCalls).toHaveLength(1);
    expect(JSON.stringify(imageCalls[0].element)).toContain('Tienda Segura');
  });

  it('primer fallo activa una sola tarjeta genérica sin imágenes y caché temporal', async () => {
    class FailOnceImageResponse {
      constructor(element, options) {
        imageCalls.push({ element, options });
        if (imageCalls.length === 1) throw new Error('renderer private details');
        return new Response(PNG_BYTES, {
          status: options.status,
          headers: options.headers,
        });
      }
    }
    const imageLoader = vi.fn(async (url) => (
      url.includes('logo')
        ? 'data:image/png;base64,iVBORw0KGgo='
        : 'data:image/jpeg;base64,/9j/4A=='
    ));
    const client = { getPortalBySlug: vi.fn(async () => okResult) };
    const handler = createStoreOgHandler({
      portalClient: client,
      imageLoader,
      ImageResponseImpl: FailOnceImageResponse,
    });

    const response = await handler(new Request(`${ENDPOINT}&v=7`));
    expect(response.status).toBe(200);
    expect(imageCalls).toHaveLength(2);
    expect(JSON.stringify(imageCalls[0].element)).toMatch(/data:image\/(?:png|jpeg);base64/u);
    expect(JSON.stringify(imageCalls[1].element)).not.toContain('data:image/');
    expect(JSON.stringify(imageCalls[1].element)).toContain('Tienda en línea');
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_CACHE);
    expect(response.headers.get('cache-control')).not.toContain('immutable');
  });

  it('segundo fallo devuelve 500 no-store sin declarar PNG ni filtrar detalles', async () => {
    class AlwaysFailImageResponse {
      constructor() {
        throw new Error('renderer stack slug=tienda-segura credential=private');
      }
    }
    const client = { getPortalBySlug: vi.fn(async () => okResult) };
    const handler = createStoreOgHandler({
      portalClient: client,
      imageLoader: vi.fn(async () => null),
      ImageResponseImpl: AlwaysFailImageResponse,
    });

    const response = await handler(new Request(`${ENDPOINT}&v=7`));
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-type')).not.toContain('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(body).toBe('Open Graph image unavailable.');
    expect(body).not.toMatch(/renderer|stack|tienda-segura|credential|private/iu);
  });

  it('materializa el fallo asíncrono del stream y usa la tarjeta de fallback', async () => {
    class AsyncFailOnceImageResponse {
      constructor(element, options) {
        imageCalls.push({ element, options });
        if (imageCalls.length === 1) {
          return { arrayBuffer: async () => { throw new TypeError('u2 is not iterable'); } };
        }
        return new Response(PNG_BYTES, { status: options.status });
      }
    }
    const handler = createStoreOgHandler({
      portalClient: { getPortalBySlug: vi.fn(async () => okResult) },
      imageLoader: vi.fn(async () => null),
      ImageResponseImpl: AsyncFailOnceImageResponse,
    });

    const response = await handler(new Request(ENDPOINT));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toHaveLength(1_001);
    expect(imageCalls).toHaveLength(2);
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_CACHE);
  });

  it.each([
    ['vacío', new Uint8Array()],
    ['con firma inválida', new Uint8Array(1_001)],
  ])('trata un PNG %s como fallo de render', async (_label, body) => {
    class InvalidPngImageResponse {
      constructor(_element, options) {
        return new Response(body, { status: options.status });
      }
    }
    const handler = createStoreOgHandler({
      portalClient: { getPortalBySlug: vi.fn(async () => okResult) },
      imageLoader: vi.fn(async () => null),
      ImageResponseImpl: InvalidPngImageResponse,
    });

    const response = await handler(new Request(ENDPOINT));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });
});

describe('política de caché por versión publicada', () => {
  it('usa immutable solo cuando v coincide con siteVersionNumber', async () => {
    const { handler } = createHandler();
    const response = await handler(new Request(`${ENDPOINT}&v=7`));
    expect(response.headers.get('cache-control')).toBe(VERSIONED_CACHE);
  });

  it.each([
    [ENDPOINT, 'versión ausente'],
    [`${ENDPOINT}&v=invalid`, 'versión inválida'],
    [`${ENDPOINT}&v=8`, 'versión discordante'],
    [`${ENDPOINT}&v=7&v=7`, 'versión duplicada'],
  ])('usa revalidación para %s', async (url) => {
    const { handler } = createHandler();
    const response = await handler(new Request(url));
    expect(response.headers.get('cache-control')).toBe(REVALIDATED_CACHE);
  });

  it('no almacena not_found durante un año', async () => {
    const { handler } = createHandler({ result: { status: 'not_found' } });
    const response = await handler(new Request(`${ENDPOINT}&v=7`));
    expect(response.headers.get('cache-control')).toBe(NOT_FOUND_CACHE);
    expect(response.headers.get('cache-control')).not.toContain('immutable');
  });

  it('no almacena un error temporal durante un año', async () => {
    const { handler } = createHandler({
      result: { status: 'unavailable', reason: 'network' },
    });
    const response = await handler(new Request(`${ENDPOINT}&v=7`));
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_CACHE);
    expect(response.headers.get('cache-control')).not.toContain('immutable');
  });
});
