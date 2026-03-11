/**
 * @typedef {'restaurant' | 'pharmacy' | 'fruteria' | 'retail'} BatchRubroGroup
 */

const FEATURE_RUBRO_MAP = {
  food_service: 'food_service',
  restaurante: 'food_service',
  cafeteria: 'food_service',
  farmacia: 'farmacia',
  consultorio: 'farmacia',
  'verduleria/fruteria': 'verduleria/fruteria',
  verduleria: 'verduleria/fruteria',
  fruteria: 'verduleria/fruteria',
  abarrotes: 'abarrotes',
  apparel: 'apparel',
  hardware: 'hardware',
  papeleria: 'otro',
  otro: 'otro'
};

/**
 * Normaliza rubro para solicitar features por producto sin mezclar rubros.
 * @param {string | null | undefined} rubroContext
 * @returns {string}
 */
export function resolveFeatureRubroContext(rubroContext) {
  if (!rubroContext) return 'otro';
  const normalized = String(rubroContext).trim().toLowerCase();
  return FEATURE_RUBRO_MAP[normalized] || 'otro';
}

/**
 * @param {string | null | undefined} rubroContext
 * @returns {BatchRubroGroup}
 */
export function resolveBatchRubroGroup(rubroContext) {
  const featureRubro = resolveFeatureRubroContext(rubroContext);

  if (featureRubro === 'food_service') return 'restaurant';
  if (featureRubro === 'farmacia') return 'pharmacy';
  if (featureRubro === 'verduleria/fruteria') return 'fruteria';
  return 'retail';
}
