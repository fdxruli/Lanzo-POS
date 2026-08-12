import { useEffect, useMemo, useState } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { addInventoryEntry, inventoryEntryErrors } from '../../services/inventory/inventoryEntryService';
import { resolveProductSaleUnit } from '../../utils/productUnitConfiguration';

const toDateTimeLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function InventoryEntryModal({ product, onClose, onCompleted }) {
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal);
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const unit = resolveProductSaleUnit(product) || 'pza';
  const batchManaged = product?.batchManagement?.enabled === true;
  const nextStock = useMemo(() => Number(product?.stock || 0) + (Number(quantity) || 0), [product?.stock, quantity]);

  useEffect(() => {
    let active = true;
    if (!batchManaged) return undefined;
    db.table(STORES.PRODUCT_BATCHES).where('productId').equals(product.id).toArray()
      .then((items) => {
        if (!active) return;
        const usable = items.filter((item) => item.isActive !== false && item.status !== 'archived');
        setBatches(usable);
        if (usable.length === 1) setBatchId(usable[0].id);
      })
      .catch(() => active && setBatches([]));
    return () => { active = false; };
  }, [batchManaged, product?.id]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await addInventoryEntry({
        productId: product.id, batchId: batchId || null, quantity, baseQuantity: quantity,
        inputUnit: unit, baseUnit: unit, unitCost: unitCost === '' ? null : unitCost,
        supplier, occurredAt: new Date(occurredAt).toISOString(), entryKind: 'restock'
      });
      await onCompleted?.();
      onClose();
    } catch (cause) {
      setError(inventoryEntryErrors[cause?.code] || 'No se pudo registrar la entrada. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <form className="modal-content" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="inventory-entry-title">
        <div className="modal-header"><h3 id="inventory-entry-title">Agregar existencia</h3><button type="button" className="close-button" onClick={onClose} aria-label="Cerrar">×</button></div>
        <div className="modal-body">
          <p><strong>{product.name}</strong></p>
          <div className="form-group"><label htmlFor="inventory-entry-quantity">Cantidad a agregar ({unit})</label><input id="inventory-entry-quantity" type="number" inputMode="decimal" min="0.0001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required autoFocus /></div>
          {batchManaged && batches.length > 0 && <div className="form-group"><label htmlFor="inventory-entry-batch">Lote</label><select id="inventory-entry-batch" value={batchId} onChange={(event) => setBatchId(event.target.value)}><option value="">Crear capa nueva</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.sku || batch.manufacturerBatchId || batch.id} · {batch.stock ?? 0} {unit}</option>)}</select></div>}
          <div className="form-group"><label htmlFor="inventory-entry-cost">Costo unitario (opcional)</label><input id="inventory-entry-cost" type="number" inputMode="decimal" min="0" step="any" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="inventory-entry-supplier">Proveedor (opcional)</label><input id="inventory-entry-supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="inventory-entry-date">Fecha y hora</label><input id="inventory-entry-date" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></div>
          <div className="ui-alert ui-alert--info">Existencia actual: <strong>{product.stock ?? 0}</strong><br />Entrada: <strong>+{Number(quantity) || 0}</strong><br />Nueva existencia: <strong>{nextStock}</strong></div>
          {error && <div className="ui-alert ui-alert--danger" role="alert">{error}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="ui-button ui-button--ghost" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="ui-button ui-button--primary" disabled={saving}>{saving ? 'Agregando…' : 'Agregar existencia'}</button></div>
      </form>
    </div>
  );
}
