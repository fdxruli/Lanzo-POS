const getEntropy = () => Math.random().toString(36).slice(2, 8);

const isUsableCartProductId = (value) => (
  (typeof value === 'string' && value.trim() !== '') ||
  (typeof value === 'number' && Number.isFinite(value))
);

/**
 * Returns only explicit product references.  `id` is intentionally excluded:
 * persisted cart lines may use it for the line identity.
 */
export const getCartProductId = (item = {}) => {
  for (const value of [item.productId, item.product_id, item.parentId]) {
    if (isUsableCartProductId(value)) return value;
  }
  return null;
};

/**
 * Adds the canonical product reference when the input is known to be a
 * catalog product or a scanner-resolved product.  The `id` fallback is opt-in
 * so arbitrary persisted lines can never be promoted accidentally.
 */
export const ensureCartProductReference = (product, { allowIdFallback = false } = {}) => {
  if (!product || typeof product !== 'object') return product;

  const productId = getCartProductId(product) ?? (
    allowIdFallback && isUsableCartProductId(product.id) ? product.id : null
  );

  if (productId === null || product.productId === productId) return product;

  return {
    ...product,
    productId
  };
};

export const createCartLineId = (item = {}) => {
  const productId = item?.id || item?.parentId || item?.productId || 'item';
  const batchId = item?.batchId || item?.variantId || 'base';
  return `${productId}-${batchId}-${Date.now()}-${getEntropy()}`;
};

export const getCartLineId = (item, index = null) => {
  if (!item) return null;

  return (
    item.lineId ||
    item.cartItemId ||
    item.orderItemId ||
    item.uniqueLineId ||
    (index !== null && index !== undefined ? `${item.id || 'item'}:${index}` : item.id || null)
  );
};

export const ensureCartLineId = (item) => {
  if (!item || typeof item !== 'object') return item;
  if (item.lineId) return item;

  return {
    ...item,
    lineId: item.cartItemId || item.orderItemId || item.uniqueLineId || createCartLineId(item)
  };
};

export const normalizeCartItems = (items = []) => (
  Array.isArray(items) ? items.map(ensureCartLineId) : []
);

export const isCartLineMatch = (item, lineId, index = null) => (
  Boolean(lineId) && getCartLineId(item, index) === lineId
);

export const shouldCreateSeparateCartLine = (product = {}) => (
  Boolean(product.forceNewLine) ||
  (Array.isArray(product.selectedModifiers) && product.selectedModifiers.length > 0) ||
  Boolean(product.notes) ||
  (product.saleType === 'bulk' && !product.batchId)
);
