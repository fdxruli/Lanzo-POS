import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { posSyncOrchestrator } from '../../services/sync/posSyncOrchestrator';
import { db, STORES } from '../../services/db/dexie';
import { addInventoryEntry, inventoryEntryErrors, isCloudGeneralPharmacyBatchEntry, retryCloudInventoryEntry } from '../../services/inventory/inventoryEntryService';
import { generateIdempotencyKey } from '../../services/sync/idempotency';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../services/sync/syncConstants';
import { resolveProductSaleUnit } from '../../utils/productUnitConfiguration';
import { getPharmacyClassification, isSpecialPharmacyProduct } from '../../utils/pharmacyClassification';
import { productCloudRepository } from '../../services/products/productCloudRepository';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails, isCloudProductsSyncEnabled, isPharmacyCloudAuthorityRequired } from '../../services/sync/syncConstants';
import { isBatchArchived } from '../../services/products/batchStatus';
import { isBatchExpiredForSale } from '../../services/products/fefoUtils';
import { PRODUCT_CLOUD_SYNC_BADGE_STATUS, resolveProductCloudSyncBadge } from '../../services/products/productConstants';

import { formatBusinessDateTimeInput, formatBusinessInstant, isValidTimeZone, parseBusinessDateTimeInput } from '../../utils/businessTime';

const timestampLabel = (value, timezone) => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatBusinessInstant(value, timezone, {
    dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23'
  });
};
const day = (value) => String(value || '').slice(0, 10);
const toReceiptView = (item, cloud = false) => {
  const movement = item.synced && !item.rejectionCode && item.syncDisposition === 'cloud_authoritative'
    ? item.cloudResult?.inventory_movement : null;
  const receipt = cloud ? item.receipt : movement?.metadata?.pharmacyReceipt || item.metadata?.pharmacyReceipt;
  return {
    id: movement?.id || item.id,
    operationId: item.operationId || item.id,
    receivedAt: receipt?.receivedAt || (cloud ? item.createdAt : (item.occurredAt || item.timestamp)),
    quantity: cloud ? item.quantity : movement?.quantity ?? item.delta,
    receipt,
    responsible: cloud ? item.responsible : movement?.actor_name,
    status: cloud ? 'Sincronizado en Cloud' : item.syncDisposition === 'local_only'
      ? 'Guardado local' : item.rejectionCode ? 'Rechazado' : item.synced
        ? (item.syncDisposition === 'cloud_authoritative' ? 'Sincronizado en Cloud' : 'Sincronizado')
        : 'Pendiente de sincronizar'
  };
};
const mergeReceiptHistory = (local, cloud, submittedOperationId) => {
  const merged = new Map();
  for (const item of local) merged.set(item.operationId || item.id, toReceiptView(item));
  for (const item of cloud) merged.set(item.operationId || item.id, toReceiptView(item, true));
  return [...merged.values()].sort((a, b) =>
    (Date.parse(b.receivedAt) - Date.parse(a.receivedAt)) || String(b.id).localeCompare(String(a.id))
  ).filter((item, index) => index < 5 || (item.operationId === submittedOperationId
    && item.status === 'Sincronizado en Cloud'));
};

