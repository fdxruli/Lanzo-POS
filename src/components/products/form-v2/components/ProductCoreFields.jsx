import { ScanLine } from 'lucide-react';

const Error = ({ children }) => children ? <small className="product-form-v2__error">{children}</small> : null;

export default function ProductCoreFields({ values, errors, onFieldChange, onCostChange, onPriceChange, onMarginChange, onScan, isIngredient = false }) {
  return <section className="product-form-v2__core" aria-label="Datos principales">
    <div className="product-form-v2__field product-form-v2__field--wide">
      <label htmlFor="product-v2-name">Nombre del producto <span aria-hidden="true">*</span></label>
      <input id="product-v2-name" value={values.name} onChange={(event) => onFieldChange('name', event.target.value)} aria-invalid={Boolean(errors.name)} autoComplete="off" />
      <Error>{errors.name}</Error>
    </div>
    <div className="product-form-v2__field product-form-v2__barcode">
      <label htmlFor="product-v2-barcode">Código de barras</label>
      <div><input id="product-v2-barcode" value={values.barcode} onChange={(event) => onFieldChange('barcode', event.target.value)} inputMode="numeric" /><button type="button" onClick={onScan} aria-label="Escanear código de barras"><ScanLine size={18} aria-hidden="true" /></button></div>
    </div>
    <div className="product-form-v2__pricing">
      <div className="product-form-v2__field"><label htmlFor="product-v2-cost">Costo</label><input id="product-v2-cost" type="number" min="0" step="0.01" value={values.cost} onChange={(event) => onCostChange(event.target.value)} aria-invalid={Boolean(errors.cost)} /><Error>{errors.cost}</Error></div>
      {isIngredient ? <p className="product-form-v2__help">El costo del insumo se utiliza para calcular el costo de las recetas.</p> : <><div className="product-form-v2__field"><label htmlFor="product-v2-margin">Margen</label><div className="product-form-v2__suffix"><input id="product-v2-margin" type="number" min="0" step="0.1" value={values.margin} onChange={(event) => onMarginChange(event.target.value)} /><span>%</span></div></div><div className="product-form-v2__field"><label htmlFor="product-v2-price">Precio de venta <span aria-hidden="true">*</span></label><input id="product-v2-price" type="number" min="0" step="0.01" value={values.price} onChange={(event) => onPriceChange(event.target.value)} aria-invalid={Boolean(errors.price)} /><Error>{errors.price}</Error></div></>}
    </div>
  </section>;
}
