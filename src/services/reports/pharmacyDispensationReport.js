// Reporte auxiliar a partir de snapshots de ventas, sin enriquecer con catálogo actual.
const INVALID = /^(?:n\s*\/?\s*a|no aplica|no disponible|sin dato(?:s)?|desconocid[oa]|null|undefined|[-–—]+)$/i;
const clean = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  return text && !INVALID.test(text) ? text : '';
};
const first = (...values) => values.map(clean).find(Boolean) || '';
const normalize = value => clean(value).toLowerCase();
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const bool = value => {
  if (value === true || value === 1 || /^(true|1|si|sí|yes)$/i.test(String(value ?? '').trim())) return true;
  if (value === false || value === 0 || /^(false|0|no)$/i.test(String(value ?? '').trim())) return false;
  return null;
};

export const PHARMACY_REPORT_HEADERS = Object.freeze([
  'Fecha venta UTC', 'Hora venta UTC', 'Folio operativo o ID', 'ID venta',
  'ID producto', 'Medicamento', 'Sustancia activa histórica', 'Cantidad',
  'Tipo prescripción histórico', 'Requiere receta (histórico)',
  'Médico', 'Cédula profesional', 'Referencia o notas de receta',
  'Estado venta', 'Situación del registro', 'Estado información', 'Observaciones',
  'Generado UTC', 'Periodo inicial UTC', 'Periodo final UTC',
  'Fuente', 'Filas exportadas', 'Filas con incidencias'
]);

const getSaleState = sale => {
  const status = normalize(sale.status ?? sale.sale_status);
  const fulfillment = normalize(sale.fulfillmentStatus ?? sale.fulfillment_status);
  if (['cancelled', 'canceled'].includes(status)
    || ['cancelled', 'canceled'].includes(fulfillment)
    || sale.cancelledAt || sale.cancelled_at || sale.cancellationId || sale.cancellation_id) {
    return { state: 'ANULADA', situation: 'NO VIGENTE', issue: 'Venta anulada: no contar como dispensación vigente' };
  }
  if (['closed', 'completed'].includes(status)) {
    return { state: 'CERRADA', situation: 'REGISTRO DE VENTA', issue: '' };
  }
  return { state: status || 'SIN ESTADO', situation: 'PENDIENTE DE REVISIÓN',
    issue: 'Estado de venta no concluyente; no confirmar dispensación' };
};

const getDate = sale => {
  const date = new Date(sale.timestamp ?? sale.createdAt ?? sale.created_at ?? '');
  if (!Number.isFinite(date.getTime())) {
    return { day: '', time: '', iso: '', issue: 'Fecha de venta ausente o inválida' };
  }
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 19), iso, issue: '' };
};

const classify = item => {
  const type = normalize(item.prescriptionType ?? item.prescription_type);
  const flag = bool(item.requiresPrescription ?? item.requires_prescription);
  const recognized = type === 'antibiotic' || type === 'controlled';
  const unknown = Boolean(type && type !== 'otc' && !recognized);
  return { type, flag, unknown, identifiable: flag === true || recognized || unknown };
};

const getPrescription = sale => {
  const details = record(sale.prescriptionDetails) ? sale.prescriptionDetails
    : (record(sale.prescription_details) ? sale.prescription_details : {});
  const doctor = first(details.doctorName, details.doctor_name);
  const license = first(details.licenseNumber, details.license_number);
  const notes = first(details.notes, details.reference, details.prescriptionReference, details.prescription_reference);
  return { doctor, license, notes, hasClue: Boolean(doctor || license || notes) };
};

const getFolio = sale => first(
  sale.posFolio, sale.pos_folio, sale.operationalFolio, sale.operational_folio,
  sale.folio, sale.localFolio, sale.local_folio, sale.cloudFolio, sale.cloud_folio
);

