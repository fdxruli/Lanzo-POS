const normalizePortalMaximum = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 99;
};

export function getPublicProductExactQuantity(product) {
  if (product?.stock?.mode !== 'exact') return null;

  const parsed = Number(product?.stock?.quantity);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

export function isPublicProductAvailable(product) {
  if (!product || product.isAvailable === false) return false;

  const stockMode = product.stock?.mode || 'hidden';
  const stockStatus = product.stock?.status || null;

  if (stockMode === 'hidden') return true;
  if (stockStatus === 'out_of_stock') return false;

  if (stockMode === 'exact') {
    const exactQuantity = getPublicProductExactQuantity(product);
    if (exactQuantity !== null && exactQuantity <= 0) return false;
  }

  return true;
}

export function getPublicProductStockLabel(product) {
  const stockMode = product?.stock?.mode || 'hidden';
  const stockStatus = product?.stock?.status || null;

  if (stockMode === 'hidden') return null;

  if (stockMode === 'status') {
    if (stockStatus === 'available') return 'Disponible';
    if (stockStatus === 'out_of_stock') return 'Agotado';
    return null;
  }

  if (stockMode === 'exact') {
    const exactQuantity = getPublicProductExactQuantity(product);
    if (stockStatus === 'out_of_stock' || exactQuantity === 0) return 'Agotado';
    if (exactQuantity !== null) return `${exactQuantity} disponibles`;
    if (stockStatus === 'available') return 'Disponible';
  }

  return null;
}

export function getPublicProductMaxQuantity(product, portalMaxItemQuantity = 99) {
  if (!isPublicProductAvailable(product)) return 0;

  const portalMaximum = normalizePortalMaximum(portalMaxItemQuantity);
  const exactQuantity = getPublicProductExactQuantity(product);

  if (exactQuantity === null) return portalMaximum;
  return Math.min(portalMaximum, exactQuantity);
}
