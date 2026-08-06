export default function ProductInventoryFields({ values, errors, onTrackStock, onFieldChange }) {
  return <section className="product-form-v2__inventory" aria-label="Inventario inicial">
    <label className="product-form-v2__toggle"><input type="checkbox" checked={values.trackStock} onChange={(event) => onTrackStock(event.target.checked)} /><span aria-hidden="true" /><span><strong>Controlar inventario</strong><small>Registra existencias y alertas para este producto.</small></span></label>
    {values.trackStock && <div className="product-form-v2__inventory-fields">
      <div className="product-form-v2__field"><label htmlFor="product-v2-stock">Existencia inicial</label><input id="product-v2-stock" type="number" min="0" step="any" value={values.stock} onChange={(event) => onFieldChange('stock', event.target.value)} aria-invalid={Boolean(errors.stock)} />{errors.stock && <small className="product-form-v2__error">{errors.stock}</small>}</div>
      <div className="product-form-v2__field"><label htmlFor="product-v2-min-stock">Alerta de stock bajo</label><input id="product-v2-min-stock" type="number" min="0" step="any" value={values.minStock} onChange={(event) => onFieldChange('minStock', event.target.value)} aria-invalid={Boolean(errors.minStock)} />{errors.minStock && <small className="product-form-v2__error">{errors.minStock}</small>}</div>
    </div>}
  </section>;
}
