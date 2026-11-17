const toSkuPart = (value, maxLength) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '')
  .slice(0, maxLength);

/** Build a readable candidate from variant details and its stable internal id. */
export const createApparelSkuCandidate = ({ productName, color, size, variantId, attempt = 0 } = {}) => {
  const productPart = toSkuPart(productName, 4) || 'ROPA';
  const colorPart = toSkuPart(color, 4) || 'GEN';
  const sizePart = toSkuPart(size, 8) || 'U';
  const idPart = toSkuPart(String(variantId ?? '').split(/[_-]/).filter(Boolean).at(-1), 8) || 'VARIANT';
  const attemptPart = Number(attempt) > 0 ? `-${Number(attempt).toString(36).toUpperCase()}` : '';

  return `${productPart}-${colorPart}-${sizePart}-${idPart}${attemptPart}`;
};
