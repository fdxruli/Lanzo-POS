import { describe, expect, it } from 'vitest';
import { buildEcommerceSiteBuilderPreviewCatalog, ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT } from '../ecommerceSiteBuilderPreview';

describe('ecommerceSiteBuilderPreview', () => {
  it('uses a single generic card without reading or mutating published products', () => {
    const products = Array.from({ length: 8 }, (_, index) => ({
      id: `product-${index}`, publicName: `Producto ${index}`, publicDescription: 'Descripción', categoryName: 'Categoría',
      price: 20 + index, currency: 'MXN', imageUrl: `image-${index}`, isPublished: true, isAvailable: true,
      metadata: { private: true }, localProductRef: `private-${index}`
    }));
    const original = structuredClone(products);
    const result = buildEcommerceSiteBuilderPreviewCatalog(products);
    expect(result.products).toHaveLength(ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT);
    expect(result.products[0]).toMatchObject({
      id: 'builder-preview-product',
      name: 'Producto de muestra',
      price: 199,
      categoryName: 'Catálogo'
    });
    expect(result.usesExamples).toBe(true);
    expect(products).toEqual(original);
  });

  it('creates deterministic, independent preview data', () => {
    const first = buildEcommerceSiteBuilderPreviewCatalog();
    const second = buildEcommerceSiteBuilderPreviewCatalog();
    expect(first.products).toHaveLength(1);
    expect(first.products).toEqual(second.products);
    expect(first.products[0]).not.toBe(second.products[0]);
    expect(first.usesExamples).toBe(true);
    expect(first.categories).toEqual(['Catálogo']);
  });
});
