import {
  buildSearchNgrams,
  normalizeProductSearchValue
} from './productSearchIndex';

const DEFAULT_SEARCH_LIMIT = 50;

const matchesStatus = (product, status) => {
  const isActive = product?.isActive !== false;
  if (status === 'active') return isActive;
  if (status === 'inactive') return !isActive;
  return true;
};

const matchesCategory = (product, categoryFilter) => {
  if (categoryFilter === null || categoryFilter === undefined) return true;

  const productCategoryId = [product?.categoryId, product?.category_id]
    .find((value) => value !== null && value !== undefined && value !== '') ?? null;
  if (categoryFilter?.type === 'uncategorized') return productCategoryId === null;
  return productCategoryId === categoryFilter;
};

const matchesSearchFilters = (product, status, categoryFilter) => (
  matchesStatus(product, status) && matchesCategory(product, categoryFilter)
);

const appendUnique = (target, products, takenIds, status, limit, categoryFilter) => {
  for (const product of products) {
    if (target.length >= limit) break;
    if (!product || takenIds.has(product.id) || !matchesSearchFilters(product, status, categoryFilter)) {
      continue;
    }

    takenIds.add(product.id);
    target.push(product);
  }
};

const queryPrefix = (productTable, indexName, term, limit, status, categoryFilter) =>
  productTable
    .where(indexName)
    .startsWith(term)
    .filter((product) => matchesSearchFilters(product, status, categoryFilter))
    .limit(limit)
    .toArray();

const findSubstringCandidateIds = async (productTable, normalizedTerm) => {
  const ngrams = buildSearchNgrams(normalizedTerm);
  if (ngrams.length === 0) return [];

  const keyGroups = await Promise.all(
    ngrams.map((ngram) =>
      productTable.where('search_ngrams').equals(ngram).primaryKeys()
    )
  );

  keyGroups.sort((left, right) => left.length - right.length);
  if (keyGroups[0].length === 0) return [];

  let candidateIds = new Set(keyGroups[0]);
  for (const keys of keyGroups.slice(1)) {
    const currentKeys = new Set(keys);
    candidateIds = new Set(
      [...candidateIds].filter((primaryKey) => currentKeys.has(primaryKey))
    );
    if (candidateIds.size === 0) break;
  }

  return [...candidateIds];
};

const containsNormalizedTerm = (product, normalizedTerm) => {
  const name = normalizeProductSearchValue(product?.name_lower || product?.name);
  const barcode = normalizeProductSearchValue(
    product?.barcode_normalized || product?.barcode
  );
  const sku = normalizeProductSearchValue(
    product?.sku_normalized || product?.sku
  );

  return name.includes(normalizedTerm)
    || barcode.includes(normalizedTerm)
    || sku.includes(normalizedTerm);
};

export const searchProductsInTable = async (
  productTable,
  searchTerm,
  status = 'active',
  limit = DEFAULT_SEARCH_LIMIT,
  categoryFilter = null
) => {
  const normalizedTerm = normalizeProductSearchValue(searchTerm);
  if (!normalizedTerm) return [];

  const exactBarcode = await productTable
    .where('barcode_normalized')
    .equals(normalizedTerm)
    .first();

  if (exactBarcode && matchesSearchFilters(exactBarcode, status, categoryFilter)) {
    return [exactBarcode];
  }

  const exactSku = await productTable
    .where('sku_normalized')
    .equals(normalizedTerm)
    .first();

  if (exactSku && matchesSearchFilters(exactSku, status, categoryFilter)) {
    return [exactSku];
  }

  const prefixGroups = await Promise.all([
    queryPrefix(productTable, 'name_lower', normalizedTerm, limit, status, categoryFilter),
    queryPrefix(productTable, 'search_tokens', normalizedTerm, limit, status, categoryFilter),
    queryPrefix(productTable, 'barcode_normalized', normalizedTerm, limit, status, categoryFilter),
    queryPrefix(productTable, 'sku_normalized', normalizedTerm, limit, status, categoryFilter)
  ]);

  const results = [];
  const takenIds = new Set();
  for (const products of prefixGroups) {
    appendUnique(results, products, takenIds, status, limit, categoryFilter);
  }

  if (results.length >= limit || normalizedTerm.length < 3) {
    return results;
  }

  const candidateIds = await findSubstringCandidateIds(productTable, normalizedTerm);
  const candidates = candidateIds.length > 0
    ? await productTable.bulkGet(candidateIds)
    : [];
  const substringMatches = candidates.filter((product) =>
    containsNormalizedTerm(product, normalizedTerm)
  );

  appendUnique(results, substringMatches, takenIds, status, limit, categoryFilter);
  return results;
};
