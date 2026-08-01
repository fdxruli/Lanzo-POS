// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveProductImageCloudSyncBadge } from '../ProductCloudSyncIndicators';
import { resolveProductCloudSyncBadge } from '../../../services/products/productConstants';

const syncedProduct = {
  id: 'product-1',
  name: 'Electrolit Fresa',
  syncStatus: 'synced',
  serverVersion: 5,
  lastSyncedAt: '2026-08-01T04:19:42.601Z'
};

describe('product cloud sync indicators', () => {
  it('reports product and public image as independently synchronized', () => {
    const product = {
      ...syncedProduct,
      imageRef: 'img-1785550192912',
      imageUrl: 'https://project.supabase.co/storage/v1/object/public/images/product.webp'
    };

    expect(resolveProductCloudSyncBadge(product)).toMatchObject({
      status: 'synced',
      label: 'Sincronizado'
    });
    expect(resolveProductImageCloudSyncBadge(product)).toMatchObject({
      status: 'synced',
      label: 'Imagen: Pública'
    });
  });

  it('keeps the product synchronized while the local image remains pending', () => {
    const product = {
      ...syncedProduct,
      image: 'img-1785550192912',
      imageUrl: null
    };

    expect(resolveProductCloudSyncBadge(product).status).toBe('synced');
    expect(resolveProductImageCloudSyncBadge(product)).toMatchObject({
      status: 'pending',
      label: 'Imagen: Pendiente'
    });
  });

  it('distinguishes products without an assigned image', () => {
    expect(resolveProductImageCloudSyncBadge(syncedProduct)).toMatchObject({
      status: 'empty',
      label: 'Imagen: Sin imagen'
    });
  });

  it('shows a separate image error without changing the product sync state', () => {
    const product = {
      ...syncedProduct,
      imageRef: 'img-failed',
      metadata: { image_migration_status: 'failed' }
    };

    expect(resolveProductCloudSyncBadge(product).status).toBe('synced');
    expect(resolveProductImageCloudSyncBadge(product)).toMatchObject({
      status: 'error',
      label: 'Imagen: Error'
    });
  });
});
