import { Buffer } from 'node:buffer';
import { ImageResponse } from '@vercel/og';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStoreOgHandler,
  renderStoreOgImage,
} from '../../api/og/store.js';
import { buildStoreOgFallbackCardModel } from '../../api/_storeOgFallbackCard.js';
import { normalizePublicImageForOg } from '../../api/_safePublicImage.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const demoStoreResult = {
  status: 'ok',
  portal: {
    slug: 'demo-store',
    name: 'Negocio de Ejemplo',
    headline: 'Productos seleccionados para tu día',
    description: 'Compra productos de ejemplo con entrega local.',
    templateCode: 'classic',
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
const TWO_PIXEL_WEBP_BASE64 = 'UklGRkAAAABXRUJQVlA4IDQAAAAwAgCdASoCAAIAAMASJaACdLoB+AH4AARoAAD++iGX/3easNN39a3/9aOfron+tHP/WVgA';

function readPngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

async function normalizedWebpLogo() {
  const source = Buffer.from(TWO_PIXEL_WEBP_BASE64, 'base64');
  const normalized = await normalizePublicImageForOg({
    bytes: new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    contentType: 'image/webp',
  });
  expect(normalized?.contentType).toBe('image/png');
  expect(Array.from(normalized.bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
  return `data:image/png;base64,${Buffer.from(normalized.bytes).toString('base64')}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('render real con @vercel/og ImageResponse', () => {
  it.each([
    [
      'tarjeta genérica sin imágenes',
      buildStoreOgFallbackCardModel({ status: 'unavailable' }),
    ],
    [
      'fallback de tienda inexistente',
      buildStoreOgFallbackCardModel({ status: 'not_found' }),
    ],
  ])('produce PNG real para %s', async (_label, model) => {
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
    expect(JSON.stringify(model)).not.toMatch(/https?:\/\/|data:image|data:font|fontFamily|Arial|Georgia|businessType/iu);
  }, 30_000);

  it('materializa una tienda de ejemplo con V2, logo y portada sin usar red en el renderer', async () => {
    const logoImage = await normalizedWebpLogo();
    const fetchSpy = vi.fn(async () => {
      throw new Error('El renderer de producción V2 no debe utilizar red.');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const logger = { warn: vi.fn() };
    const imageLoader = vi.fn()
      .mockResolvedValueOnce(logoImage)
      .mockResolvedValueOnce(ONE_PIXEL_PNG);
    const handler = createStoreOgHandler({
      portalClient: { getPortalBySlug: vi.fn(async () => demoStoreResult) },
      imageLoader,
      ImageResponseImpl: ImageResponse,
      logger,
    });
    const response = await handler(new Request(
      'https://tienda.lanzo.test/api/og/store?slug=demo-store',
    ));
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
    expect(imageLoader).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  }, 30_000);
});