export default function InventoryEntryModal({ product: productProp, onClose, onCompleted }) {
  const localProduct = useLiveQuery(
    () => db.table(STORES.MENU).get(productProp.id),
    [productProp.id]
  );
  const productLoaded = localProduct?.id === productProp.id;
  const product = productLoaded ? localProduct : productProp;
  const businessTimezone = useAppStore((state) => state.companyProfile?.timezone);
  const pharmacy = getPharmacyClassification(product);
  const medicine = pharmacy.recorded && pharmacy.kind === 'medicine';
  const receiptTimezone = medicine ? (isValidTimeZone(businessTimezone) ? businessTimezone : 'UTC') : null;
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => formatBusinessDateTimeInput(new Date(), receiptTimezone));
  const [batches, setBatches] = useState([]);
  const [archivedBatches, setArchivedBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [manufacturerBatchId, setManufacturerBatchId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [documentType, setDocumentType] = useState('factura');
  const [documentReference, setDocumentReference] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [cloudHistory, setCloudHistory] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const operationIdRef = useRef(null);

  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const cloudMedicine = medicine && isPharmacyCloudAuthorityRequired(licenseDetails);
  const cloudConfirmation = cloudMedicine || isCloudGeneralPharmacyBatchEntry(product, licenseDetails);
  const cloudProductNotReady = cloudMedicine && (!productLoaded
    || resolveProductCloudSyncBadge(product).status !== PRODUCT_CLOUD_SYNC_BADGE_STATUS.SYNCED);
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const productId = product.id;
  const historyScope = useMemo(() => ({ productId, licenseKey }), [productId, licenseKey]);
  const observed = useLiveQuery(async () => {
    if (!medicine && !cloudConfirmation) return null;
    try {
      const events = await db.table(STORES.INVENTORY_EVENTS).where('productId').equals(productId)
        .filter((entry) => entry.type === 'INVENTORY_ENTRY' && (!entry.licenseKey || entry.licenseKey === licenseKey))
        .sortBy('timestamp');
      return { scope: historyScope, events };
    } catch {
      return { scope: historyScope, events: [], error: 'No se pudo consultar el historial local.' };
    }
  }, [medicine, cloudConfirmation, historyScope, productId, licenseKey]);
  const currentObservation = observed?.scope === historyScope ? observed : null;
  const loadCloudHistory = medicine && Boolean(currentObservation && licenseKey) && isCloudProductsSyncEnabled(licenseDetails);
  const localEvents = currentObservation?.events || [];
  const cloudEvents = cloudConfirmation ? localEvents : [];
  const cloudEvent = cloudEvents.filter((entry) => entry.syncDisposition === 'cloud_authoritative').at(-1);
  const localReceipts = medicine ? localEvents.filter((entry) => entry.metadata?.pharmacyReceipt) : [];
  const confirmedOperations = localReceipts
    .filter((entry) => entry.syncDisposition === 'cloud_authoritative' && entry.synced && !entry.rejectionCode)
    .map((entry) => entry.operationId).join(' ');
  const currentCloudHistory = loadCloudHistory && cloudHistory?.scope === historyScope ? cloudHistory : null;
  const history = mergeReceiptHistory(localReceipts, currentCloudHistory?.receipts || [], operationIdRef.current);
  const historyError = currentCloudHistory?.error || currentObservation?.error;
  const legacyPending = cloudEvents.find((entry) => entry.syncDisposition !== 'cloud_authoritative'
    && entry.syncDisposition !== 'local_only' && !entry.synced && entry.operationId && entry.metadata?.pharmacyReceipt);
  const legacyReview = cloudMedicine && (Boolean(legacyPending) || cloudEvents.some((entry) => entry.syncDisposition === 'local_only'
    || (entry.syncDisposition !== 'cloud_authoritative' && !entry.synced)));
  const confirmedSubmission = cloudEvent?.synced && !cloudEvent.rejectionCode && cloudEvent.operationId === operationIdRef.current;
  const pendingCloudReceipt = cloudEvent && !cloudEvent.synced && !cloudEvent.rejectionCode;
  const eventToVerify = legacyPending || (pendingCloudReceipt ? cloudEvent : null);
  const sending = saving && cloudConfirmation;
  const special = medicine && isSpecialPharmacyProduct(product);
  const unit = resolveProductSaleUnit(product) || 'pza';
  const batchManaged = product?.batchManagement?.enabled === true;
  const productExpirationMode = product?.expirationMode || product?.expiration_mode || 'NONE';
  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const nextStock = useMemo(
    () => Number(product?.stock || 0) + (Number(quantity) || 0),
    [product?.stock, quantity]
  );
  const blocked = (medicine && (
    special || pharmacy.status !== 'confirmed' || !batchManaged ||
    product?.conversionFactor?.enabled === true
  )) || cloudProductNotReady;

  useEffect(() => {
    let active = true;
    if (batchManaged) {
      db.table(STORES.PRODUCT_BATCHES).where('productId').equals(product.id).toArray()
        .then((items) => {
          if (!active) return;
          const expiryProduct = { expirationMode: productExpirationMode };
          const usable = items.filter((item) => !isBatchArchived(item)
            && (!medicine || !isBatchExpiredForSale(item, expiryProduct)));
          setArchivedBatches(items.filter((item) => isBatchArchived(item)
            || (medicine && isBatchExpiredForSale(item, expiryProduct))));
          setBatches(usable);
          if (usable.length === 1) setBatchId(usable[0].id);
        })
        .catch(() => { if (active) setError('No se pudieron consultar los lotes.'); });
    }
    return () => { active = false; };
  }, [batchManaged, medicine, product?.id, productExpirationMode]);

  useEffect(() => {
    if (!loadCloudHistory) return;
    let active = true;
    productCloudRepository.listPharmacyInventoryReceipts({ licenseKey, productId, limit: 20 })
      .then((response) => {
        if (!active) return;
        if (response?.success !== true || !Array.isArray(response?.receipts)) {
          throw new Error('PHARMACY_CLOUD_HISTORY_INVALID');
        }
        setCloudHistory({ scope: historyScope, receipts: response.receipts });
      })
      .catch(() => {
        if (!active) return;
        setCloudHistory((current) => ({
          scope: historyScope,
          receipts: current?.scope === historyScope ? current.receipts : [],
          error: 'No se pudo actualizar el historial Cloud. Vuelve a abrir el formulario para consultarlo.'
        }));
      });
    return () => { active = false; };
  }, [loadCloudHistory, licenseKey, productId, historyScope, confirmedOperations]);

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || blocked || pendingCloudReceipt || confirmedSubmission || legacyReview) return;
    submittingRef.current = true;
    setSaving(true);
    setError('');
    if (!operationIdRef.current || (cloudEvent?.rejectionCode && cloudEvent.operationId === operationIdRef.current)) {
      operationIdRef.current = generateIdempotencyKey({
        prefix: 'inventory-entry', entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
        operation: SYNC_OPERATIONS.INVENTORY_ENTRY, entityId: product.id
      });
    }
    try {
      const acquired = acquiredAt || null;
      const batchManufacturer = selectedBatch?.manufacturerBatchId || manufacturerBatchId.trim();
      const batchExpiry = selectedBatch?.expiryDate || expiryDate;
      const instant = parseBusinessDateTimeInput(occurredAt, receiptTimezone);
      if (!instant) {
        setError('Selecciona una fecha y hora de recepción válida para la zona indicada.');
        return;
      }
      const receivedAt = instant.toISOString();
      const metadata = medicine ? {
        pharmacyReceipt: {
          version: 1, supplier: supplier.trim(), documentType, documentReference: documentReference.trim(),
          receivedAt, acquiredAt: acquired, notes: notes.trim() || null,
          manufacturerBatchId: batchManufacturer, expiryDate: day(batchExpiry)
        }
      } : {};
      const result = await addInventoryEntry({
        operationId: operationIdRef.current, productId: product.id, batchId: batchId || null,
        quantity, baseQuantity: quantity, inputUnit: unit, baseUnit: unit,
        unitCost: unitCost === '' ? null : unitCost, supplier, occurredAt: receivedAt,
        manufacturerBatchId: batchId ? null : manufacturerBatchId.trim(),
        expiryDate: batchId ? null : expiryDate, entryKind: 'restock', metadata
      });
      if (cloudConfirmation && result?.pending) {
        await posSyncOrchestrator.processOutbox('pharmacy_inventory_entry');
        return;
      }
      if (result?.success && !cloudMedicine) {
        try { await onCompleted?.(); } finally { onClose(); }
      }
    } catch (cause) {
      setError(inventoryEntryErrors[cause?.code] || 'No se pudo registrar la entrada. Reintenta sin cambiar los datos para evitar duplicados.');
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <form className="modal-content" style={{ width: 'min(650px, 96vw)', maxHeight: '94dvh' }}
        onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="inventory-entry-title">
        <div className="modal-header">
          <h3 id="inventory-entry-title">{medicine ? 'Recepción de medicamento' : 'Agregar existencia'}</h3>
          <button type="button" className="close-button" onClick={onClose} disabled={saving} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: '73dvh' }}>
          <p><strong>{product.name}</strong>{medicine && (
            <span> · Fracción {pharmacy.fraction || 'pendiente'}{pharmacy.antibiotic ? ' · Antibiótico' : ''}</span>
          )}</p>
          {blocked && <div role="alert" className="ui-alert ui-alert--danger">
            {cloudProductNotReady ? inventoryEntryErrors.PHARMACY_PRODUCT_NOT_SYNCED
              : special ? inventoryEntryErrors.PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE
              : pharmacy.status !== 'confirmed' ? inventoryEntryErrors.PHARMACY_CLASSIFICATION_REQUIRED
                : !batchManaged ? inventoryEntryErrors.PHARMACY_BATCHES_REQUIRED
                  : inventoryEntryErrors.INVALID_UNIT_PRECISION}
          </div>}
          <div className="form-group">
            <label htmlFor="inventory-entry-quantity">Cantidad a recibir ({unit})</label>
            <input id="inventory-entry-quantity" type="number" inputMode="decimal" min="0.0001"
              step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required autoFocus />
          </div>
          {batchManaged && <div className="form-group">
            <label htmlFor="inventory-entry-batch">Lote</label>
            <select id="inventory-entry-batch" value={batchId} onChange={(event) => setBatchId(event.target.value)}>
              <option value="">Registrar lote nuevo</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.manufacturerBatchId || batch.sku || batch.id} · {day(batch.expiryDate) || 'Sin caducidad'} · {batch.stock ?? 0} {unit}
                </option>
              ))}
            </select>
          </div>}
          {medicine && archivedBatches.length > 0 && <div className="ui-alert ui-alert--info" role="status">
            {archivedBatches.length} lote(s) archivado(s) o vencido(s) no disponible(s) para recepción. Revisa Lotes / historial antes de registrar uno nuevo con la misma identidad.
          </div>}
          {batchManaged && !batchId && (medicine || product?.expirationMode === 'STRICT') && <>
            <div className="form-group"><label htmlFor="inventory-entry-manufacturer">Lote del fabricante *</label>
              <input id="inventory-entry-manufacturer" value={manufacturerBatchId}
                onChange={(event) => setManufacturerBatchId(event.target.value)} required /></div>
            <div className="form-group"><label htmlFor="inventory-entry-expiry">Caducidad del lote *</label>
              <input id="inventory-entry-expiry" type="date" value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)} required /></div>
          </>}
          <div className="form-group"><label htmlFor="inventory-entry-cost">Costo unitario (opcional)</label>
            <input id="inventory-entry-cost" type="number" inputMode="decimal" min="0" step="any"
              value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="inventory-entry-supplier">Proveedor {medicine ? '*' : '(opcional)'}</label>
            <input id="inventory-entry-supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)}
              required={medicine} /></div>
          {medicine && <>
            <div className="form-group"><label htmlFor="inventory-entry-document-type">Tipo de comprobante</label>
              <select id="inventory-entry-document-type" value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}>
                <option value="factura">Factura</option><option value="remision">Remisión</option>
                <option value="otro">Otro comprobante</option>
              </select></div>
            <div className="form-group"><label htmlFor="inventory-entry-document-reference">Referencia del comprobante *</label>
              <input id="inventory-entry-document-reference" value={documentReference}
                onChange={(event) => setDocumentReference(event.target.value)} required /></div>
            <div className="form-group"><label htmlFor="inventory-entry-acquired">Fecha de adquisición (opcional)</label>
              <input id="inventory-entry-acquired" type="date" value={acquiredAt}
                onChange={(event) => setAcquiredAt(event.target.value)} /></div>
            <div className="form-group"><label htmlFor="inventory-entry-notes">Observaciones (opcional)</label>
              <textarea id="inventory-entry-notes" value={notes}
                onChange={(event) => setNotes(event.target.value)} rows={2} /></div>
          </>}
          <div className="form-group"><label htmlFor="inventory-entry-date">Fecha y hora de recepción{medicine && ` (${receiptTimezone})`}</label>
            <input id="inventory-entry-date" type="datetime-local" value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)} required /></div>
          {!cloudConfirmation && <div className="ui-alert ui-alert--info">
            Existencia actual: <strong>{product.stock ?? 0} {unit}</strong>
            {' · '}Entrada: <strong>+{Number(quantity) || 0} {unit}</strong>
            {' · '}Total estimado: <strong>{nextStock} {unit}</strong>
          </div>}
          {legacyReview && <div role="alert" className="ui-alert ui-alert--danger">
            {inventoryEntryErrors.PHARMACY_INVENTORY_REVIEW_REQUIRED}
          </div>}
          {cloudConfirmation && !legacyReview
            && (!cloudProductNotReady || pendingCloudReceipt || confirmedSubmission || cloudEvent?.rejectionCode)
            && <div role="status" className="ui-alert ui-alert--info">
            {sending ? 'Enviando al servidor…' : pendingCloudReceipt ? 'Recepción pendiente de verificación.'
              : cloudEvent?.rejectionCode ? inventoryEntryErrors[cloudEvent.rejectionCode] || 'Recepción rechazada. Revisa los datos.'
                : confirmedSubmission
                  ? medicine
                    ? <>Recepción confirmada. Fecha y hora declaradas: {timestampLabel(cloudEvent.occurredAt, receiptTimezone) || 'Fecha no verificable'}.</>
                    : 'Recepción confirmada.'
                  : 'La recepción se confirmará en Nube.'}
          </div>}
          {medicine && <section aria-label="Últimas recepciones documentadas" style={{ overflowWrap: 'anywhere' }}>
            <h4>Últimas recepciones documentadas</h4>
            {history.length === 0 && <small>No hay recepciones documentadas recuperadas.</small>}
            {history.map((item) => (
              <p key={item.operationId}>
                {timestampLabel(item.receivedAt, receiptTimezone) || 'Fecha no verificable'} · +{item.quantity} {unit} ·
                {' '}{item.receipt?.manufacturerBatchId || 'Lote no disponible'} ·
                {' '}{item.receipt?.supplier || 'Proveedor no disponible'} ·
                {' '}{item.receipt?.documentType || 'Documento'} {item.receipt?.documentReference || 'sin referencia'} ·
                {' '}{item.responsible ? `${item.responsible} · ` : ''}{item.status}
              </p>
            ))}
            {historyError && <small role="status">{historyError}</small>}
            <small>Registro auxiliar local y Cloud; no sustituye libros sanitarios oficiales.</small>
          </section>}
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="ui-button ui-button--ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          {eventToVerify ? <button type="button" className="ui-button ui-button--primary" disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await retryCloudInventoryEntry(eventToVerify.operationId);
                await posSyncOrchestrator.processOutbox('pharmacy_receipt_status');
              }
              catch (cause) {
                setError(inventoryEntryErrors[cause?.code] || 'No se pudo verificar la recepción. Intenta de nuevo.');
              }
              finally { setSaving(false); }
            }}>Verificar recepción</button> : <button type="submit" className="ui-button ui-button--primary" disabled={saving || blocked || confirmedSubmission || legacyReview}>
            {saving ? 'Guardando…' : medicine ? 'Confirmar recepción' : 'Agregar existencia'}
          </button>}
        </div>
      </form>
    </div>
  );
}
