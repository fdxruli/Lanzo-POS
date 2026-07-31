import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  createSafePublicImageLoader,
  hasValidImageSignature,
  normalizePublicImageForOg,
} from '../../api/_safePublicImage.js';

const SUPABASE_URL = 'https://public-project.supabase.test';
const PUBLIC_WEBP = `${SUPABASE_URL}/storage/v1/object/public/branding/logo.webp`;
const WEBP_BASE64 = 'UklGRkAAAABXRUJQVlA4IDQAAAAwAgCdASoCAAIAAMASJaACdLoB+AH4AARoAAD++iGX/3easNN39a3/9aOfron+tHP/WVgA';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function webpBytes() {
  const buffer = Buffer.from(WEBP_BASE64, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function streamedResponse(bytes, contentType = 'image/webp') {
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: {
      get: vi.fn((name) => ({
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
      })[name.toLowerCase()] ?? null),
    },
    body: {
      getReader: vi.fn(() => ({
        read: vi.fn(async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        }),
        cancel: vi.fn(async () => {}),
        releaseLock: vi.fn(),
      })),
    },
  };
}

describe('normalización de imágenes para Open Graph', () => {
  it('convierte WebP válido a PNG decodificable y conserva el límite', async () => {
    const normalized = await normalizePublicImageForOg({
      bytes: webpBytes(),
      contentType: 'image/webp',
      maximumBytes: 5 * 1024 * 1024,
    });

    expect(normalized?.contentType).toBe('image/png');
    expect(normalized.bytes.byteLength).toBeGreaterThan(PNG_SIGNATURE.length);
    expect(Array.from(normalized.bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(hasValidImageSignature('image/png', normalized.bytes)).toBe(true);
  });

  it('hace que el loader entregue PNG aunque Supabase almacene WebP', async () => {
    const bytes = webpBytes();
    const fetchImpl = vi.fn(async () => streamedResponse(bytes));
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl,
    });

    const result = await loader(PUBLIC_WEBP);

    expect(result).toMatch(/^data:image\/png;base64,/u);
    const output = Buffer.from(result.split(',', 2)[1], 'base64');
    expect(Array.from(output.subarray(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE);
    expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_WEBP, expect.objectContaining({
      redirect: 'error',
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
    }));
  });

  it('rechaza WebP corrupto en vez de entregarlo al renderizador', async () => {
    const corrupt = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    const loader = createSafePublicImageLoader({
      supabaseUrl: SUPABASE_URL,
      fetchImpl: vi.fn(async () => streamedResponse(corrupt)),
    });

    await expect(loader(PUBLIC_WEBP)).resolves.toBeNull();
  });
});
