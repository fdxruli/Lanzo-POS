import { getProductUnitShortLabel } from '../../../../utils/productUnitConfiguration';

export default function ProductInventoryFields({ values, errors, onTrackStock, onFieldChange, isEditing = false }) {
  const unit = getProductUnitShortLabel(values.unit);
  const isFractioned = values.saleMode === 'fractioned' || values.conversionFactor?.enabled === true;
  const stockLabel = `${isEditing ? 'Existencia actual' : 'Existencia inicial'} (${unit})`;
  return <section className="product-form-v2__inventory" aria-label="Inventario inicial">
    <div className="product-form-v2__toggle">
      <input id="product-v2-track-stock" type="checkbox" checked={values.trackStock} onChange={(event) => onTrackStock(event.target.checked)} aria-labelledby="product-v2-track-stock-label" />
      <label className="product-form-v2__toggle-control" htmlFor="product-v2-track-stock" aria-hidden="true"><span /></label>
      <div id="product-v2-track-stock-label"><strong>Controlar inventario</strong><small>Registra existencias y alertas para este producto.</small></div>
    </div>
    {values.trackStock && <div className="product-form-v2__inventory-fields">
      <div className="product-form-v2__field"><label htmlFor="product-v2-stock">{stockLabel}</label>{isEditing ? <><output id="product-v2-stock">{values.stock} {unit}</output><small className="product-form-v2__help">Las nuevas entradas se administran mediante existencias o lotes.</small></> : <><input id="product-v2-stock" type="number" min="0" step="any" value={values.stock} onChange={(event) => onFieldChange('stock', event.target.value)} aria-invalid={Boolean(errors.stock)} />{errors.stock && <small className="product-form-v2__error">{errors.stock}</small>}{isFractioned && <small className="product-form-v2__help">Registra las unidades disponibles para vender. Ejemplo: 2 cajas de 12 = 24 piezas.</small>}</>}</div>
      <div className="product-form-v2__field"><label htmlFor="product-v2-min-stock">Alerta de stock bajo</label><input id="product-v2-min-stock" type="number" min="0" step="any" value={values.minStock} onChange={(event) => onFieldChange('minStock', event.target.value)} aria-invalid={Boolean(errors.minStock)} />{errors.minStock && <small className="product-form-v2__error">{errors.minStock}</small>}</div>
    </div>}
  </section>;
}
