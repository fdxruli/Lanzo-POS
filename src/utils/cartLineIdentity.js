const getEntropy = () => Math.random().toString(36).slice(2, 8);

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
