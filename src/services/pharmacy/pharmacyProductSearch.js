import { normalizeProductSearchValue } from '../db/productSearchIndex';
import {
  formatCompositionActiveSubstance,
  formatCompositionConcentration,
  normalizePharmacyComposition
} from './pharmacyComposition';
import {
  formatPharmacyCommercialPresentation,
  getPharmacyDosageFormLabel,
  PHARMACY_DOSAGE_FORMS
} from './pharmacyCatalog';

export const EMPTY_PHARMACY_SEARCH_FILTERS = Object.freeze({
  dosageFormCode: '',
  concentration: '',
  presentation: ''
});

const QUERY_STOPWORDS = new Set(['and', 'con', 'de', 'del', 'el', 'la', 'las', 'los', 'por', 'y']);
const NUMERIC_QUERY_TOKEN = /^\d+(?:\.\d*)?$/;
const PHARMACY_MEASURE_UNITS = new Set(['mg', 'mcg', 'ug', 'g', 'ml', 'l', 'ui', 'iu', 'meq', 'mmol', 'mol', 'ufc']);

const normalizeNumericToken = (token) => {
  const [integerPart, decimalPart = ''] = token.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const fraction = decimalPart.replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
};

const getNumericTokens = (value) => normalizePharmacySearchValue(value).match(/\d+(?:\.\d+)?/g) || [];

const matchesSearchToken = (value, token) => {
  const normalizedValue = normalizePharmacySearchValue(value);
  if (!NUMERIC_QUERY_TOKEN.test(token)) return normalizedValue.includes(token);
  const normalizedToken = normalizeNumericToken(token);
  return getNumericTokens(normalizedValue).some((candidate) => (
    normalizeNumericToken(candidate) === normalizedToken
  ));
};

const expandNumericUnitToken = (token) => {
  const match = token.match(/^(\d+(?:\.\d*)?)(mcg|mmol|meq|mg|ug|ui|iu|ml|g|l|mol|ufc)$/);
  return match ? [match[1], match[2]] : [token];
};

const getNumericUnitPairs = (tokens) => tokens.flatMap((token, index) => (
  NUMERIC_QUERY_TOKEN.test(token) && PHARMACY_MEASURE_UNITS.has(tokens[index + 1])
    ? [[token, tokens[index + 1]]]
    : []
));

const matchesNumericUnitPair = (value, [amount, unit]) => {
  const normalizedValue = normalizePharmacySearchValue(value);
  const normalizedAmount = normalizeNumericToken(amount);
  return [...normalizedValue.matchAll(/\d+(?:\.\d+)?/g)].some((match) => {
    if (normalizeNumericToken(match[0]) !== normalizedAmount) return false;
    const nextToken = normalizedValue.slice(match.index + match[0].length).match(/^\s*([a-z]+)\b/);
    return nextToken?.[1] === unit;
  });
};

export const normalizePharmacySearchValue = (value) => normalizeProductSearchValue(value)
  .replace(/[µμ]/g, 'u');

const queryTokensFor = (value) => normalizePharmacySearchValue(value)
  .replace(/[+,;|/]+/g, ' ')
  .split(/[^a-z0-9.]+/)
  .filter((token) => token && !QUERY_STOPWORDS.has(token));

const getPharmacyMetadata = (product = {}) => (
  product?.metadata?.pharmacy || product?.pharmacy || {}
);

const getNormalizedComposition = (product = {}) => (
  normalizePharmacyComposition(getPharmacyMetadata(product).composition)
);

const getLegacyActiveSubstanceValues = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  return [
    product?.activeSubstance,
    product?.active_substance,
    product?.sustancia,
    pharmacy?.activeSubstance,
    pharmacy?.active_substance
  ].filter((value) => typeof value === 'string' && value.trim());
};

const getConcentrationValues = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  const composition = getNormalizedComposition(product);
  const structured = composition && formatCompositionConcentration(composition);
  if (structured) return [structured];
  return [
    pharmacy?.concentration,
    product?.concentration
  ].filter((value) => typeof value === 'string' && value.trim());
};

