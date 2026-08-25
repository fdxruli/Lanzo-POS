import { ImageResponse } from '@vercel/og';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StoreOgCardV2,
  buildStoreOgCardV2RenderState,
} from '../../api/_storeOgCardV2.js';
import { buildStoreOgCardV2Model } from '../../api/_storeOgCardV2Model.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3jgAAAABJRU5ErkJggg==';

function baseInput(overrides = {}) {
  return {
    name: 'Café del Centro',
    headline: 'Productos elegidos para disfrutar en casa',
    description: 'Descripción secundaria',
    templateCode: 'classic',
    theme: {
      primaryColor: '#112233',
      secondaryColor: '#aabbcc',
      cornerStyle: 'soft',
      fontStyle: 'editorial',
    },
    logoUrl: 'https://public-project.supabase.test/storage/v1/object/public/logos/logo.png',
    coverImageUrl: 'https://public-project.supabase.test/storage/v1/object/public/covers/cover.png',
    ...overrides,
  };
}

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

async function renderRealPng({ model, logoImage = null, coverImage = null }) {
  const fetchSpy = vi.fn(async () => {
    throw new Error('StoreOgCardV2 no debe utilizar red.');
  });
  vi.stubGlobal('fetch', fetchSpy);

  const response = new ImageResponse(
    StoreOgCardV2({ model, logoImage, coverImage }),
    { width: 1200, height: 630, status: 200 },
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('image/png');
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
  expect(readPngDimensions(bytes)).toEqual({ width: 1200, height: 630 });
  expect(fetchSpy).not.toHaveBeenCalled();
  return bytes;
}

const IMAGE_MATRIX = [
  ['logo + cover', ONE_PIXEL_PNG, ONE_PIXEL_PNG],
  ['cover only', null, ONE_PIXEL_PNG],
  ['logo only', ONE_PIXEL_PNG, null],
  ['no images', null, null],
];
const TEMPLATE_MATRIX = ['compact', 'classic', 'showcase'].flatMap((templateCode) => (
  IMAGE_MATRIX.map(([label, logoImage, coverImage]) => [
    `${templateCode}: ${label}`,
    templateCode,
    logoImage,
    coverImage,
  ])
));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StoreOgCardV2', () => {
  it.each(TEMPLATE_MATRIX)(
    'renderiza PNG real 1200x630 para %s',
    async (_label, templateCode, logoImage, coverImage) => {
      const model = buildStoreOgCardV2Model(baseInput({ templateCode }));
      await renderRealPng({ model, logoImage, coverImage });
    },
    30_000,
  );

  it('mantiene compact, classic y showcase como composiciones estructuralmente distintas', () => {
    const layouts = ['compact', 'classic', 'showcase'].map((templateCode) => {
      const model = buildStoreOgCardV2Model(baseInput({ templateCode }));
      const tree = StoreOgCardV2({
        model,
        logoImage: ONE_PIXEL_PNG,
        coverImage: ONE_PIXEL_PNG,
      });
      return tree.props['data-og-v2-layout'];
    });

    expect(layouts).toEqual(['compact', 'classic', 'showcase']);
    expect(new Set(layouts).size).toBe(3);
  });

  it('no renderiza directamente URLs HTTPS del modelo cuando faltan imágenes embebidas', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      logoUrl: 'https://remote.example.test/logo.png',
      coverImageUrl: 'https://remote.example.test/cover.png',
    }));
    const tree = StoreOgCardV2({ model });
    const images = collectImageElements(tree);
    const serialized = JSON.stringify(tree);

    expect(images).toHaveLength(0);
    expect(serialized).not.toContain(model.branding.logoUrl);
    expect(serialized).not.toContain(model.branding.coverImageUrl);
    expect(serialized).not.toMatch(/https?:\/\//iu);
  });

  it('rechaza render inputs que no sean imágenes data URI embebidas permitidas', () => {
    const model = buildStoreOgCardV2Model(baseInput());
    const state = buildStoreOgCardV2RenderState({
      model,
      logoImage: 'https://remote.example.test/logo.png',
      coverImage: 'data:image/svg+xml;base64,PHN2Zy8+',
    });

    expect(state.logoImage).toBeNull();
    expect(state.coverImage).toBeNull();
  });

  it.each(['compact', 'classic', 'showcase'])(
    'declara dimensiones intrínsecas en todas las imágenes de %s',
    (templateCode) => {
      const model = buildStoreOgCardV2Model(baseInput({ templateCode }));
      const images = collectImageElements(StoreOgCardV2({
        model,
        logoImage: ONE_PIXEL_PNG,
        coverImage: ONE_PIXEL_PNG,
      }));

      expect(images.length).toBeGreaterThanOrEqual(2);
      images.forEach((image) => {
        expect(image.props.width).toEqual(expect.any(Number));
        expect(image.props.height).toEqual(expect.any(Number));
        expect(image.props.width).toBeGreaterThan(0);
        expect(image.props.height).toBeGreaterThan(0);
      });
    },
  );

  it.each([
    ['short', 'Café Uno'],
    ['long', 'La Tienda Artesanal del Centro Histórico de la Ciudad'],
    ['very long', 'V'.repeat(120)],
  ])('renderiza nombre %s sin depender de medición del navegador', async (_label, name) => {
    const model = buildStoreOgCardV2Model(baseInput({ name, templateCode: 'classic' }));
    await renderRealPng({ model, logoImage: ONE_PIXEL_PNG, coverImage: ONE_PIXEL_PNG });
  }, 30_000);

  it.each([
    ['light', {
      primaryColor: '#ffffff',
      secondaryColor: '#f8fafc',
      cornerStyle: 'rounded',
    }],
    ['dark', {
      primaryColor: '#0f172a',
      secondaryColor: '#020617',
      cornerStyle: 'square',
    }],
    ['similar colors', {
      primaryColor: '#334155',
      secondaryColor: '#334154',
      cornerStyle: 'soft',
    }],
    ['invalid fallback', {
      primaryColor: 'red',
      secondaryColor: 'private-color',
      cornerStyle: 'circle',
    }],
  ])('renderiza theme %s usando tokens semánticos del modelo', async (_label, theme) => {
    const model = buildStoreOgCardV2Model(baseInput({ theme, templateCode: 'showcase' }));
    await renderRealPng({ model, logoImage: null, coverImage: ONE_PIXEL_PNG });
  }, 30_000);

  it('no incluye descripción social completa dentro del PNG V2', () => {
    const description = 'Descripción social que debe quedarse fuera de la composición visual V2.';
    const model = buildStoreOgCardV2Model(baseInput({
      headline: description,
      templateCode: 'compact',
    }));
    const tree = StoreOgCardV2({ model });

    expect(JSON.stringify(tree)).not.toContain(description);
  });

});
