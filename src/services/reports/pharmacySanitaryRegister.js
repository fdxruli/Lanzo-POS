import { db, STORES } from '../db/dexie';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { canReadSalesReports, canAuditSalesReports, getSalesActorIdentity } from '../auth/salesPermissionPolicy';
import { getPharmacyClassification } from '../../utils/pharmacyClassification';

export const SANITARY_PAGE_SIZE = 50;
export const SANITARY_EXPORT_LIMIT = 2000;
const MAX_LOCAL_ROWS_PER_STORE = 3000;
const VALID_MOVEMENTS = new Set(['receipt', 'dispensation', 'waste', 'return', 'adjustment', 'other']);
const VALID_TRACES = new Set(['complete', 'incomplete', 'limited']);
const identity = (value) => String(value ?? '').trim();
const ts = (value) => {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
};

export const sanitaryFilters = ({ from, to, search = '', movementType = '', batchId = '', traceStatus = '' }) => {
  const start = new Date(String(from) + 'T00:00:00');
  const end = new Date(String(to) + 'T00:00:00');
  end.setDate(end.getDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
      || end <= start || end - start > 93 * 86400000 || search.trim().length > 120) {
    throw new Error('Selecciona un periodo válido de hasta 92 días.');
  }
  return {
    dateFrom: start.toISOString(), dateTo: end.toISOString(),
    search: search.trim().toLowerCase(), movementType: VALID_MOVEMENTS.has(movementType) ? movementType : '',
    batchId: identity(batchId), traceStatus: VALID_TRACES.has(traceStatus) ? traceStatus : ''
  };
};

export const assertSanitaryReader = (expectedIdentity) => {
  const actor = actorRuntimeController.getState();
  if (!expectedIdentity || !canReadSalesReports(actor) || !canAuditSalesReports(actor)
      || getSalesActorIdentity(actor) !== expectedIdentity) {
    throw new Error('Sesión o permiso de Reportes no vigente.');
  }
};

const statusFromSale = (sale) =>
  ['cancelled', 'canceled', 'requires_review'].includes(String(sale?.status || '').toLowerCase())
    ? 'incomplete' : 'complete';

