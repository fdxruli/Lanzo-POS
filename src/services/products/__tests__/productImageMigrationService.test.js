// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/dexie', () => ({ db: { isOpen: () => true }, STORES: { IMAGES: 'images', MENU: 'menu' } }));
vi.mock('../../storage/imageUploadService', () => ({ uploadProductImage: vi.fn() }));

import { prepareProductImageForCloud } from '../productImageMigrationService';

describe('prepareProductImageForCloud', () => {
  it('uses the original selected file for cloud publication while retaining the processed local image', async () => {
    const original = new File(['source'], 'source.png', { type: 'image/png' });
    const compressed = new Blob(['compressed'], { type: 'image/webp' });
    const uploadImage = vi.fn().mockResolvedValue({
      publicUrl: 'https://cdn.example.test/product.png', bucket: 'products', path: 'product.png', mimeType: 'image/png', optimized: true, originalSizeBytes: 6, uploadedSizeBytes: 4
    });

    const result = await prepareProductImageForCloud({
      productData: { image: compressed, imageUploadSource: original }, licenseKey: 'license', cloudEnabled: true, uploadImage
    });

    expect(uploadImage).toHaveBeenCalledWith(original, 'license');
    expect(result.productPayload.image).toBe(compressed);
    expect(result.productPayload.imageUploadSource).toBeUndefined();
    expect(result.productPayload.imageUrl).toBe('https://cdn.example.test/product.png');
  });

  it('preserves existing public media without uploading it again', async () => {
    const uploadImage = vi.fn();
    const result = await prepareProductImageForCloud({
      productData: { name: 'Producto' }, existingProduct: { imageUrl: 'https://cdn.example.test/existing.png', imageRef: 'img-existing' }, licenseKey: 'license', cloudEnabled: true, uploadImage
    });

    expect(result.status).toBe('already_public');
    expect(result.productPayload).toMatchObject({ imageUrl: 'https://cdn.example.test/existing.png', imageRef: 'img-existing' });
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('treats image removal as explicit and never uploads the previous image', async () => {
    const uploadImage = vi.fn();
    const result = await prepareProductImageForCloud({
      productData: { imageRemoved: true, image: new File(['new'], 'new.png', { type: 'image/png' }) }, existingProduct: { imageUrl: 'https://cdn.example.test/existing.png', imageRef: 'img-existing' }, licenseKey: 'license', cloudEnabled: true, uploadImage
    });

    expect(result.status).toBe('removed');
    expect(result.productPayload).toMatchObject({ image: null, imageUrl: null, imageRef: null });
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
