const MIN_NGRAM_LENGTH = 3;

export const normalizeProductSearchValue = (value) => {
  if (value === null || value === undefined) return '';

  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
};

const tokenize = (value) =>
  normalizeProductSearchValue(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export const buildSearchNgrams = (value) => {
  const normalizedValue = normalizeProductSearchValue(value);
  if (normalizedValue.length < MIN_NGRAM_LENGTH) return [];

  const ngrams = new Set();
  for (let index = 0; index <= normalizedValue.length - MIN_NGRAM_LENGTH; index += 1) {
    ngrams.add(normalizedValue.slice(index, index + MIN_NGRAM_LENGTH));
  }

  return [...ngrams];
};

export const buildProductSearchFields = (product = {}) => {
  const nameNormalized = normalizeProductSearchValue(
    product.name ?? product.name_lower
  );
  const barcodeNormalized = normalizeProductSearchValue(product.barcode);
  const skuNormalized = normalizeProductSearchValue(product.sku);

  return {
    name_lower: nameNormalized,
    barcode_normalized: barcodeNormalized,
    sku_normalized: skuNormalized,
    search_tokens: [...new Set(tokenize(nameNormalized))],
    search_ngrams: [
      ...new Set([
        ...buildSearchNgrams(nameNormalized),
        ...buildSearchNgrams(barcodeNormalized),
        ...buildSearchNgrams(skuNormalized)
      ])
    ]
  };
};