const localRows = async (f) => {
  if (!db.isOpen()) await db.open();
  const range = (store) => db.table(store).where('timestamp')
    .between(f.dateFrom, f.dateTo, true, false).limit(MAX_LOCAL_ROWS_PER_STORE + 1).toArray();
  const [events, sales, waste, products] = await Promise.all([
    range(STORES.INVENTORY_EVENTS), range(STORES.SALES), range(STORES.WASTE),
    db.table(STORES.MENU).toArray()
  ]);
  if ([events, sales, waste].some((rows) => rows.length > MAX_LOCAL_ROWS_PER_STORE)) {
    throw new Error('El periodo tiene demasiados registros locales. Reduce las fechas; no se exportará un historial incompleto.');
  }
  const catalog = new Map(products.map((p) => [identity(p.id), p]));
  const isMedicine = (product) => {
    const classification = getPharmacyClassification(product || {});
    return classification.recorded && classification.kind === 'medicine';
  };
  const result = [];
  for (const event of events) {
    if (event?.type !== 'INVENTORY_ENTRY' || !event.metadata?.pharmacyReceipt) continue;
    const product = catalog.get(identity(event.productId));
    const receipt = event.metadata.pharmacyReceipt;
    result.push({
      id: 'inventory:' + identity(event.operationId || event.id),
      operationId: identity(event.operationId || event.id),
      occurredAt: ts(event.timestamp),
      receiptAt: event.occurredAt || receipt.receivedAt,
      movementType: 'receipt',
      productId: identity(event.productId), productName: product?.name || 'Medicamento no disponible',
      nameSource: 'current_catalog', activeSubstance: null, classificationAtOperation: null,
      barcode: product?.barcode || null, quantity: Number(event.delta), unit: null, batchId: event.batchId || null,
      batchNumber: event.manufacturerBatchId || null, expiryDate: event.expiryDate || null,
      expirySource: 'receipt_event', documentReference: receipt.documentReference || null,
      documentType: receipt.documentType || null, supplier: receipt.supplier || event.supplier || null,
      actor: event.originActor?.actorKey || null, notes: receipt.notes || null,
      source: 'local_device', provenance: 'inventory_entry_event',
      syncStatus: event.syncDisposition === 'local_only' ? 'local_only' : event.synced ? 'synced' : 'pending',
      traceStatus: receipt.documentReference && event.batchId && event.manufacturerBatchId && event.expiryDate
        ? 'complete' : 'incomplete'
    });
  }
  for (const sale of sales) {
    if (!identity(sale.id) || !Array.isArray(sale.items)) continue;
    sale.items.forEach((item, index) => {
      const rx = item?.pharmacyDispensationV1;
      if (!rx || rx.version !== 1) return;
      const batch = item.batchId || item.batch_id || item.batchesUsed?.[0]?.batchId || null;
      result.push({
        id: 'local-dispensation:' + identity(sale.id) + ':' + index,
        operationId: identity(sale.id) + ':' + index,
        occurredAt: ts(sale.timestamp || sale.createdAt),
        movementType: 'dispensation', productId: identity(item.parentId || item.productId || item.id),
        productName: item.name || item.productName || 'Medicamento',
        nameSource: 'sale_snapshot', activeSubstance: null, classificationAtOperation: null,
        barcode: item.barcode || null, quantity: Number(item.quantity), unit: null, batchId: batch,
        batchNumber: item.batchSku || null, expiryDate: item.batchExpiryDate || null,
        expirySource: item.batchExpiryDate ? 'sale_snapshot' : null,
        documentReference: rx.reference || null, documentType: 'prescription',
        prescriptionId: null, saleId: identity(sale.id), saleItemId: item.lineId || item.cartLineId || null,
        saleStatus: sale.status || 'unknown', actor: sale.actorName || null,
        stampDeclared: rx.stampDeclared, retentionDeclared: rx.retentionDeclared,
        source: 'local_device', provenance: 'local_sale_rx_snapshot',
        syncStatus: 'local_not_cloud_confirmed',
        traceStatus: batch && rx.reference && statusFromSale(sale) === 'complete'
          ? 'limited' : 'incomplete'
      });
    });
  }
  for (const log of waste) {
    if (!identity(log.id) || !isMedicine(catalog.get(identity(log.productId)))) continue;
    result.push({
      id: 'local-waste:' + identity(log.id), operationId: identity(log.id),
      occurredAt: ts(log.timestamp), movementType: 'waste', productId: identity(log.productId),
      productName: log.productName || catalog.get(identity(log.productId))?.name || 'Medicamento',
      nameSource: log.productName ? 'waste_snapshot' : 'current_catalog',
      activeSubstance: null, classificationAtOperation: null,
      quantity: Number(log.quantity), unit: log.unit || null,
      batchId: log.batchId || null, batchNumber: log.batchSku || null,
      expiryDate: null, documentReference: null, documentType: null, actor: null,
      notes: log.reason || log.notes || null, source: 'local_device',
      provenance: 'waste_log', syncStatus: 'local_only',
      traceStatus: log.batchId ? 'limited' : 'incomplete'
    });
  }
  return result;
};

export const sanitaryIncidences = (row) => {
  const issues = [];
  if (!row.batchId) issues.push('Lote sin identidad verificable');
  if (!row.expiryDate) issues.push('Caducidad no disponible');
  if (row.movementType === 'receipt' && !row.documentReference) issues.push('Recepción sin comprobante');
  if (row.movementType === 'dispensation' && !row.documentReference) issues.push('Receta sin referencia documental');
  if (row.movementType === 'dispensation' && row.saleStatus && row.saleStatus !== 'closed') issues.push('Estado de venta requiere revisión');
  if (row.nameSource === 'current_catalog') issues.push('Nombre del catálogo actual, no dato histórico');
  if (!row.classificationAtOperation) issues.push('Clasificación histórica no comprobada');
  if (row.syncStatus === 'pending') issues.push('Operación local pendiente de sincronizar');
  if (row.syncStatus === 'local_not_cloud_confirmed') issues.push('Dispensación local, no confirmada en Cloud');
  return issues;
};

export const pageSanitaryRows = (rows, f, cursor = null, limit = SANITARY_PAGE_SIZE) => {
  const unique = new Map();
  for (const row of rows) {
    if (!row?.id || !row.occurredAt || row.occurredAt < f.dateFrom || row.occurredAt >= f.dateTo) continue;
    if (f.movementType && row.movementType !== f.movementType) continue;
    if (f.traceStatus && row.traceStatus !== f.traceStatus) continue;
    if (f.batchId && identity(row.batchId).toLowerCase() !== f.batchId.toLowerCase()
        && identity(row.batchNumber).toLowerCase() !== f.batchId.toLowerCase()) continue;
    if (f.search && ![row.productName, row.productId, row.activeSubstance, row.barcode]
      .some((v) => String(v || '').toLowerCase().includes(f.search))) continue;
    if (cursor && (row.occurredAt > cursor.at || (row.occurredAt === cursor.at && row.id >= cursor.id))) continue;
    unique.set(row.id, row);
  }
  const sorted = [...unique.values()].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];
  return { success: true, rows: page, hasMore: sorted.length > limit,
    nextCursor: last ? { at: last.occurredAt, id: last.id } : null,
    source: 'local_device' };
};

