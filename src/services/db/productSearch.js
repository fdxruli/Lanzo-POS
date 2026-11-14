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

/**
 * Indexed candidates are hydrated in bounded groups. Only products accepted by
 * both the synchronous predicate and optional async batch filter use the limit.
 * The batch filter must return a subset of its input, in the same order.
 */
export const searchProductsInTable = async (
  productTable,
  searchTerm,
  status = 'active',
  limit = DEFAULT_SEARCH_LIMIT,
  categoryFilter = null,
  { eligible = () => true, filterBatch = null } = {}
) => {
  const normalizedTerm = normalizeProductSearchValue(searchTerm);
  if (!normalizedTerm || limit <= 0) return [];

  const matches = (product) => product
    && matchesSearchFilters(product, status, categoryFilter)
    && eligible(product);
  const results = [];
  const visited = new Set();
  const accept = async (products) => {
    const candidates = products.filter((product) => {
      if (!product || visited.has(product.id)) return false;
      visited.add(product.id);
      return matches(product);
    });
    if (!candidates.length) return;
    const accepted = filterBatch ? await filterBatch(candidates) : candidates;
    results.push(...accepted.slice(0, limit - results.length));
  };

  // Preserve scanner/exact-code priority, but an excluded exact match must
  // not hide other eligible matches in the remaining index routes.
  for (const index of ['barcode_normalized', 'sku_normalized']) {
    const exact = await productTable.where(index).equals(normalizedTerm).filter(matches).toArray();
    for (let offset = 0; offset < exact.length; offset += DEFAULT_SEARCH_LIMIT) {
      await accept(exact.slice(offset, offset + DEFAULT_SEARCH_LIMIT));
      if (results.length) return results.slice(0, 1);
    }
  }

  const consumeIds = async (ids, substring = false) => {
    const unseenIds = [...new Set(ids)].filter((id) => !visited.has(id));
    for (let offset = 0; offset < unseenIds.length && results.length < limit; offset += DEFAULT_SEARCH_LIMIT) {
      const products = await productTable.bulkGet(unseenIds.slice(offset, offset + DEFAULT_SEARCH_LIMIT));
      await accept(substring
        ? products.filter((product) => product && containsNormalizedTerm(product, normalizedTerm))
        : products);
    }
  };

  for (const index of ['name_lower', 'search_tokens', 'barcode_normalized', 'sku_normalized']) {
    const collection = productTable.where(index).startsWith(normalizedTerm);
    if (filterBatch) {
      // Key-only indexed traversal avoids materializing all matching rows while
      // async eligibility is resolved in bounded, deduplicated batches below.
      await consumeIds(await collection.primaryKeys());
    } else {
      await accept(await collection
        .distinct()
        .filter((product) => !visited.has(product.id) && matches(product))
        .limit(limit - results.length)
        .toArray());
    }
    if (results.length >= limit) return results;
  }

  if (normalizedTerm.length >= 3) {
    await consumeIds(await findSubstringCandidateIds(productTable, normalizedTerm), true);
  }
  return results;
};
