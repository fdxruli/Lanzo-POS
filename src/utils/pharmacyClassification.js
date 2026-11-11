// Clasificación de catálogo (LGS art. 226). No autoriza dispensación.
export const SANITARY_FRACTIONS = Object.freeze([
  { value: 'I', label: 'I · Receta o permiso especial' },
  { value: 'II', label: 'II · Receta retenida y libro de control' },
  { value: 'III', label: 'III · Receta y control de surtidos' },
  { value: 'IV', label: 'IV · Receta médica ordinaria' },
  { value: 'V', label: 'V · Sin receta, solo en farmacias' },
  { value: 'VI', label: 'VI · Sin receta, venta general' }
]);
const VALID = new Set(SANITARY_FRACTIONS.map(({ value }) => value));
const SPECIAL = new Set(['I', 'II', 'III']);
const record = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const getPharmacyClassification = (product = {}) => {
  const saved = record(product.metadata?.pharmacy)
    ? product.metadata.pharmacy
    : (record(product.pharmacy) ? product.pharmacy : null);
  const fraction = VALID.has(saved?.fraction) ? saved.fraction : '';
  const confirmed = saved?.status === 'confirmed' && Boolean(fraction);
  return {
    recorded: Boolean(saved),
    kind: saved?.kind === 'other' ? 'other' : 'medicine',
    fraction,
    status: confirmed ? 'confirmed' : 'pending',
    antibiotic: saved ? saved.antibiotic === true : product.prescriptionType === 'antibiotic',
    concentration: String(saved?.concentration || ''),
    dosageForm: String(saved?.dosageForm || ''),
    sanitaryRegistration: String(saved?.sanitaryRegistration || '')
  };
};

export const isSpecialPharmacyProduct = (product = {}) => {
  const classification = getPharmacyClassification(product);
  return classification.kind === 'medicine'
    && classification.status === 'confirmed'
    && SPECIAL.has(classification.fraction);
};

export const pharmacyLegacyIndicators = (product = {}) => {
  const pharma = getPharmacyClassification(product);
  if (pharma.recorded && pharma.kind === 'other') return { prescriptionType: 'otc', requiresPrescription: false };
  if (pharma.status === 'confirmed') {
    const requiresPrescription = ['I', 'II', 'III', 'IV'].includes(pharma.fraction) || pharma.antibiotic;
    // IV ordinaria: null/undefined en el contrato legacy, con bandera de receta true.
    // Evita introducir un cuarto enum que rompa clientes anteriores.
    const prescriptionType = SPECIAL.has(pharma.fraction) ? 'controlled'
      : pharma.antibiotic ? 'antibiotic'
        : requiresPrescription ? undefined : 'otc';
    return { prescriptionType, requiresPrescription };
  }
  // No inferir fracciones históricas. Nunca eliminar una restricción heredada.
  const legacyType = product.prescriptionType || product.prescription_type;
  const flag = product.requiresPrescription ?? product.requires_prescription;
  return {
    prescriptionType: legacyType || undefined,
    requiresPrescription: flag === true || Boolean(legacyType && legacyType !== 'otc')
      ? true : (flag === false ? false : undefined)
  };
};

export const hasChangedConfirmedClassification = (before = {}, after = {}) => {
  const old = getPharmacyClassification(before);
  const next = getPharmacyClassification(after);
  return old.recorded && old.status === 'confirmed' && (
    next.kind !== old.kind || next.status !== 'confirmed'
    || next.fraction !== old.fraction || next.antibiotic !== old.antibiotic
  );
};
