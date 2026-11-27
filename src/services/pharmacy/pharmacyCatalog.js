export const PHARMACY_MEASURE_UNITS = Object.freeze([
  { value: 'mg', label: 'mg — miligramo' },
  { value: 'g', label: 'g — gramo' },
  { value: 'µg', label: 'µg — microgramo' },
  { value: 'mL', label: 'mL — mililitro' },
  { value: 'L', label: 'L — litro' },
  { value: 'UI', label: 'UI — unidad internacional' },
  { value: '% m/m', label: '% m/m — porcentaje masa/masa' },
  { value: '% m/v', label: '% m/v — porcentaje masa/volumen' },
  { value: '% v/v', label: '% v/v — porcentaje volumen/volumen' },
  { value: 'mEq', label: 'mEq — miliequivalente' },
  { value: 'mmol', label: 'mmol — milimol' },
  { value: 'mol', label: 'mol — mol' },
  { value: 'UFC', label: 'UFC — unidad formadora de colonias' }
]);

export const PHARMACY_BASE_UNITS = Object.freeze([
  { value: 'tableta', label: 'tableta' },
  { value: 'cápsula', label: 'cápsula' },
  { value: 'mL', label: 'mL' },
  { value: 'g', label: 'g' },
  { value: 'dosis', label: 'dosis' },
  { value: 'gota', label: 'gota' },
  { value: 'disparo', label: 'disparo' },
  { value: 'aplicación', label: 'aplicación' },
  { value: 'sobre', label: 'sobre' },
  { value: 'ampolleta', label: 'ampolleta' },
  { value: 'vial', label: 'vial' },
  { value: 'unidad', label: 'unidad' }
]);

export const PHARMACY_DOSAGE_FORMS = Object.freeze([
  { value: 'tablet', label: 'Tableta' },
  { value: 'capsule', label: 'Cápsula' },
  { value: 'solution', label: 'Solución' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'cream', label: 'Crema' },
  { value: 'gel', label: 'Gel' },
  { value: 'drops', label: 'Gotas' },
  { value: 'powder', label: 'Polvo' },
  { value: 'injectable', label: 'Inyectable' },
  { value: 'syrup', label: 'Jarabe' },
  { value: 'ointment', label: 'Ungüento' },
  { value: 'spray', label: 'Aerosol' },
  { value: 'suppository', label: 'Supositorio' },
  { value: 'granules', label: 'Granulado' }
]);

export const PHARMACY_PACKAGE_TYPES = Object.freeze([
  { value: 'box', label: 'Caja' },
  { value: 'blister', label: 'Blíster' },
  { value: 'bottle', label: 'Frasco' },
  { value: 'tube', label: 'Tubo' },
  { value: 'sachet', label: 'Sobre' },
  { value: 'bag', label: 'Bolsa' },
  { value: 'vial', label: 'Vial' },
  { value: 'ampoule', label: 'Ampolleta' },
  { value: 'syringe', label: 'Jeringa' },
  { value: 'jar', label: 'Tarro' },
  { value: 'inhaler', label: 'Inhalador' },
  { value: 'spray', label: 'Aerosol' },
  { value: 'kit', label: 'Kit' }
]);

export const PHARMACY_PACKAGE_CONTENT_UNITS = Object.freeze([
  { value: 'tableta', label: 'tabletas' },
  { value: 'cápsula', label: 'cápsulas' },
  { value: 'mL', label: 'mL' },
  { value: 'g', label: 'g' },
  { value: 'dosis', label: 'dosis' },
  { value: 'gota', label: 'gotas' },
  { value: 'disparo', label: 'disparos' },
  { value: 'sobre', label: 'sobres' },
  { value: 'ampolleta', label: 'ampolletas' },
  { value: 'vial', label: 'viales' },
  { value: 'unidad', label: 'unidades' }
]);

const text = (value) => String(value ?? '').trim();
const keyOf = (value) => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const byValue = (items, value) => items.find((item) => item.value === value);

const measureAliases = new Map([
  ['mg', 'mg'], ['g', 'g'], ['µg', 'µg'], ['μg', 'µg'], ['mcg', 'µg'], ['ug', 'µg'],
  ['ml', 'mL'], ['l', 'L'], ['ui', 'UI'], ['iu', 'UI'], ['u.i.', 'UI'],
  ['% m/m', '% m/m'], ['%m/m', '% m/m'], ['% m/v', '% m/v'], ['%m/v', '% m/v'],
  ['% v/v', '% v/v'], ['%v/v', '% v/v'], ['meq', 'mEq'], ['mmol', 'mmol'],
  ['mol', 'mol'], ['ufc', 'UFC'], ['cfu', 'UFC']
]);

