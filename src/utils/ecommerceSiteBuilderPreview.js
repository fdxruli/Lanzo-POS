export const ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT = 6;

const EXAMPLE_PRODUCTS = Object.freeze([
  {
    id: 'builder-example-1', name: 'Producto de ejemplo', description: 'Contenido ilustrativo de la vista previa.',
    price: 89, currency: 'MXN', imageUrl: '', categoryName: 'Contenido de ejemplo', isAvailable: true,
    stock: { mode: 'hidden' }, configuration: { requiresConfiguration: false, hasVariants: false, hasOptionGroups: false }
  },
  {
    id: 'builder-example-2', name: 'Otro producto de ejemplo', description: 'No se guarda ni se publica.',
    price: 129, currency: 'MXN', imageUrl: '', categoryName: 'Contenido de ejemplo', isAvailable: true,
    stock: { mode: 'status', status: 'available' }, configuration: { requiresConfiguration: false, hasVariants: false, hasOptionGroups: false }
  },
  {
    id: 'builder-example-3', name: 'Especial de ejemplo', description: 'Sirve únicamente para revisar el diseño.',
    price: 159, currency: 'MXN', imageUrl: '', categoryName: 'Especiales de ejemplo', isAvailable: true,
    stock: { mode: 'hidden' }, configuration: { requiresConfiguration: false, hasVariants: false, hasOptionGroups: false }
  }
]);

const text = (value, fallback = '') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const price = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
};

const adaptProduct = (product, index) => ({
  id: text(product?.id, `builder-preview-${index + 1}`),
  name: text(product?.publicName || product?.name, `Producto ${index + 1}`),
  description: text(product?.publicDescription || product?.description),
  price: price(product?.price),
  currency: text(product?.currency, 'MXN'),
  imageUrl: text(product?.imageUrl),
  categoryName: text(product?.categoryName, 'General'),
  isAvailable: product?.isAvailable !== false,
  stock: { mode: 'hidden' },
  configuration: { requiresConfiguration: false, hasVariants: false, hasOptionGroups: false }
});

export const buildEcommerceSiteBuilderPreviewCatalog = (products) => {
  const published = Array.isArray(products)
    ? products.filter((product) => product?.isPublished === true).slice(0, ECOMMERCE_BUILDER_PREVIEW_PRODUCT_LIMIT)
    : [];
  const previewProducts = published.length > 0
    ? published.map(adaptProduct)
    : EXAMPLE_PRODUCTS.map((product) => ({ ...product, stock: { ...product.stock }, configuration: { ...product.configuration } }));
  return {
    products: previewProducts,
    categories: [...new Set(previewProducts.map((product) => product.categoryName).filter(Boolean))],
    usesExamples: published.length === 0
  };
};

export const ecommerceSiteBuilderPreviewInternals = Object.freeze({ EXAMPLE_PRODUCTS, adaptProduct });
