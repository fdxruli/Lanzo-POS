// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { productToCloudPayload } from '../productMapper';

describe('productMapper cloud image metadata', () => {
  it('keeps a public image URL and marks the cloud strategy truthfully', () => {
    const payload = productToCloudPayload({
      id: 'product-cloud-image',
      name: 'Producto con imagen',
      imageRef: 'img-local-copy',
      imageUrl: 'https://project.supabase.co/storage/v1/object/public/images/product.webp',
      metadata: { source: 'test' }
    });

    expect(payload.image_ref).toBe('img-local-copy');
    expect(payload.image_url).toContain('/storage/v1/object/public/images/');
    expect(payload.metadata).toMatchObject({
      source: 'test',
      images_cloud: true,
      image_strategy: 'cloud_public_url'
    });
  });

  it('marks a legacy local-only reference without inventing a public URL', () => {
    const payload = productToCloudPayload({
      id: 'product-local-image',
      name: 'Producto local',
      image: 'img-legacy'
    });

    expect(payload.image_ref).toBe('img-legacy');
    expect(payload.image_url).toBeNull();
    expect(payload.metadata.images_cloud).toBe(false);
    expect(payload.metadata.image_strategy).toBe('local_reference_only');
  });

  it('does not serialize a transient File object as an image reference', () => {
    const payload = productToCloudPayload({
      id: 'product-transient-file',
      name: 'Producto nuevo',
      image: new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    });

    expect(payload.image_ref).toBeNull();
    expect(payload.image_url).toBeNull();
    expect(payload.metadata.image_strategy).toBe('none');
  });
});