const getDosageFormValues = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  const code = pharmacy?.dosageFormCode || product?.dosageFormCode || product?.dosage_form_code;
  return [
    code,
    code ? getPharmacyDosageFormLabel(code) : '',
    pharmacy?.dosageForm,
    pharmacy?.dosageFormLegacy,
    pharmacy?.dosage_form,
    product?.dosageForm,
    product?.dosage_form
  ].filter((value) => typeof value === 'string' && value.trim());
};

const getPresentationValues = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  const structured = pharmacy?.commercialPresentation;
  const structuredPresentation = formatPharmacyCommercialPresentation(structured);
  if (structuredPresentation) return [structuredPresentation];
  return [
    structured?.legacyDescription,
    pharmacy?.commercialPresentationText,
    product?.presentation,
    product?.commercialPresentation
  ].filter((value) => typeof value === 'string' && value.trim());
};

const getSearchableValues = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  const composition = getNormalizedComposition(product);
  return [
    product?.name,
    product?.barcode,
    product?.sku,
    composition ? formatCompositionActiveSubstance(composition) : '',
    composition && composition.activeIngredients.map((item) => item.name).join(' '),
    ...getLegacyActiveSubstanceValues(product),
    ...getConcentrationValues(product),
    ...getDosageFormValues(product),
    ...getPresentationValues(product),
    pharmacy?.sanitaryRegistration,
    product?.laboratory,
    product?.laboratorio
  ].filter((value) => typeof value === 'string' && value.trim())
    .map(normalizePharmacySearchValue);
};

const getCompositionIds = (composition) => new Set(
  (composition?.activeIngredients || [])
    .map((item) => String(item.activeIngredientId || '').trim())
    .filter(Boolean)
);

const buildIngredientQueryGroups = (queryTokens, activeIngredients) => queryTokens
  .filter((queryToken) => queryToken.length >= 3)
  .map((queryToken) => activeIngredients
    .filter((ingredient) => {
      const nameTokens = queryTokensFor(ingredient?.name);
      return nameTokens.some((nameToken) => nameToken === queryToken || nameToken.startsWith(queryToken));
    })
    .filter((ingredient) => String(ingredient?.id || '').trim()))
  .filter((group) => group.length > 0)
  .map((group) => ({
    ids: new Set(group.map((ingredient) => String(ingredient.id).trim())),
    names: group.map((ingredient) => normalizePharmacySearchValue(ingredient.name)).filter(Boolean)
  }));

export const createPharmacySearchContext = async (searchTerm) => {
  const queryTokens = queryTokensFor(searchTerm);
  if (!queryTokens.length) return { queryTokens, ingredientGroups: [] };

  let activeIngredients = [];
  try {
    // Load the tenant-scoped repository on demand. Its cloud adapter reaches
    // the database facade, so an eager import here creates a startup cycle.
    const { activeIngredientRepository } = await import('./activeIngredientRepository');
    activeIngredients = await activeIngredientRepository.list();
  } catch {
    // Name and legacy-field search still work if the local ingredient catalogue
    // is temporarily unavailable. No historical identity is inferred here.
    activeIngredients = [];
  }

  return {
    queryTokens,
    ingredientGroups: buildIngredientQueryGroups(queryTokens, activeIngredients)
  };
};

const includesEveryQueryToken = (values, queryTokens) => {
  const tokens = queryTokens.flatMap(expandNumericUnitToken);
  if (!tokens.every((queryToken) => values.some((value) => matchesSearchToken(value, queryToken)))) {
    return false;
  }
  return getNumericUnitPairs(tokens).every((pair) => (
    values.some((value) => matchesNumericUnitPair(value, pair))
  ));
};