const buildLine = ({ sale, item, classification, dates, state, rx, unassigned = false }) => {
  const issues = [dates.issue, state.issue].filter(Boolean);
  const folio = getFolio(sale);
  const id = first(sale.id, sale.saleId, sale.sale_id);
  if (!folio) issues.push('Folio operativo ausente; se muestra ID de venta cuando existe');
  if (!id) issues.push('ID de venta ausente; sin referencia estable verificable');

  const substance = unassigned ? '' : first(item.activeSubstance, item.active_substance, item.sustancia);
  const name = unassigned ? '' : first(item.name, item.productName, item.product_name);
  const productId = unassigned ? '' : first(item.parentId, item.productId, item.product_id, item.id);
  const rawQty = unassigned ? null : item.quantity;
  const quantity = rawQty === null || rawQty === undefined || rawQty === '' ? null : Number(rawQty);
  if (unassigned) {
    issues.push('Datos de receta en la venta sin línea de medicamento atribuible de forma fiable');
  } else {
    if (!name) issues.push('Nombre histórico del medicamento ausente');
    if (!substance) issues.push('Sustancia activa no preservada en la venta');
    if (!Number.isFinite(quantity) || quantity <= 0) issues.push('Cantidad histórica ausente o inválida');
    if (classification.unknown) issues.push('Tipo histórico no reconocido; confirmar clasificación');
    if (classification.type === 'antibiotic' && classification.flag === false) {
      issues.push('Antibiótico marcado como no requiere receta');
    }
    if (classification.type === 'otc' && classification.flag === true) {
      issues.push('Tipo venta libre contradice bandera de receta');
    }
    if (!rx.doctor) issues.push('Nombre del médico ausente');
    if (!rx.license) issues.push('Cédula profesional ausente');
  }
  return [
    dates.day, dates.time, folio || id, id, productId, name, substance,
    Number.isFinite(quantity) && quantity > 0 ? quantity : '',
    unassigned ? '' : classification.type,
    unassigned ? 'DESCONOCIDO' : (classification.flag === null ? 'DESCONOCIDO' : (classification.flag ? 'SI' : 'NO')),
    rx.doctor, rx.license, rx.notes, state.state, state.situation,
    issues.length ? 'REVISAR' : 'SIN INCIDENCIAS DETECTADAS', issues.join(' | ')
  ];
};

/**
 * Una fila por línea identificable. Si sólo hay receta a nivel venta, una
 * fila de revisión sin atribuir el documento a un medicamento concreto.
 */
export const buildPharmacyDispensationRows = (sales, { generatedAt = new Date() } = {}) => {
  const records = [];
  const times = [];
  for (const sale of (Array.isArray(sales) ? sales : [])) {
    if (!record(sale)) continue;
    const rx = getPrescription(sale);
    const state = getSaleState(sale);
    const dates = getDate(sale);
    const matching = (Array.isArray(sale.items) ? sale.items : [])
      .filter(record)
      .map(item => ({ item, classification: classify(item) }))
      .filter(entry => entry.classification.identifiable);
    if (!matching.length && !rx.hasClue) continue;
    if (dates.iso) times.push(dates.iso);
    if (!matching.length) {
      records.push(buildLine({ sale, item: {}, classification: {}, dates, state, rx, unassigned: true }));
    } else {
      for (const entry of matching) records.push(buildLine({ sale, ...entry, dates, state, rx }));
    }
  }
  times.sort();
  const generation = new Date(generatedAt);
  const generatedIso = Number.isFinite(generation.getTime()) ? generation.toISOString() : '';
  const issueRows = records.filter(row => row[15] === 'REVISAR').length;
  const activeRows = records.filter(row => row[14] === 'REGISTRO DE VENTA').length;
  const periodStart = times[0] || '';
  const periodEnd = times[times.length - 1] || '';
  const origin = 'IndexedDB local de este dispositivo; no consolidado PRO/Nube';
  const rows = records.map(row => [
    ...row, generatedIso, periodStart, periodEnd, origin, records.length, issueRows
  ]);
  return { headers: PHARMACY_REPORT_HEADERS, rows, count: records.length, issueRows,
    activeRows, periodStart, periodEnd, origin };
};
