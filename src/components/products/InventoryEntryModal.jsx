import { useEffect, useMemo, useRef, useState } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { addInventoryEntry, inventoryEntryErrors } from '../../services/inventory/inventoryEntryService';
import { generateIdempotencyKey } from '../../services/sync/idempotency';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../../services/sync/syncConstants';
import { resolveProductSaleUnit } from '../../utils/productUnitConfiguration';
import { getPharmacyClassification, isSpecialPharmacyProduct } from '../../utils/pharmacyClassification';
import { productCloudRepository } from '../../services/products/productCloudRepository';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails, isCloudProductsSyncEnabled } from '../../services/sync/syncConstants';

const toDateTimeLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const day = (value) => String(value || '').slice(0, 10);
const toReceiptView = (item, cloud = false) => ({
  id: item.id,
  operationId: item.operationId || item.id,
  receivedAt: cloud ? (item.receipt?.receivedAt || item.createdAt) : (item.occurredAt || item.timestamp),
  quantity: cloud ? item.quantity : item.delta,
  receipt: cloud ? item.receipt : item.metadata?.pharmacyReceipt,
  responsible: cloud ? item.responsible : null,
  status: cloud ? 'Sincronizado en Cloud' : item.syncDisposition === 'local_only'
    ? 'Guardado local' : item.synced ? 'Sincronizado' : 'Pendiente de sincronizar'
});
const mergeReceiptHistory = (local, cloud) => {
  const merged = new Map();
  for (const item of local) merged.set(item.operationId, toReceiptView(item));
  for (const item of cloud) merged.set(item.operationId || item.id, toReceiptView(item, true));
  return [...merged.values()].sort((a, b) =>
    String(b.receivedAt).localeCompare(String(a.receivedAt)) || String(b.id).localeCompare(String(a.id))
  ).slice(0, 5);
};

export default function InventoryEntryModal({ product, onClose, onCompleted }) {
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [manufacturerBatchId, setManufacturerBatchId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [documentType, setDocumentType] = useState('factura');
  const [documentReference, setDocumentReference] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const operationIdRef = useRef(null);

  const pharmacy = getPharmacyClassification(product);
  const medicine = pharmacy.recorded && pharmacy.kind === 'medicine';
  const special = medicine && isSpecialPharmacyProduct(product);
  const unit = resolveProductSaleUnit(product) || 'pza';
  const batchManaged = product?.batchManagement?.enabled === true;
  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const nextStock = useMemo(
    () => Number(product?.stock || 0) + (Number(quantity) || 0),
    [product?.stock, quantity]
  );
  const blocked = medicine && (
    special || pharmacy.status !== 'confirmed' || !batchManaged ||
    product?.conversionFactor?.enabled === true
  );

  useEffect(() => {
    let active = true;
    if (batchManaged) {
      db.table(STORES.PRODUCT_BATCHES).where('productId').equals(product.id).toArray()
        .then((items) => {
          if (!active) return;
          const usable = items.filter((item) => item.isActive !== false && item.status !== 'archived');
          setBatches(usable);
          if (usable.length === 1) setBatchId(usable[0].id);
        })
        .catch(() => { if (active) setError('No se pudieron consultar los lotes.'); });
    }
    if (medicine) {
      let localReceipts = [];
      let cloudReceipts = [];
      const refresh = () => { if (active) setHistory(mergeReceiptHistory(localReceipts, cloudReceipts)); };
      db.table(STORES.INVENTORY_EVENTS).where('productId').equals(product.id).toArray()
        .then((events) => {
          localReceipts = events.filter((item) => item.type === 'INVENTORY_ENTRY' && item.metadata?.pharmacyReceipt);
          refresh();
        })
        .catch(() => { if (active) setHistoryError('No se pudo consultar el historial local.'); });
      const licenseDetails = useAppStore.getState()?.licenseDetails;
      const licenseKey = getLicenseKeyFromDetails(licenseDetails);
      if (licenseKey && isCloudProductsSyncEnabled(licenseDetails)) {
        productCloudRepository.listPharmacyInventoryReceipts({ licenseKey, productId: product.id, limit: 20 })
          .then((response) => {
            if (response?.success !== true || !Array.isArray(response?.receipts)) {
              throw new Error('PHARMACY_CLOUD_HISTORY_INVALID');
            }
            cloudReceipts = response.receipts;
            refresh();
          })
          .catch(() => { if (active) setHistoryError('El historial Cloud no está disponible. Las recepciones locales siguen visibles.'); });
      }
    }
    return () => { active = false; };
  }, [batchManaged, medicine, product?.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current || blocked) return;
    submittingRef.current = true;
    setSaving(true);
    setError('');
    if (!operationIdRef.current) {
      operationIdRef.current = generateIdempotencyKey({
        prefix: 'inventory-entry', entityType: SYNC_ENTITY_TYPES.INVENTORY_ENTRY,
        operation: SYNC_OPERATIONS.INVENTORY_ENTRY, entityId: product.id
      });
    }
    try {
      const acquired = acquiredAt || null;
      const batchManufacturer = selectedBatch?.manufacturerBatchId || manufacturerBatchId.trim();
      const batchExpiry = selectedBatch?.expiryDate || expiryDate;
      const receivedAt = new Date(occurredAt).toISOString();
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
      if (result?.success) {
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
            {special ? inventoryEntryErrors.PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE
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
          <div className="form-group"><label htmlFor="inventory-entry-date">Fecha y hora de recepción</label>
            <input id="inventory-entry-date" type="datetime-local" value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)} required /></div>
          <div className="ui-alert ui-alert--info">
            Existencia actual: <strong>{product.stock ?? 0} {unit}</strong>
            {' · '}Entrada: <strong>+{Number(quantity) || 0} {unit}</strong>
            {' · '}Total estimado: <strong>{nextStock} {unit}</strong>
          </div>
          {medicine && <section aria-label="Últimas recepciones documentadas">
            <h4>Últimas recepciones documentadas</h4>
            {history.length === 0 && <small>No hay recepciones documentadas recuperadas.</small>}
            {history.map((item) => (
              <p key={item.operationId}>
                {day(item.receivedAt)} · +{item.quantity} {unit} ·
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
          <button type="submit" className="ui-button ui-button--primary" disabled={saving || blocked}>
            {saving ? 'Guardando…' : medicine ? 'Confirmar recepción' : 'Agregar existencia'}
          </button>
        </div>
      </form>
    </div>
  );
}
