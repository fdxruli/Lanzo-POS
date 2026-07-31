import { ImageResponse } from '@vercel/og';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStoreOgHandler,
  renderStoreOgImage,
} from '../../api/og/store.js';
import {
  StoreOgCard,
  buildStoreOgCardModel,
} from '../../api/_storeOgCard.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const personalizedResult = {
  status: 'ok',
  portal: {
    slug: 'tienda-render',
    name: 'Tienda Render',
    headline: 'Productos seleccionados para ti',
    description: 'Descripción pública',
    theme: {
      primaryColor: '#112233',
      secondaryColor: '#aabbcc',
      cornerStyle: 'soft',
      fontStyle: 'editorial',
    },
    logoUrl: '',
    coverImageUrl: '',
  },
  siteVersionNumber: 1,
};

const farmaciaGaryResult = {
  status: 'ok',
  portal: {
    slug: 'farmaciagary',
    name: 'Farmacia Gary',
    headline: 'Medicamentos y cuidado para toda la familia',
    description: 'Compra productos de farmacia con entrega local.',
    theme: {
      primaryColor: '#166534',
      secondaryColor: '#bef264',
      cornerStyle: 'rounded',
      fontStyle: 'system',
    },
    logoUrl: '',
    coverImageUrl: '',
  },
  siteVersionNumber: 12,
};
const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3jgAAAABJRU5ErkJggg==';
const TWO_PIXEL_WEBP = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAAAwAgCdASoCAAIAAMASJaACdLoB+AH4AARoAAD++iGX/3easNN39a3/9aOfron+tHP/WVgA';

function readPngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function collectImageElements(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (node.type === 'img') result.push(node);
  const children = node.props?.children;
  const childList = Array.isArray(children) ? children : [children];
  childList.forEach((child) => collectImageElements(child, result));
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('render real con @vercel/og ImageResponse', () => {
  it.each([
    [
      'tarjeta genérica sin imágenes',
      buildStoreOgCardModel({
        result: { status: 'unavailable', reason: 'configuration_missing' },
      }),
    ],
    [
      'tarjeta con nombre y tema',
      buildStoreOgCardModel({ result: personalizedResult }),
    ],
    [
      'tarjeta con portada PNG y logo WebP embebidos',
      buildStoreOgCardModel({
        result: personalizedResult,
        logoImage: TWO_PIXEL_WEBP,
        coverImage: ONE_PIXEL_PNG,
      }),
    ],
    [
      'fallback de tienda inexistente',
      buildStoreOgCardModel({ result: { status: 'not_found' } }),
    ],
  ])('produce PNG real para %s', async (label, model) => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('El render no debe utilizar red.');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = renderStoreOgImage({
      ImageResponseImpl: ImageResponse,
      model,
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(model)).not.toMatch(/https?:\/\/|data:font|fontFamily|Arial|Georgia/iu);
  }, 30_000);

  it('declara dimensiones intrínsecas para portada y logo', () => {
    const model = buildStoreOgCardModel({
      result: personalizedResult,
      logoImage: TWO_PIXEL_WEBP,
      coverImage: ONE_PIXEL_PNG,
    });
    const images = collectImageElements(StoreOgCard({ model }));

    expect(images).toHaveLength(2);
    expect(images).toEqual(expect.arrayContaining([
      expect.objectContaining({
        props: expect.objectContaining({ width: 112, height: 112 }),
      }),
      expect.objectContaining({
        props: expect.objectContaining({ width: 1200, height: 630 }),
      }),
    ]));
  });

  it('materializa Farmacia Gary con logo y portada sin degradar a identidad textual', async () => {
    const logger = { warn: vi.fn() };
    const imageLoader = vi.fn()
      .mockResolvedValueOnce(TWO_PIXEL_WEBP)
      .mockResolvedValueOnce(ONE_PIXEL_PNG);
    const handler = createStoreOgHandler({
      portalClient: { getPortalBySlug: vi.fn(async () => farmaciaGaryResult) },
      imageLoader,
      ImageResponseImpl: ImageResponse,
      logger,
    });
    const response = await handler(new Request(
      'https://tienda.lanzo.test/api/og/store?slug=farmaciagary',
    ));
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(imageLoader).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalled();
  }, 30_000);
});
