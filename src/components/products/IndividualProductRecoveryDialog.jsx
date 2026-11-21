import { useEffect, useState } from 'react';
import { productIndividualRecoveryService } from '../../services/products/productIndividualRecoveryService';
import './IndividualProductRecoveryDialog.css';

const localStatusLabel = (value) => ({
  local: 'No sincronizado',
  pending: 'Pendiente',
  conflict: 'Conflicto',
  error: 'Error de sincronización',
  synced: 'Sincronizado'
}[value] || 'No sincronizado');

const formatQuantity = (value) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(Number(value || 0));
const hasValue = (value) => value !== undefined && value !== null && value !== '';
const formatAttributes = (attributes) => {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null;
  return Object.entries(attributes).map(([key, value]) => (
    `${key}: ${value && typeof value === 'object' ? JSON.stringify(value) : String(value)}`
  )).join(' · ');
};

export default function IndividualProductRecoveryDialog({ product, onClose }) {
  const [report, setReport] = useState(null);
  const [operationResult, setOperationResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const verify = async () => {
    setLoading(true);
    setOperationResult(null);
    const nextReport = await productIndividualRecoveryService.inspectProduct({ productId: product.id });
    setReport(nextReport);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    productIndividualRecoveryService.inspectProduct({ productId: product.id }).then((nextReport) => {
      if (!active) return;
      setReport(nextReport);
      setLoading(false);
    });
    return () => { active = false; };
  }, [product.id]);

  const handleRecover = async () => {
    if (!report?.canRecover || saving) return;
    setSaving(true);
    const result = await productIndividualRecoveryService.recoverProduct({ productId: product.id });
    setOperationResult(result);
    if (result?.success) {
      const nextReport = await productIndividualRecoveryService.inspectProduct({ productId: product.id });
      setReport(nextReport);
    }
    setSaving(false);
  };

  const handleRefresh = async () => {
    if (loading || saving) return;
    await verify();
  };

  return (
    <div className="ui-modal ui-modal--high individual-recovery-overlay" role="presentation">
      <section
        className="ui-modal__content individual-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="individual-recovery-title"
        aria-describedby="individual-recovery-description"
      >
        <header className="individual-recovery-dialog__header">
          <div>
            <h2 id="individual-recovery-title">Recuperación individual</h2>
            <p id="individual-recovery-description">Primero verificamos el catálogo original y, si existe un portal, su publicación. La verificación no escribe datos.</p>
          </div>
          <button type="button" className="individual-recovery-dialog__close" onClick={onClose} disabled={saving} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="individual-recovery-dialog__body">
          <section className="individual-recovery-product">
            <h3>{report?.product?.name || product.name}</h3>
            <p>ID original: <code>{product.id}</code></p>
            {report?.product && (
              <div className="individual-recovery-facts">
                <span>Local: {report.product.active ? 'Activo' : 'Inactivo'} · {localStatusLabel(report.product.localStatus)}</span>
                <span>Cloud: {report.cloud.product === 'missing' ? 'Sin fuente con este ID' : report.cloud.product === 'verified' ? 'Producto y lotes coinciden' : 'Requiere conciliación'}</span>
                <span>Existencia local: {formatQuantity(report.product.stock)} · comprometido: {formatQuantity(report.product.committedStock)}</span>
                {hasValue(report.product.cost) && <span>Costo local: {formatQuantity(report.product.cost)}</span>}
                {hasValue(report.product.price) && <span>Precio local: {formatQuantity(report.product.price)}</span>}
                <span>Controla inventario: {report.product.trackStock ? 'Sí' : 'No'}</span>
                {hasValue(report.product.productType) && <span>Tipo de producto: {report.product.productType}</span>}
                {hasValue(report.product.sku) && <span>SKU: {report.product.sku}</span>}
                {hasValue(report.product.barcode) && <span>Código de barras: {report.product.barcode}</span>}
                {hasValue(report.product.rubroContext) && <span>Contexto histórico del producto: {report.product.rubroContext}</span>}
                {hasValue(report.product.expirationMode) && <span>Modo de caducidad registrado: {report.product.expirationMode}</span>}
                <span>Categoría: {report.product.references?.category
                  ? `${report.product.references.category.name || report.product.references.category.id} · ID ${report.product.references.category.id} · local ${report.product.references.category.local} · Cloud ${report.product.references.category.cloud}${report.product.references.category.action === 'create_with_original_id' ? ' · se creará con el ID original' : ''}`
                  : 'Sin categoría'}</span>
                {report.product.references?.recipe?.length > 0 && (
                  <span>Referencias de receta: {report.product.references.recipe.map((item) => (
                    `${item.name || item.id} · local ${item.local} · Cloud ${item.cloud}`
                  )).join('; ')}</span>
                )}
                <span>Clasificación: {report.product.pharmacy.recorded ? `${report.product.pharmacy.kind} · ${report.product.pharmacy.status}` : 'Sin clasificación farmacéutica registrada'}</span>
                <span>Portal: {report.portal?.verified === false ? 'No se pudo confirmar; la revisión del catálogo Cloud continúa y la recuperación queda bloqueada' : report.portal?.exists === false ? 'No existe; la revisión del catálogo Cloud continúa de forma independiente' : 'Existe'}</span>
                {report.portal?.exists === true && <span>Publicación: {report.publication
                  ? `${report.publication.sourceType} · ${report.publication.isPublished ? 'publicada' : 'no publicada'} · ${report.publication.isAvailable ? 'disponible' : 'no disponible'}`
                  : 'No se confirmó una relación exacta'}</span>}
              </div>
            )}
          </section>

          {loading && <p className="individual-recovery-state" role="status">Leyendo el catálogo local de esta sesión y comprobando Cloud…</p>}

          {!loading && report?.batches?.length > 0 && (
            <section className="individual-recovery-section" aria-labelledby="individual-recovery-batches-title">
              <h3 id="individual-recovery-batches-title">Lotes locales</h3>
              <ul className="individual-recovery-batches">
                {report.batches.map((batch) => (
                  <li key={batch.id}>
                    <div>
                      <strong>{batch.label}</strong>
                      <span>ID original {batch.id} · producto padre {batch.productId}{batch.sku ? ` · SKU ${batch.sku}` : ''}{batch.manufacturerBatchId ? ` · lote fabricante ${batch.manufacturerBatchId}` : ''}</span>
                      {formatAttributes(batch.attributes) && <span>Atributos: {formatAttributes(batch.attributes)}</span>}
                      {hasValue(batch.expiryDate) && <span>Caducidad registrada: {batch.expiryDate}</span>}
                      {hasValue(batch.cost) && <span>Costo: {formatQuantity(batch.cost)} · precio: {formatQuantity(batch.price)}</span>}
                      <span>{batch.status === 'archived' ? 'Archivado · se conserva local' : `Estado ${batch.status} · ${batch.cloudStatus === 'absent' ? 'sin lote Cloud' : `Cloud ${batch.cloudStatus}`}`}</span>
                    </div>
                    <span>{formatQuantity(batch.stock)} · comprometido {formatQuantity(batch.committedStock)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && report?.issues?.length > 0 && (
            <section className="individual-recovery-blockers" aria-labelledby="individual-recovery-blockers-title">
              <h3 id="individual-recovery-blockers-title">Bloqueos comprobados</h3>
              {report.retryable && (
                <p>La lectura se detuvo de forma segura. Reintentar vuelve a comprobar el negocio y no modifica productos, lotes ni inventario.</p>
              )}
              <ul>
                {report.issues.map((issue, index) => <li key={`${issue.code}-${issue.entityId || index}`}><strong>[{issue.code}]</strong> {issue.message}</li>)}
              </ul>
            </section>
          )}

          {!loading && report?.canRecover && (
            <div className="individual-recovery-ready" role="status">
              Se recuperará solo este producto y sus lotes no archivados. Se conservarán los IDs originales. Si falta su categoría en Cloud, se confirmará con el ID local antes de escribir el producto. Los lotes archivados o tombstones no se enviarán.
            </div>
          )}

          {operationResult && (
            <div className={`individual-recovery-result${operationResult.success ? ' is-success' : ' is-warning'}`} role="status">
              <strong>{operationResult.success ? 'Recuperación verificada' : operationResult.uncertain ? 'Resultado incierto · HOLD' : 'Recuperación detenida'}</strong>
              <span>{operationResult.message || operationResult.report?.issues?.map((issue) => issue.message).join(' ') || 'Revisa el estado y vuelve a verificar antes de reintentar.'}</span>
              {operationResult.uncertain && <span>Vuelve a verificar el producto y sus lotes en Cloud antes de cualquier otro intento.</span>}
            </div>
          )}
        </div>

        <footer className="individual-recovery-dialog__actions">
          <button type="button" className="ui-button ui-button--ghost" onClick={onClose} disabled={saving}>Cerrar</button>
          <button type="button" className="ui-button ui-button--neutral" onClick={handleRefresh} disabled={loading || saving}>
            {report?.retryable ? 'Reintentar verificación' : 'Volver a verificar'}
          </button>
          {report?.canRecover && !operationResult && (
            <button type="button" className="ui-button ui-button--primary" onClick={handleRecover} disabled={saving || loading}>
              {saving ? 'Recuperando…' : 'Confirmar recuperación'}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
