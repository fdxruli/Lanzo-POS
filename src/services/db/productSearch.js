const DEFAULT_SEARCH_LIMIT = 50;

const normalizeSearchValue = (value) =>
  value === null || value === undefined ? '' : String(value).toLowerCase();

const matchesStatus = (product, status) => {
  const isActive = product?.isActive !== false;
  if (status === 'active') return isActive;
  if (status === 'inactive') return !isActive;
  return true;
};

export const searchProductsInTable = async (
  productTable,
  searchTerm,
  status = 'active'
) => {
  const normalizedTerm = normalizeSearchValue(searchTerm).trim();
  if (!normalizedTerm) return [];

  if (/^\d+$/.test(normalizedTerm)) {
    const exactBarcode = await productTable
      .where('barcode')
      .equals(normalizedTerm)
      .first();

    if (exactBarcode && matchesStatus(exactBarcode, status)) {
      return [exactBarcode];
    }

    const exactSku = await productTable
      .where('sku')
      .equals(normalizedTerm)
      .first();

    if (exactSku && matchesStatus(exactSku, status)) {
      return [exactSku];
    }
  }

  const nameResults = await productTable
    .where('name_lower')
    .startsWith(normalizedTerm)
    .filter((product) => matchesStatus(product, status))
    .limit(DEFAULT_SEARCH_LIMIT)
    .toArray();

  const takenIds = new Set(nameResults.map((product) => product.id));
  const codeResults = await productTable
    .filter((product) => {
      if (!matchesStatus(product, status) || takenIds.has(product.id)) return false;

      const barcode = normalizeSearchValue(product?.barcode);
      const sku = normalizeSearchValue(product?.sku);
      const name = normalizeSearchValue(product?.name_lower || product?.name);

      return barcode.includes(normalizedTerm)
        || sku.includes(normalizedTerm)
        || name.includes(normalizedTerm);
    })
    .limit(DEFAULT_SEARCH_LIMIT - nameResults.length)
    .toArray();

  return [...nameResults, ...codeResults];
};
