import { db, STORES } from '../db/dexie';
import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { canReadSalesReports, canAuditSalesReports, getSalesActorIdentity } from '../auth/salesPermissionPolicy';
import { getPharmacyClassification } from '../../utils/pharmacyClassification';

import { addBusinessCalendarDays, businessDateKeyToStart } from '../../utils/businessTime';

export const SANITARY_PAGE_SIZE = 50;
export const SANITARY_EXPORT_LIMIT = 2000;
export const SANITARY_MOVEMENT_TYPES = [
  'receipt', 'dispensation', 'sale', 'waste', 'return', 'adjustment', 'other'
];
export const LEGACY_SANITARY_MOVEMENT_TYPES = [
  'receipt', 'dispensation', 'waste', 'return', 'adjustment', 'other'
];
const MAX_LOCAL_ROWS_PER_STORE = 3000;
const VALID_MOVEMENTS = new Set(SANITARY_MOVEMENT_TYPES);
const VALID_TRACES = new Set(['complete', 'incomplete', 'limited']);
const identity = (value) => String(value ?? '').trim();
const ts = (value) => {
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
};

export const sanitaryFilters = ({ from, to, search = '', movementType = '', batchId = '', traceStatus = '' }, timezone = 'UTC') => {
  const start = businessDateKeyToStart(from, timezone);
  const lastDay = businessDateKeyToStart(to, timezone);
  const calendarSpan = businessDateKeyToStart(to, 'UTC') - businessDateKeyToStart(from, 'UTC');
  if (!start || !lastDay || lastDay < start || calendarSpan >= 92 * 86400000 || search.trim().length > 120) {
    throw new Error('Selecciona un periodo válido de hasta 92 días.');
  }
  return {
    dateFrom: start.toISOString(), dateTo: addBusinessCalendarDays(lastDay, 1, timezone).toISOString(),
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
  String(sale?.status || '').toLowerCase() === 'closed' ? 'complete' : 'incomplete';

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
  // Archived sales have no timestamp index. Resolve only sale IDs present in
  // the already bounded movement window instead of scanning the full recycle bin.
  const movementSaleIds = [...new Set(events
    .filter((event) => event?.type === 'INVENTORY_DEDUCTION')
    .map((event) => identity(event?.saleId || event?.sale_id))
    .filter(Boolean))].slice(0, MAX_LOCAL_ROWS_PER_STORE + 1);
  const archivedSales = movementSaleIds.length
    ? (await db.table(STORES.DELETED_SALES).bulkGet(movementSaleIds))
      .filter((sale) => sale?.status === 'cancelled')
    : [];
  const salesById = new Map([...archivedSales, ...sales].map((sale) => [identity(sale.id), sale]));
  const allSales = [...salesById.values()];
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
      barcode: product?.barcode || null, searchHints: product?.activeSubstance || null,
      quantity: Number(event.delta), unit: null, batchId: event.batchId || null,
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
  const saleDeductions = new Map();
  for (const event of events) {
    const saleId = identity(event?.saleId || event?.sale_id);
    const productId = identity(event?.productId || event?.product_id);
    const delta = Number(event?.delta);
    if (event?.type !== 'INVENTORY_DEDUCTION' || !identity(event?.id)
        || !saleId || !productId || !Number.isFinite(delta) || delta >= 0) continue;
    const key = saleId + ':' + productId;
    const current = saleDeductions.get(key) || { quantity: 0, ids: [], timestamps: [] };
    if (current.ids.includes(identity(event.id))) continue;
    current.quantity += Math.abs(delta);
    current.ids.push(identity(event.id));
    if (event.timestamp) current.timestamps.push(event.timestamp);
    saleDeductions.set(key, current);
  }

  const localSaleGroups = new Map();
  for (const sale of allSales) {
    if (!identity(sale.id) || !Array.isArray(sale.items)) continue;
    sale.items.forEach((item, index) => {
      const rx = item?.pharmacyDispensationV1;
      const saleId = identity(sale.id);
      const productId = identity(item.parentId || item.productId || item.id);
      const product = catalog.get(productId);
      const key = saleId + ':' + productId;
      const lineId = identity(item.lineId || item.cartLineId || item.localLineId) || null;
      const lineQuantity = Number(item.stockDeducted ?? item.quantity);

      if (rx?.version === 1) {
        const batch = item.batchId || item.batch_id || item.batchesUsed?.[0]?.batchId || null;
        result.push({
          id: 'local-dispensation:' + saleId + ':' + index,
          operationId: saleId + ':' + index,
          occurredAt: ts(sale.timestamp || sale.createdAt),
          movementType: 'dispensation', productId,
          productName: item.name || item.productName || 'Medicamento',
          nameSource: 'sale_snapshot', activeSubstance: null, classificationAtOperation: null,
          barcode: item.barcode || null, searchHints: item.activeSubstance || product?.activeSubstance || null,
          quantity: Number(item.quantity), unit: null, batchId: batch,
          batchNumber: item.batchSku || null, expiryDate: item.batchExpiryDate || null,
          expirySource: item.batchExpiryDate ? 'sale_snapshot' : null,
          documentReference: rx.reference || null, documentType: 'prescription',
          prescriptionId: null, saleId, saleItemId: lineId,
          saleStatus: sale.status || 'unknown', actor: sale.actorName || null,
          stampDeclared: rx.stampDeclared, retentionDeclared: rx.retentionDeclared,
          source: 'local_device', provenance: 'local_sale_rx_snapshot',
          syncStatus: 'local_not_cloud_confirmed',
          traceStatus: batch && rx.reference && statusFromSale(sale) === 'complete'
            ? 'limited' : 'incomplete'
        });
      }

      if (!isMedicine(product)) return;
      const group = localSaleGroups.get(key) || {
        sale, product, productId, lines: [], dispensationQuantity: 0
      };
      if (rx?.version === 1) {
        if (Number.isFinite(lineQuantity) && lineQuantity > 0) group.dispensationQuantity += lineQuantity;
      } else {
        group.lines.push({ item, index, lineId, quantity: lineQuantity });
      }
      localSaleGroups.set(key, group);
    });
  }

  for (const [key, group] of localSaleGroups) {
    if (!group.lines.length) continue;
    const deduction = saleDeductions.get(key);
    if (!deduction || deduction.quantity <= 0) continue;
    const ordinaryQuantity = deduction.quantity - group.dispensationQuantity;
    if (!Number.isFinite(ordinaryQuantity) || ordinaryQuantity <= 0) continue;

    const allocations = [];
    for (const line of group.lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
      const item = line.item;
      const raw = Array.isArray(item.batchesUsed) && item.batchesUsed.length
        ? item.batchesUsed
        : (item.batchId || item.batch_id
          ? [{
            batchId: item.batchId || item.batch_id, quantity: line.quantity,
            batchSku: item.batchSku || null, expiryDate: item.batchExpiryDate || null,
            manufacturerBatchId: item.manufacturerBatchId || null
          }]
          : []);
      if (!raw.length) continue;
      const normalized = raw.map((allocation) => ({
        batchId: identity(allocation?.batchId || allocation?.batch_id),
        productId: identity(allocation?.productId || allocation?.ingredientId || allocation?.product_id),
        quantity: Number(allocation?.quantity ?? allocation?.usedQuantity ?? allocation?.used_quantity),
        batchSku: allocation?.batchSku || allocation?.batch_sku || null,
        batchNumber: allocation?.manufacturerBatchId || allocation?.manufacturer_batch_id || null,
        expiryDate: allocation?.expiryDate || allocation?.batchExpiryDate || allocation?.batch_expiry_date || null
      }));
      const valid = normalized.every((allocation) => allocation.batchId
        && Number.isFinite(allocation.quantity) && allocation.quantity > 0
        && (!allocation.productId || allocation.productId === group.productId));
      const allocatedQuantity = normalized.reduce((sum, allocation) => sum + allocation.quantity, 0);
      if (!valid || Math.abs(allocatedQuantity - line.quantity) > Math.max(1e-6, Math.abs(line.quantity) * 1e-9)) continue;
      normalized.forEach((allocation, allocationIndex) => allocations.push({
        ...allocation, lineId: line.lineId, lineIndex: line.index, allocationIndex
      }));
    }

    const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    const tolerance = Math.max(1e-6, Math.abs(ordinaryQuantity) * 1e-9);
    const allocationMismatch = allocatedQuantity > ordinaryQuantity + tolerance;
    const visibleAllocations = allocationMismatch ? [] : allocations;
    const unassignedQuantity = allocationMismatch
      ? ordinaryQuantity : Math.max(0, ordinaryQuantity - allocatedQuantity);
    const rowDefinitions = visibleAllocations.map((allocation) => ({
      ...allocation, provenance: 'local_inventory_deduction_batch_snapshot'
    }));
    if (unassignedQuantity > tolerance || rowDefinitions.length === 0) {
      rowDefinitions.push({
        quantity: unassignedQuantity, batchId: '', batchSku: null, batchNumber: null,
        expiryDate: null, lineId: null, lineIndex: 'unassigned', allocationIndex: 0,
        provenance: allocationMismatch
          ? 'local_inventory_deduction_allocation_mismatch'
          : 'local_inventory_deduction_unallocated'
      });
    }

    rowDefinitions.forEach((allocation) => {
      const saleId = identity(group.sale.id);
      const batchId = allocation.batchId || null;
      const sourceLine = allocation.lineId || '';
      const internalLine = sourceLine || 'line-' + allocation.lineIndex;
      const allocationKey = allocation.lineIndex + ':' + allocation.allocationIndex;
      const sourceItem = sourceLine
        ? group.lines.find((line) => line.lineId === sourceLine)?.item
        : group.lines[0]?.item;
      result.push({
        id: 'local-sale:' + saleId + ':' + internalLine + ':' + (batchId || 'unassigned') + ':' + allocationKey,
        operationId: null,
        occurredAt: ts(deduction.timestamps[0] || group.sale.timestamp || group.sale.createdAt),
        movementType: 'sale', productId: group.productId,
        productName: sourceItem?.name || sourceItem?.productName || 'Medicamento',
        nameSource: 'sale_snapshot', activeSubstance: null, classificationAtOperation: null,
        barcode: sourceItem?.barcode || group.product?.barcode || null,
        searchHints: group.product?.activeSubstance || null,
        quantity: allocation.quantity, unit: sourceItem?.unit || null,
        batchId, batchNumber: allocation.batchNumber || null, batchSku: allocation.batchSku || null,
        expiryDate: allocation.expiryDate || null,
        expirySource: allocation.expiryDate ? 'sale_snapshot' : null,
        documentReference: null, documentType: null, prescriptionId: null,
        saleId, saleItemId: allocation.lineId || null,
        saleReference: group.sale.folio || group.sale.localFolio || null,
        saleStatus: group.sale.status || 'unknown', actor: group.sale.actorName || null,
        source: 'local_device', provenance: allocation.provenance,
        sourceMovementIds: deduction.ids, movementGranularity: 'product',
        syncStatus: 'local_not_cloud_confirmed', traceStatus: 'limited'
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
      searchHints: catalog.get(identity(log.productId))?.activeSubstance || null,
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
  if (row.movementType === 'sale' && row.provenance === 'local_inventory_deduction_unallocated') {
    issues.push('La salida local no conserva una asignación de lote verificable');
  }
  if (row.movementType === 'sale' && row.provenance === 'local_inventory_deduction_allocation_mismatch') {
    issues.push('La cantidad por lote local no coincide con la salida registrada');
  }
  if (row.movementType === 'sale' && row.saleStatus === 'cancelled') {
    issues.push('Venta cancelada; revisar la devolución asociada');
  } else if (['sale', 'dispensation'].includes(row.movementType)
      && row.saleStatus && row.saleStatus !== 'closed') {
    issues.push('Estado de venta requiere revisión');
  }
  if (row.nameSource === 'current_catalog') issues.push('Nombre del catálogo actual, no dato histórico');
  if (!row.classificationAtOperation) issues.push('Clasificación histórica no comprobada');
  if (row.syncStatus === 'pending') issues.push('Operación local pendiente de sincronizar');
  if (row.syncStatus === 'local_not_cloud_confirmed') {
    issues.push(row.movementType === 'sale'
      ? 'Movimiento local, no confirmado en Cloud'
      : 'Dispensación local, no confirmada en Cloud');
  }
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
    if (f.search && ![row.productName, row.productId, row.activeSubstance, row.barcode, row.searchHints]
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
    source: 'local_device', contractVersion: 2,
    supportedMovementTypes: SANITARY_MOVEMENT_TYPES };
};

export const getSanitaryRegisterPage = async ({
  licenseKey, cloud, actorIdentity, filters, timezone = 'UTC', cursor = null, limit = SANITARY_PAGE_SIZE
}) => {
  assertSanitaryReader(actorIdentity);
  const f = sanitaryFilters(filters, timezone);
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
    const currentContract = Number(data.contractVersion) >= 2
      && Array.isArray(data.supportedMovementTypes);
    response = {
      ...data,
      supportedMovementTypes: currentContract
        ? [...new Set(data.supportedMovementTypes.filter((type) => VALID_MOVEMENTS.has(type)))]
        : LEGACY_SANITARY_MOVEMENT_TYPES,
      nextCursor: last ? { at: last.occurredAt, id: last.id } : null
    };
  } else {
    response = pageSanitaryRows(await localRows(f), f, cursor, limit);
  }
  assertSanitaryReader(actorIdentity);
  return response;
};

export const SANITARY_CSV_HEADERS = [
  'Fecha y hora del registro (ISO 8601)', 'Fecha y hora de recepción declarada (ISO 8601)', 'Movimiento', 'Trazabilidad', 'ID operación', 'Medicamento',
  'Origen nombre', 'Sustancia activa histórica', 'Clasificación histórica',
  'Cantidad', 'Unidad', 'Lote ID', 'Lote fabricante', 'Caducidad', 'Fuente caducidad',
  'Comprobante o receta', 'Tipo documento', 'ID receta', 'Venta', 'Línea venta',
  'Estado venta', 'Proveedor', 'Responsable', 'Fuente registro', 'Sincronización',
  'Procedencia', 'Incidencias', 'Observaciones', 'ID movimiento origen', 'Referencia de venta'
];

const formulaSafe = (value) => {
  let cell = value === null || value === undefined ? '' : String(value);
  // eslint-disable-next-line no-control-regex -- spreadsheets can skip leading control characters
  if (/^[\s\u0000-\u001f\uFEFF]*[=+\-@]/u.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
};

export const buildSanitaryCsv = (rows) => {
  const values = rows.map((r) => [
    r.occurredAt, r.receiptAt, r.movementType, r.traceStatus,
    r.operationId || r.movementId || (r.movementType === 'sale' ? '' : r.id), r.productName,
    r.nameSource, r.activeSubstance, r.classificationAtOperation, r.quantity,
    r.unit, r.batchId, r.batchNumber, r.expiryDate, r.expirySource,
    r.documentReference, r.documentType, r.prescriptionId, r.saleId, r.saleItemId,
    r.saleStatus, r.supplier, r.actor, r.source, r.syncStatus,
    r.provenance, sanitaryIncidences(r).join('; '), r.notes,
    r.movementId || (Array.isArray(r.sourceMovementIds) ? r.sourceMovementIds.join('; ') : ''),
    r.saleReference
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
