export const ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT = 1;

const GENERIC_PREVIEW_PRODUCT = Object.freeze({
  id: 'builder-preview-product',
  name: 'Producto de muestra',
  description: 'Así se verá la tarjeta de un producto en tu tienda.',
  price: 199,
  currency: 'MXN',
  imageUrl: '',
  categoryName: 'Catálogo',
  isAvailable: true,
  stock: { mode: 'hidden' },
  configuration: { requiresConfiguration: false, hasVariants: false, hasOptionGroups: false }
});

const createGenericPreviewProduct = () => ({
  ...GENERIC_PREVIEW_PRODUCT,
  stock: { ...GENERIC_PREVIEW_PRODUCT.stock },
  configuration: { ...GENERIC_PREVIEW_PRODUCT.configuration }
});

export const buildEcommerceSiteBuilderPreviewCatalog = () => {
  const previewProduct = createGenericPreviewProduct();
  return {
    products: [previewProduct],
    categories: [previewProduct.categoryName],
    usesExamples: true
  };
};

export const ecommerceSiteBuilderPreviewInternals = Object.freeze({
  GENERIC_PREVIEW_PRODUCT,
  createGenericPreviewProduct
});
