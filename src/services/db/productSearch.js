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

const appendUnique = (target, products, takenIds, status, limit) => {
  for (const product of products) {
    if (target.length >= limit) break;
    if (!product || takenIds.has(product.id) || !matchesStatus(product, status)) {
      continue;
    }

    takenIds.add(product.id);
    target.push(product);
  }
};

const queryPrefix = (productTable, indexName, term, limit) =>
  productTable
    .where(indexName)
    .startsWith(term)
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
  limit = DEFAULT_SEARCH_LIMIT
) => {
  const normalizedTerm = normalizeProductSearchValue(searchTerm);
  if (!normalizedTerm) return [];

  const exactBarcode = await productTable
    .where('barcode_normalized')
    .equals(normalizedTerm)
    .first();

  if (exactBarcode && matchesStatus(exactBarcode, status)) {
    return [exactBarcode];
  }

  const exactSku = await productTable
    .where('sku_normalized')
    .equals(normalizedTerm)
    .first();

  if (exactSku && matchesStatus(exactSku, status)) {
    return [exactSku];
  }

  const prefixGroups = await Promise.all([
    queryPrefix(productTable, 'name_lower', normalizedTerm, limit),
    queryPrefix(productTable, 'search_tokens', normalizedTerm, limit),
    queryPrefix(productTable, 'barcode_normalized', normalizedTerm, limit),
    queryPrefix(productTable, 'sku_normalized', normalizedTerm, limit)
  ]);

  const results = [];
  const takenIds = new Set();
  for (const products of prefixGroups) {
    appendUnique(results, products, takenIds, status, limit);
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

  appendUnique(results, substringMatches, takenIds, status, limit);
  return results;
};
