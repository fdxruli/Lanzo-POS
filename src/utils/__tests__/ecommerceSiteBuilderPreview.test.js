import { describe, expect, it } from 'vitest';
import { buildEcommerceSiteBuilderPreviewCatalog, ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT } from '../ecommerceSiteBuilderPreview';

describe('ecommerceSiteBuilderPreview', () => {
  it('adapts only visual fields from up to six published products without mutation', () => {
    const products = Array.from({ length: 8 }, (_, index) => ({
      id: `product-${index}`, publicName: `Producto ${index}`, publicDescription: 'Descripción', categoryName: 'Categoría',
      price: 20 + index, currency: 'MXN', imageUrl: `image-${index}`, isPublished: true, isAvailable: true,
      metadata: { private: true }, localProductRef: `private-${index}`
    }));
    const original = structuredClone(products);
    const result = buildEcommerceSiteBuilderPreviewCatalog(products);
    expect(result.products).toHaveLength(ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT);
    expect(Object.keys(result.products[0]).sort()).toEqual([
      'categoryName', 'configuration', 'currency', 'description', 'id', 'imageUrl', 'isAvailable', 'name', 'price', 'stock'
    ]);
    expect(result.products[0]).not.toHaveProperty('metadata');
    expect(result.products[0]).not.toHaveProperty('localProductRef');
    expect(result.usesExamples).toBe(false);
    expect(products).toEqual(original);
  });

  it('uses deterministic in-memory examples when there are no published products', () => {
    const first = buildEcommerceSiteBuilderPreviewCatalog([]);
    const second = buildEcommerceSiteBuilderPreviewCatalog([{ id: 'hidden', isPublished: false }]);
    expect(first.products).toHaveLength(3);
    expect(first.products).toEqual(second.products);
    expect(first.usesExamples).toBe(true);
    expect(first.categories).toContain('Contenido de ejemplo');
  });
});
