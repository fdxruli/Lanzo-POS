const INTERNAL_CONFIGURATION_KEYS = new Set([
  'version',
  'configurationVersion',
  'configurationRevision',
  'configurationType',
  'pricing',
  'variant',
  'groups'
]);

const asObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const humanizeKey = (value) => {
  const text = asText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Opciones';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

const normalizeOption = (rawOption = {}) => {
  const option = asObject(rawOption);
  const name = asText(
    option.name
      || option.publicName
      || option.label
      || option.optionName
      || option.option_name
  );
  if (!name) return null;
  return {
    id: asText(option.id || option.optionId || option.option_id),
    name,
    priceDelta: Math.max(0, asNumber(
      option.priceDelta
        ?? option.price
        ?? option.extraPrice
        ?? option.extra_price,
      0
    ))
  };
};

const normalizeGroup = (rawGroup = {}, index = 0) => {
  const group = asObject(rawGroup);
  const options = asArray(group.options).map(normalizeOption).filter(Boolean);
  if (options.length === 0) return null;
  return {
    id: asText(group.id) || `group-${index}`,
    name: asText(group.name || group.publicName || group.label) || 'Opciones',
    selectionType: group.selectionType === 'multiple' ? 'multiple' : 'single',
    options
  };
};

const normalizeLegacyGroups = (source) => (
  Object.entries(source)
    .filter(([key, value]) => (
      !INTERNAL_CONFIGURATION_KEYS.has(key)
      && ['string', 'number', 'boolean'].includes(typeof value)
      && String(value).trim()
    ))
    .map(([key, value], index) => ({
      id: `legacy-${index}-${key}`,
      name: humanizeKey(key),
      selectionType: 'single',
      options: [{ id: '', name: String(value).trim(), priceDelta: 0 }]
    }))
);

export function normalizeEcommerceOrderConfiguration(rawOptions = {}) {
  const source = asObject(rawOptions);
  const rawVariant = asObject(source.variant);
  const variantName = asText(
    rawVariant.name
      || rawVariant.publicName
      || rawVariant.label
  );
  const groups = asArray(source.groups)
    .map(normalizeGroup)
    .filter(Boolean);

  return {
    variant: variantName
      ? {
          id: asText(rawVariant.id),
          name: variantName
        }
      : null,
    groups: groups.length > 0 ? groups : normalizeLegacyGroups(source)
  };
}

const formatPriceDelta = (value, currency = 'MXN') => {
  const amount = Math.max(0, asNumber(value, 0));
  if (amount <= 0) return '';
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: asText(currency).toUpperCase() || 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

export function formatEcommerceOrderConfigurationSummary(
  rawOptions = {},
  { currency = 'MXN' } = {}
) {
  const configuration = normalizeEcommerceOrderConfiguration(rawOptions);
  const segments = [];

  if (configuration.variant?.name) {
    segments.push(`Variante: ${configuration.variant.name}`);
  }

  configuration.groups.forEach((group) => {
    const optionLabels = group.options.map((option) => {
      const price = formatPriceDelta(option.priceDelta, currency);
      return price ? `${option.name} (+${price})` : option.name;
    });
    if (optionLabels.length > 0) {
      segments.push(`${group.name}: ${optionLabels.join(', ')}`);
    }
  });

  return segments.join(' · ');
}

export function buildEcommerceOrderDisplayName(
  productName,
  rawOptions = {},
  options = {}
) {
  const baseName = asText(productName) || 'Producto';
  const summary = formatEcommerceOrderConfigurationSummary(rawOptions, options);
  return summary ? `${baseName} — ${summary}` : baseName;
}

export const ecommerceOrderConfigurationDisplayInternals = Object.freeze({
  humanizeKey,
  normalizeOption,
  normalizeGroup,
  normalizeLegacyGroups,
  formatPriceDelta
});
