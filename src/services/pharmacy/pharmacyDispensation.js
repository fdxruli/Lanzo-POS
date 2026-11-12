import { getPharmacyClassification } from '../../utils/pharmacyClassification';

// Contrato compartido por la interfaz, la venta Local y el payload Cloud.
// No interpreta estos campos como una cédula profesional verificada.
export const pharmacyPrescriptionRequirement = (product = {}) => {
  const pharma = getPharmacyClassification(product);
  const legacy = product.requiresPrescription === true || product.requires_prescription === true
    || Boolean(product.prescriptionType && product.prescriptionType !== 'otc')
    || Boolean(product.prescription_type && product.prescription_type !== 'otc');
  const forbidden = pharma.kind === 'medicine' && ['I', 'II', 'III'].includes(pharma.fraction);
  const pending = pharma.recorded && pharma.kind === 'medicine' && pharma.status !== 'confirmed';
  const required = pharma.kind === 'medicine' && (
    pharma.antibiotic || pharma.fraction === 'IV' || legacy
  );
  return { forbidden, pending, required, antibiotic: pharma.antibiotic || product.prescriptionType === 'antibiotic' };
};

const requiredText = (value, min, max, field) => {
  const normalized = String(value ?? '').trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error('PHARMACY_RX_INVALID_' + field);
  }
  return normalized;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const validatePharmacyLine = (raw, quantity, { antibiotic = false } = {}) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('PHARMACY_PRESCRIPTION_REQUIRED');
  }
  const prescribedQuantity = Number(raw.prescribedQuantity);
  const soldQuantity = Number(quantity);
  if (!Number.isFinite(prescribedQuantity) || prescribedQuantity <= 0 ||
      !Number.isFinite(soldQuantity) || soldQuantity <= 0 ||
      soldQuantity > prescribedQuantity ||
      Math.abs(Math.round(prescribedQuantity * 1000) - prescribedQuantity * 1000) > 1e-7) {
    throw new Error('PHARMACY_PRESCRIPTION_QUANTITY_INVALID');
  }
  const issuedOn = requiredText(raw.issuedOn, 10, 10, 'ISSUED_ON');
  const treatmentUntil = requiredText(raw.treatmentUntil, 10, 10, 'TREATMENT_UNTIL');
  const validDay = (day) => DATE_RE.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Merida', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  if (!validDay(issuedOn) || !validDay(treatmentUntil) ||
      treatmentUntil < issuedOn || issuedOn > today || treatmentUntil < today) {
    throw new Error('PHARMACY_PRESCRIPTION_DATES_INVALID');
  }
  if (antibiotic && raw.stampDeclared !== true) {
    throw new Error('PHARMACY_PRESCRIPTION_STAMP_REQUIRED');
  }
  return {
    version: 1,
    reference: requiredText(raw.reference, 2, 100, 'REFERENCE'),
    prescriberName: requiredText(raw.prescriberName, 3, 180, 'PRESCRIBER'),
    prescriberLicense: requiredText(raw.prescriberLicense, 4, 40, 'LICENSE'),
    prescriberAddress: requiredText(raw.prescriberAddress, 6, 240, 'ADDRESS'),
    issuedOn,
    treatmentUntil,
    prescribedQuantity,
    stampDeclared: raw.stampDeclared === true,
    retentionDeclared: raw.retentionDeclared === true
  };
};

export const prescriptionDocumentKey = (rx) => [
  String(rx?.reference || '').trim().toUpperCase(),
  String(rx?.prescriberLicense || '').trim(),
  String(rx?.issuedOn || '').trim()
].join('|');

export const attachPharmacyDispensations = (processedItems, productMap, form, features) => {
  if (!features?.hasLabFields) return processedItems;
  return processedItems.map((item, index) => {
    const product = productMap.get(item.parentId || item.productId || item.id) || item;
    const policy = pharmacyPrescriptionRequirement(product);
    if (policy.forbidden) throw new Error('PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN');
    if (policy.pending) throw new Error('PHARMACY_CLASSIFICATION_PENDING');
    if (!policy.required) return item;
    const raw = form?.lines?.[index];
    const rx = validatePharmacyLine(raw, item.quantity, policy);
    return { ...item, pharmacyDispensationV1: rx };
  });
};

// Se ejecuta DENTRO de la transacción Dexie que guarda venta, stock y caja.
// Las ventas anteriores siguen como evidencia; no se fabrican surtidos retroactivos.
export const validateLocalPharmacyDispensations = async (sale, salesTable) => {
  const incoming = (sale.items || []).filter(item => item.pharmacyDispensationV1);
  if (incoming.length === 0) return;
  for (const item of incoming) {
    const assignedBatches = Array.isArray(item.batchesUsed) ? item.batchesUsed : [];
    const hasLot = Boolean(item.batchId || item.batch_id || assignedBatches.some(batch => batch.batchId || batch.id));
    if (!hasLot) throw new Error('PHARMACY_DISPENSATION_BATCH_REQUIRED');
  }
  const history = await salesTable.toArray();
  const counts = new Map();
  const authorized = new Map();
  const retainedDocs = new Set();

  for (const previous of history) {
    if (previous.id === sale.id || !['closed', 'cancelled', 'canceled', 'requires_review'].includes(previous.status)) continue;
    for (const item of previous.items || []) {
      const rx = item.pharmacyDispensationV1;
      if (!rx?.reference) continue;
      const doc = prescriptionDocumentKey(rx);
      const key = doc + '|' + String(item.parentId || item.productId || item.id || '');
      const qty = Number(item.quantity);
      if (!(qty > 0)) continue;
      counts.set(key, (counts.get(key) || 0) + qty);
      if (authorized.has(key) && authorized.get(key) !== Number(rx.prescribedQuantity)) {
        throw new Error('PHARMACY_PRESCRIPTION_HISTORY_CONFLICT');
      }
      authorized.set(key, Number(rx.prescribedQuantity));
      if (rx.retentionDeclared === true) retainedDocs.add(doc);
    }
  }

  const currentTotals = new Map();
  for (const item of incoming) {
    const rx = item.pharmacyDispensationV1;
    const doc = prescriptionDocumentKey(rx);
    const key = doc + '|' + String(item.parentId || item.productId || item.id || '');
    if (retainedDocs.has(doc)) throw new Error('PHARMACY_PRESCRIPTION_ALREADY_RETAINED');
    const prescribed = Number(rx.prescribedQuantity);
    if (authorized.has(key) && authorized.get(key) !== prescribed) {
      throw new Error('PHARMACY_PRESCRIPTION_QUANTITY_CONFLICT');
    }
    if (currentTotals.has(key) && currentTotals.get(key).prescribed !== prescribed) {
      throw new Error('PHARMACY_PRESCRIPTION_QUANTITY_CONFLICT');
    }
    const used = (counts.get(key) || 0) + (currentTotals.get(key)?.used || 0) + Number(item.quantity);
    if (used > prescribed) throw new Error('PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED');
    currentTotals.set(key, { prescribed, used });
    if (rx.stampDeclared && used === prescribed && !rx.retentionDeclared) {
      throw new Error('PHARMACY_PRESCRIPTION_RETENTION_REQUIRED');
    }
  }
};
