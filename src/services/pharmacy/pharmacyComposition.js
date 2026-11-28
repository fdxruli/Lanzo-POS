import { normalizePharmacyBaseUnit, normalizePharmacyMeasureUnit } from './pharmacyCatalog';
import { normalizeNameKey } from '../products/productMapper';

export const PHARMACY_COMPOSITION_VERSION = 1;

const text = (value) => String(value ?? '').trim();
const positiveDecimal = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Persistent active_ingredients.name_key must match F01's server normalizer.
export const normalizeActiveIngredientIdentityKey = (name) => normalizeNameKey(name);

// This key is only for local equivalence search and composition validation.
export const normalizeActiveIngredientEquivalenceKey = (name) => text(name)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/gu, '')
  .toLowerCase()
  .replace(/\s+/gu, ' ')
  .trim();

export const normalizePharmacyComposition = (composition) => {
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)) return null;
  if (Number(composition.version ?? composition.schemaVersion) !== PHARMACY_COMPOSITION_VERSION) return null;
  const items = Array.isArray(composition.activeIngredients) ? composition.activeIngredients : null;
  if (!items?.length) return null;

  const activeIngredients = items.map((item) => {
    const amount = positiveDecimal(item?.amount);
    const basisAmount = positiveDecimal(item?.basisAmount);
    const activeIngredientId = text(item?.activeIngredientId ?? item?.id);
    const name = text(item?.name ?? item?.activeIngredientName);
    const unitText = text(item?.unit);
    const basisUnitText = text(item?.basisUnit);
    // Normalize explicit, unambiguous aliases only. Unknown historical labels
    // stay readable and round-trip unchanged until an operator edits them.
    const unit = normalizePharmacyMeasureUnit(unitText) || unitText;
    const basisUnit = normalizePharmacyBaseUnit(basisUnitText) || basisUnitText;
    if (!activeIngredientId || !name || !amount || !basisAmount || !unit || !basisUnit) return null;
    return { activeIngredientId, name, amount, unit, basisAmount, basisUnit };
  });
  if (activeIngredients.some((item) => !item)) return null;
  if (new Set(activeIngredients.map((item) => item.activeIngredientId)).size !== activeIngredients.length) return null;

  return { version: PHARMACY_COMPOSITION_VERSION, activeIngredients };
};

export const formatCompositionActiveSubstance = (composition) => {
  const normalized = normalizePharmacyComposition(composition);
  return normalized?.activeIngredients.map(({ name }) => name).join(', ') || '';
};

const formatDecimal = (value) => String(Number(value));

export const formatCompositionConcentration = (composition) => {
  const normalized = normalizePharmacyComposition(composition);
  if (!normalized) return '';
  return normalized.activeIngredients.map(({ amount, unit, basisAmount, basisUnit }) => {
    const base = basisAmount === 1 ? basisUnit : `${formatDecimal(basisAmount)} ${basisUnit}`;
    return `${formatDecimal(amount)} ${unit} por ${base}`;
  }).join('; ');
};

export const getCompositionRows = (product = {}) => {
  const pharmacy = product.metadata?.pharmacy || product.pharmacy || {};
  const composition = normalizePharmacyComposition(pharmacy.composition);
  return composition?.activeIngredients || [];
};
