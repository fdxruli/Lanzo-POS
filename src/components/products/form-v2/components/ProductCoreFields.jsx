import { ScanLine } from 'lucide-react';
import { getProductUnitName } from '../../../../utils/productUnitConfiguration';

const Error = ({ children }) => children ? <small className="product-form-v2__error">{children}</small> : null;

export default function ProductCoreFields({ values, errors, onFieldChange, onCostChange, onPriceChange, onMarginChange, onScan, barcodeMatches = [], barcodeLookupFailed = false, cloudBarcodeConflict = false, onEditExisting, isIngredient = false, saleSetup = null }) {
  const isFractioned = values.saleMode === 'fractioned' || values.conversionFactor?.enabled === true;
  const unitName = getProductUnitName(values.unit);
  const costLabel = `Costo por ${unitName}`;
  const priceLabel = `Precio de venta por ${unitName}`;
  return <section className="product-form-v2__core" aria-label="Datos principales">
    <div className="product-form-v2__field product-form-v2__field--wide">
      <label htmlFor="product-v2-name">Nombre del producto <span aria-hidden="true">*</span></label>
      <input id="product-v2-name" value={values.name} onChange={(event) => onFieldChange('name', event.target.value)} aria-invalid={Boolean(errors.name)} autoComplete="off" />
      <Error>{errors.name}</Error>
    </div>
    <div className="product-form-v2__field product-form-v2__barcode product-form-v2__field--wide">
      <label htmlFor="product-v2-barcode">Código de barras</label>
      <div><input id="product-v2-barcode" data-scanner-physical-capture="true" aria-invalid={Boolean(errors.barcode || barcodeMatches.length || cloudBarcodeConflict)} aria-describedby={barcodeMatches.length || cloudBarcodeConflict || barcodeLookupFailed ? 'product-v2-barcode-warning' : undefined} value={values.barcode} onChange={(event) => onFieldChange('barcode', event.target.value)} inputMode="numeric" /><button type="button" onClick={onScan} aria-label="Escanear código de barras"><ScanLine size={18} aria-hidden="true" /></button></div>
      {barcodeMatches.length > 0 && <aside id="product-v2-barcode-warning" className="product-form-v2__barcode-warning" role="status">
        <strong>Este código de barras ya está registrado.</strong>
        {barcodeMatches.map((product) => <section key={product.id} className="product-form-v2__barcode-match">
          <p><strong>{product.name || 'Producto sin nombre'}</strong> · {product.isActive === false ? 'Inactivo' : 'Activo'}</p>
          <small>Código: {product.barcode}{product.trackStock !== false ? ` · Stock: ${product.stock ?? 0}` : ' · Sin control de stock'}</small>
          <div className="product-form-v2__barcode-actions">
            <details><summary>Ver producto</summary><p>Precio: {product.price ?? 0}{product.sku ? ` · SKU: ${product.sku}` : ''}</p></details>
            {onEditExisting && <button type="button" onClick={() => onEditExisting(product)}>Editar existente</button>}
            <button type="button" onClick={() => document.getElementById('product-v2-barcode')?.select()}>Cambiar código</button>
          </div>
        </section>)}
      </aside>}
      {!barcodeMatches.length && cloudBarcodeConflict && <small id="product-v2-barcode-warning" className="product-form-v2__error" role="alert">Cloud rechazó la operación por un código de barras o SKU duplicado en el catálogo remoto. Sincroniza el catálogo antes de volver a intentarlo.</small>}
      {!barcodeMatches.length && !cloudBarcodeConflict && barcodeLookupFailed && <small id="product-v2-barcode-warning" className="product-form-v2__error" role="alert">No se pudo comprobar el código local. El guardado volverá a comprobarlo.</small>}
      <Error>{errors.barcode}</Error>
    </div>
    {saleSetup && <div className="product-form-v2__primary-sale-setup">{saleSetup}</div>}
    <div className={`product-form-v2__pricing${isFractioned ? ' product-form-v2__pricing--fractioned' : ''}${isIngredient ? ' product-form-v2__pricing--ingredient' : ''}`}>
      {!isFractioned && <div className="product-form-v2__field product-form-v2__field--cost"><label htmlFor="product-v2-cost">{costLabel}</label><input id="product-v2-cost" type="number" min="0" step="0.01" value={values.cost} onChange={(event) => onCostChange(event.target.value)} aria-invalid={Boolean(errors.cost)} /><Error>{errors.cost}</Error></div>}
      {isIngredient ? <p className="product-form-v2__help">El costo del insumo se utiliza para calcular el costo de las recetas.</p> : <><div className="product-form-v2__field product-form-v2__field--margin"><label htmlFor="product-v2-margin">Margen</label><div className="product-form-v2__suffix"><input id="product-v2-margin" type="number" min="0" step="0.1" value={values.margin} onChange={(event) => onMarginChange(event.target.value)} /><span>%</span></div></div><div className="product-form-v2__field product-form-v2__field--price"><label htmlFor="product-v2-price">{priceLabel} <span aria-hidden="true">*</span></label><input id="product-v2-price" type="number" min="0" step="0.01" value={values.price} onChange={(event) => onPriceChange(event.target.value)} aria-invalid={Boolean(errors.price)} /><Error>{errors.price}</Error></div></>}
    </div>
  </section>;
}
