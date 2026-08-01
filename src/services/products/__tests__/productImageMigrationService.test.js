// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  migrateLegacyProductImages,
  prepareProductImageForCloud
} from '../productImageMigrationService';

const uploadResult = {
  bucket: 'images',
  path: 'public_uploads/license/product-image/test.webp',
  publicUrl: 'https://project.supabase.co/storage/v1/object/public/images/public_uploads/license/product-image/test.webp',
  mimeType: 'image/webp',
  optimized: true,
  originalSizeBytes: 1200,
  uploadedSizeBytes: 500
};

describe('productImageMigrationService', () => {
  it('recovers an img-* blob from IndexedDB and converts it into a public image URL', async () => {
    const getLocalImage = vi.fn().mockResolvedValue(new Blob(['legacy-image'], { type: 'image/jpeg' }));
    const uploadImage = vi.fn().mockResolvedValue(uploadResult);

    const result = await prepareProductImageForCloud({
      productData: {
        id: 'product-1',
        name: 'Electrolit Fresa',
        image: 'img-1785550192912'
      },
      existingProduct: {
        id: 'product-1',
        imageRef: 'img-1785550192912',
        metadata: { phase: 'fase2_products_catalog' }
      },
      licenseKey: 'LANZO-PRO',
      cloudEnabled: true,
      getLocalImage,
      uploadImage
    });

    expect(getLocalImage).toHaveBeenCalledWith('img-1785550192912');
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadImage.mock.calls[0][0]).toBeInstanceOf(File);
    expect(uploadImage.mock.calls[0][0].name).toBe('img-1785550192912.jpg');
    expect(result.uploaded).toBe(true);
    expect(result.productPayload.imageRef).toBe('img-1785550192912');
    expect(result.productPayload.imageUrl).toBe(uploadResult.publicUrl);
    expect(result.productPayload.metadata.images_cloud).toBe(true);
    expect(result.productPayload.metadata.image_strategy).toBe('cloud_public_url');
    expect(result.productPayload.metadata.image_migration_source).toBe('indexeddb_legacy_blob');
  });

  it('returns a reselection warning when the legacy blob is no longer on this device', async () => {
    const uploadImage = vi.fn();

    const result = await prepareProductImageForCloud({
      productData: { id: 'product-2', image: 'img-missing' },
      existingProduct: { id: 'product-2', imageRef: 'img-missing' },
      licenseKey: 'LANZO-PRO',
      cloudEnabled: true,
      getLocalImage: vi.fn().mockResolvedValue(null),
      uploadImage
    });

    expect(result.uploaded).toBe(false);
    expect(result.requiresReselection).toBe(true);
    expect(result.missingImageRef).toBe('img-missing');
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('migrates multiple legacy products sequentially and persists each public URL', async () => {
    const saveProduct = vi.fn().mockResolvedValue({ success: true });
    const uploadImage = vi.fn().mockResolvedValue(uploadResult);

    const summary = await migrateLegacyProductImages({
      products: [
        { id: 'p1', name: 'Uno', image: 'img-one' },
        { id: 'p2', name: 'Dos', imageRef: 'img-two' }
      ],
      licenseKey: 'LANZO-PRO',
      cloudEnabled: true,
      getLocalImage: vi.fn().mockResolvedValue(new Blob(['legacy'], { type: 'image/png' })),
      uploadImage,
      saveProduct
    });

    expect(summary).toMatchObject({ attempted: 2, migrated: 2, missingLocalBlob: 0, failed: 0 });
    expect(saveProduct).toHaveBeenCalledTimes(2);
    expect(saveProduct.mock.calls[0][0].imageUrl).toBe(uploadResult.publicUrl);
    expect(saveProduct.mock.calls[1][0].metadata.image_strategy).toBe('cloud_public_url');
  });
});
