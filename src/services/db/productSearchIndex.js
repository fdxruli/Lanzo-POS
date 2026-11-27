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
  const pharmacy = product.metadata?.pharmacy || product.pharmacy || {};
  const composition = pharmacy.composition;
  const commercialPresentation = pharmacy.commercialPresentation;
  const pharmacyValues = [
    product.activeSubstance,
    product.active_substance,
    product.sustancia,
    product.concentration,
    product.dosageForm,
    product.dosage_form,
    product.presentation,
    pharmacy.activeSubstance,
    pharmacy.active_substance,
    pharmacy.concentration,
    pharmacy.dosageFormCode,
    pharmacy.dosageForm,
    pharmacy.dosageFormLegacy,
    commercialPresentation?.packageType,
    commercialPresentation?.contentAmount,
    commercialPresentation?.contentUnit,
    commercialPresentation?.legacyDescription,
    ...(Array.isArray(composition?.activeIngredients)
      ? composition.activeIngredients.flatMap((item) => [
        item?.name,
        item?.amount,
        item?.unit,
        item?.basisAmount,
        item?.basisUnit
      ])
      : [])
  ].filter((value) => value !== null && value !== undefined && String(value).trim());
  const searchableValues = [nameNormalized, barcodeNormalized, skuNormalized, ...pharmacyValues];
  const tokenValues = [nameNormalized, ...pharmacyValues];

  return {
    name_lower: nameNormalized,
    barcode_normalized: barcodeNormalized,
    sku_normalized: skuNormalized,
    search_tokens: [...new Set(tokenValues.flatMap(tokenize))],
    search_ngrams: [
      ...new Set(searchableValues.flatMap(buildSearchNgrams))
    ]
  };
};
