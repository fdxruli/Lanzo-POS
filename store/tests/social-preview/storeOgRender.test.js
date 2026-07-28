import { ImageResponse } from '@vercel/og';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderStoreOgImage,
} from '../../api/og/store.jsx';
import { buildStoreOgCardModel } from '../../api/_storeOgCard.js';

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

function readPngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
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
    expect(bytes.byteLength).toBeGreaterThan(PNG_SIGNATURE.length);
    expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(model)).not.toMatch(/https?:\/\/|data:font|fontFamily|Arial|Georgia/iu);
  });
});