const containsWholePhrase = (haystack, phrase) => {
  const index = haystack.indexOf(phrase);
  if (index < 0) return false;
  const isWordCharacter = (character) => Boolean(character && /[a-z0-9]/.test(character));
  return !isWordCharacter(haystack[index - 1])
    && !isWordCharacter(haystack[index + phrase.length]);
};

export const matchesPharmacySearchQuery = (product, context) => {
  if (!context?.queryTokens?.length) return true;
  const values = getSearchableValues(product);
  if (!includesEveryQueryToken(values, context.queryTokens)) return false;
  if (!context.ingredientGroups?.length) return true;

  const composition = getNormalizedComposition(product);
  if (composition) {
    const compositionIds = getCompositionIds(composition);
    return context.ingredientGroups.every((group) => (
      [...group.ids].some((id) => compositionIds.has(id))
    ));
  }

  // Historical free text remains searchable as written. Require the canonical
  // name from the tenant's ingredient catalogue; never assign an ID to it.
  const legacyText = [product?.name, ...getLegacyActiveSubstanceValues(product)]
    .filter((value) => typeof value === 'string' && value.trim())
    .map(normalizePharmacySearchValue);
  return context.ingredientGroups.every((group) => group.names.some((name) => (
    legacyText.some((value) => containsWholePhrase(value, name))
  )));
};

const includesFilter = (values, filter) => {
  const normalizedFilter = normalizePharmacySearchValue(filter);
  if (!normalizedFilter) return true;
  const filterTokens = queryTokensFor(normalizedFilter).flatMap(expandNumericUnitToken);
  if (!filterTokens.length) return true;
  return values.some((value) => (
    filterTokens.every((token) => matchesSearchToken(value, token))
    && getNumericUnitPairs(filterTokens).every((pair) => matchesNumericUnitPair(value, pair))
  ));
};

export const hasPharmacySearchFilters = (filters = EMPTY_PHARMACY_SEARCH_FILTERS) => (
  Boolean(String(filters?.dosageFormCode || '').trim())
  || Boolean(String(filters?.concentration || '').trim())
  || Boolean(String(filters?.presentation || '').trim())
);

export const matchesPharmacySearchFilters = (product, filters = EMPTY_PHARMACY_SEARCH_FILTERS) => {
  if (!hasPharmacySearchFilters(filters)) return true;
  const pharmacy = getPharmacyMetadata(product);

  if (filters.dosageFormCode) {
    const code = String(pharmacy?.dosageFormCode || product?.dosageFormCode || product?.dosage_form_code || '').trim();
    const selectedForm = PHARMACY_DOSAGE_FORMS.find(({ value }) => value === filters.dosageFormCode);
    const legacyForms = getDosageFormValues(product).map(normalizePharmacySearchValue);
    if (code) {
      if (code !== filters.dosageFormCode && !legacyForms.includes(normalizePharmacySearchValue(selectedForm?.label))) {
        return false;
      }
    } else if (!legacyForms.includes(normalizePharmacySearchValue(selectedForm?.label))) {
      return false;
    }
  }

  if (!includesFilter(getConcentrationValues(product), filters.concentration)) return false;
  if (!includesFilter(getPresentationValues(product), filters.presentation)) return false;
  return true;
};

export const getPharmacyProductSearchSummary = (product = {}) => {
  const pharmacy = getPharmacyMetadata(product);
  const composition = getNormalizedComposition(product);
  const activeSubstance = composition
    ? formatCompositionActiveSubstance(composition)
    : (getLegacyActiveSubstanceValues(product)[0] || '');
  const concentration = composition
    ? formatCompositionConcentration(composition)
    : (getConcentrationValues(product)[0] || '');
  const dosageForm = pharmacy?.dosageFormCode
    ? getPharmacyDosageFormLabel(pharmacy.dosageFormCode)
    : (getDosageFormValues(product)[0] || '');
  const presentation = formatPharmacyCommercialPresentation(pharmacy?.commercialPresentation)
    || getPresentationValues(product).find(Boolean)
    || '';

  return { activeSubstance, concentration, dosageForm, presentation };
};