const baseAliases = new Map([
  ['tableta', 'tableta'], ['tablet', 'tableta'], ['tablets', 'tableta'], ['tab', 'tableta'],
  ['cápsula', 'cápsula'], ['capsula', 'cápsula'], ['capsule', 'cápsula'], ['cap', 'cápsula'],
  ['ml', 'mL'], ['g', 'g'], ['dosis', 'dosis'], ['dose', 'dosis'],
  ['gota', 'gota'], ['drop', 'gota'], ['disparo', 'disparo'], ['actuation', 'disparo'],
  ['aplicación', 'aplicación'], ['aplicacion', 'aplicación'], ['application', 'aplicación'],
  ['sobre', 'sobre'], ['sachet', 'sobre'], ['ampolleta', 'ampolleta'], ['ampoule', 'ampolleta'],
  ['vial', 'vial'], ['unidad', 'unidad'], ['unit', 'unidad']
]);

export const normalizePharmacyMeasureUnit = (value) => measureAliases.get(keyOf(value)) || '';
export const normalizePharmacyBaseUnit = (value) => baseAliases.get(keyOf(value)) || '';
export const isPharmacyMeasureCompatibleWithBase = (measureUnit, baseUnit) => {
  const unit = normalizePharmacyMeasureUnit(measureUnit);
  const base = normalizePharmacyBaseUnit(baseUnit);
  if (unit === '% m/m') return base === 'g';
  if (unit === '% m/v' || unit === '% v/v') return base === 'mL';
  return Boolean(unit && base);
};
export const normalizePharmacyDosageFormCode = (value) => {
  const code = text(value);
  return byValue(PHARMACY_DOSAGE_FORMS, code)?.value || '';
};

export const getPharmacyDosageFormLabel = (value) => (
  byValue(PHARMACY_DOSAGE_FORMS, normalizePharmacyDosageFormCode(value))?.label || ''
);

export const getDefaultPharmacyBaseUnit = (dosageFormCode) => ({
  tablet: 'tableta',
  capsule: 'cápsula',
  solution: 'mL',
  suspension: 'mL',
  cream: 'g',
  gel: 'g',
  drops: 'gota',
  injectable: 'mL',
  syrup: 'mL',
  ointment: 'g',
  spray: 'dosis'
}[normalizePharmacyDosageFormCode(dosageFormCode)] || '');

export const normalizePharmacyCommercialPresentation = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Number(value.version) !== 1) return null;
  const packageType = text(value.packageType);
  const contentAmount = Number(value.contentAmount);
  const contentUnit = normalizePharmacyBaseUnit(value.contentUnit);
  if (!byValue(PHARMACY_PACKAGE_TYPES, packageType)
      || !Number.isFinite(contentAmount) || contentAmount <= 0 || !contentUnit) return null;
  return { version: 1, packageType, contentAmount, contentUnit };
};

export const normalizePharmacyPackageType = (value) => {
  const packageType = text(value);
  return byValue(PHARMACY_PACKAGE_TYPES, packageType)?.value || '';
};

const formatAmount = (value) => String(Number(value));
const packageContentLabel = (amount, unit) => {
  const count = Number(amount);
  const singularLabels = {
    tableta: 'tableta', 'cápsula': 'cápsula', mL: 'mL', g: 'g', dosis: 'dosis',
    gota: 'gota', disparo: 'disparo', sobre: 'sobre', ampolleta: 'ampolleta', vial: 'vial', unidad: 'unidad'
  };
  const pluralLabels = {
    tableta: 'tabletas', 'cápsula': 'cápsulas', mL: 'mL', g: 'g', dosis: 'dosis',
    gota: 'gotas', disparo: 'disparos', sobre: 'sobres', ampolleta: 'ampolletas', vial: 'viales', unidad: 'unidades'
  };
  const label = (count === 1 ? singularLabels : pluralLabels)[unit]
    || byValue(PHARMACY_PACKAGE_CONTENT_UNITS, unit)?.label
    || unit;
  return `${formatAmount(count)} ${label}`;
};

export const formatPharmacyCommercialPresentation = (value) => {
  const normalized = normalizePharmacyCommercialPresentation(value);
  if (!normalized) return '';
  const packageLabel = byValue(PHARMACY_PACKAGE_TYPES, normalized.packageType)?.label;
  return `${packageLabel} con ${packageContentLabel(normalized.contentAmount, normalized.contentUnit)}`;
};
