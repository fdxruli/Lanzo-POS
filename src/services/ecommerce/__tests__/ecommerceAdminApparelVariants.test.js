import { describe, expect, it, vi } from 'vitest';
import { ecommerceAdminServiceInternals } from '../ecommerceAdminService';

const product = {
  id: 'product-polo',
  name: 'Camisa polo',
  price: 299,
  trackStock: true,
  batchManagement: { enabled: true }
};

const localSource = (batches) => ({
  getBatchesByProductIds: vi.fn().mockResolvedValue(new Map([[product.id, batches]]))
});

describe('manual ecommerce apparel publication', () => {
  it('projects local apparel batches before building the v2 payload', async () => {
    const source = localSource([
      {
        id: 'batch-black-m',
        productId: product.id,
        isActive: true,
        sku: 'POLO-NEG-M',
        stock: 2,
        committedStock: 0,
        price: 299,
        attributes: { color: 'Negro', talla: 'M' }
      }
    ]);

    const prepared = await ecommerceAdminServiceInternals.preparePublishedProductPayloadAsync({
      localProduct: product,
      publicName: product.name,
      price: product.price
    }, { localSource: source, now: new Date('2026-07-17T12:00:00Z') });

    expect(source.getBatchesByProductIds).toHaveBeenCalledWith([product.id]);
    expect(prepared.useV2).toBe(true);
    expect(prepared.payload.configuration).toMatchObject({
      configurationType: 'variant_parent',
      hasVariants: true,
      requiresConfiguration: true
    });
    expect(prepared.payload.configuration.variants).toHaveLength(1);
    expect(prepared.payload.configuration.variants[0]).toMatchObject({
      sourceVariantRef: 'sku:POLO-NEG-M',
      sku: 'POLO-NEG-M',
      optionValues: { color: 'Negro', talla: 'M' },
      stockSnapshot: 2
    });
  });

  it('keeps a simple product simple when its batches have no variant attributes', async () => {
    const source = localSource([
      {
        id: 'ordinary-batch',
        productId: product.id,
        isActive: true,
        stock: 5,
        price: 299,
        attributes: {}
      }
    ]);

    const prepared = await ecommerceAdminServiceInternals.preparePublishedProductPayloadAsync({
      localProduct: product,
      publicName: product.name,
      price: product.price
    }, { localSource: source });

    expect(prepared.payload.configuration).toMatchObject({
      configurationType: 'simple',
      hasVariants: false
    });
  });

  it('blocks conflicting prices instead of publishing an arbitrary value', async () => {
    const source = localSource([
      {
        id: 'entry-1',
        productId: product.id,
        isActive: true,
        sku: 'POLO-NEG-M',
        stock: 1,
        price: 299,
        attributes: { color: 'Negro', talla: 'M' }
      },
      {
        id: 'entry-2',
        productId: product.id,
        isActive: true,
        sku: 'POLO-NEG-M',
        stock: 1,
        price: 329,
        attributes: { color: 'Negro', talla: 'M' }
      }
    ]);

    await expect(ecommerceAdminServiceInternals.preparePublishedProductPayloadAsync({
      localProduct: product,
      publicName: product.name,
      price: product.price
    }, { localSource: source })).rejects.toMatchObject({
      code: 'ECOMMERCE_APPAREL_VARIANT_PRICE_CONFLICT'
    });
  });
});