export const getSanitaryRegisterPage = async ({
  licenseKey, cloud, actorIdentity, filters, cursor = null, limit = SANITARY_PAGE_SIZE
}) => {
  assertSanitaryReader(actorIdentity);
  const f = sanitaryFilters(filters);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Límite inválido.');
  let response;
  if (cloud) {
    if (!supabaseClient || !licenseKey || typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('El Registro sanitario Cloud necesita conexión y una licencia válida.');
    }
    const auth = await buildPosSyncAuthContext({ licenseKey });
    assertSanitaryReader(actorIdentity);
    if (!auth?.deviceFingerprint || !auth.securityToken) throw new Error('No se pudo validar el dispositivo.');
    const { data, error } = await supabaseClient.rpc('pos_get_pharmacy_sanitary_register_v1', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_security_token: auth.securityToken,
      p_staff_session_token: auth.staffSessionToken || null,
      p_date_from: f.dateFrom, p_date_to: f.dateTo,
      p_search: f.search || null, p_movement_type: f.movementType || null,
      p_batch_id: f.batchId || null, p_trace_status: f.traceStatus || null,
      p_limit: limit, p_before_at: cursor?.at || null, p_before_id: cursor?.id || null
    });
    if (error) throw new Error('Consulta Cloud no disponible. Verifica que el contrato SQL esté instalado.');
    if (data?.success !== true || !Array.isArray(data.rows) || typeof data.hasMore !== 'boolean') {
      throw new Error('El servidor devolvió un reporte incompleto.');
    }
    const last = data.rows[data.rows.length - 1];
    response = { ...data, nextCursor: last ? { at: last.occurredAt, id: last.id } : null };
  } else {
    response = pageSanitaryRows(await localRows(f), f, cursor, limit);
  }
  assertSanitaryReader(actorIdentity);
  return response;
};

export const SANITARY_CSV_HEADERS = [
  'Fecha UTC', 'Fecha recepción declarada', 'Movimiento', 'Trazabilidad', 'ID operación', 'Medicamento',
  'Origen nombre', 'Sustancia activa histórica', 'Clasificación histórica',
  'Cantidad', 'Unidad', 'Lote ID', 'Lote fabricante', 'Caducidad', 'Fuente caducidad',
  'Comprobante o receta', 'Tipo documento', 'ID receta', 'Venta', 'Línea venta',
  'Estado venta', 'Proveedor', 'Responsable', 'Fuente registro', 'Sincronización',
  'Procedencia', 'Incidencias', 'Observaciones'
];

const formulaSafe = (value) => {
  let cell = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f\uFEFF]*[=+\-@]/u.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
};

export const buildSanitaryCsv = (rows) => {
  const values = rows.map((r) => [
    r.occurredAt, r.receiptAt, r.movementType, r.traceStatus, r.operationId || r.id, r.productName,
    r.nameSource, r.activeSubstance, r.classificationAtOperation, r.quantity,
    r.unit, r.batchId, r.batchNumber, r.expiryDate, r.expirySource,
    r.documentReference, r.documentType, r.prescriptionId, r.saleId, r.saleItemId,
    r.saleStatus, r.supplier, r.actor, r.source, r.syncStatus,
    r.provenance, sanitaryIncidences(r).join('; '), r.notes
  ]);
  return '\uFEFF' + [SANITARY_CSV_HEADERS, ...values]
    .map((row) => row.map(formulaSafe).join(',')).join('\r\n');
};

export const collectSanitaryExport = async (args) => {
  let cursor = null;
  const all = [];
  const seen = new Set();
  for (;;) {
    const page = await getSanitaryRegisterPage({ ...args, cursor, limit: 100 });
    for (const row of page.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        all.push(row);
      }
    }
    if (all.length > SANITARY_EXPORT_LIMIT) {
      throw new Error('La consulta supera el límite de exportación. Reduce el periodo.');
    }
    if (!page.hasMore) return all;
    if (all.length >= SANITARY_EXPORT_LIMIT || !page.nextCursor ||
        cursor?.at === page.nextCursor.at && cursor?.id === page.nextCursor.id) {
      throw new Error('La consulta excede el límite de exportación o no puede continuar. Reduce el periodo; no se generó un CSV truncado.');
    }
    cursor = page.nextCursor;
  }
};
