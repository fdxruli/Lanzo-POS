import {
  BULK_SALE_UNITS,
  getProductUnitName,
  isCanonicalProductUnit,
  isCanonicalPurchaseUnit,
  PRODUCT_SALE_UNITS,
  PURCHASE_UNITS
} from '../../../../utils/productUnitConfiguration';
import { calculateFractionedUnitCost, calculateSaleMargin } from '../domain/fractionedPricing';

const legacyOption = (value, isCanonical) => (
  value && !isCanonical(value)
    ? <option value={value}>Unidad anterior: {value}</option>
    : null
);

const purchaseUnitLabel = (unit) => (
  PURCHASE_UNITS.find((option) => option.value === unit)?.label || 'presentación de compra'
);

export default function GrocerySaleSetupFields({ values, errors, onFieldChange }) {
  const saleMode = values.saleMode || (values.saleType === 'bulk' ? 'bulk' : (values.conversionFactor?.enabled ? 'fractioned' : 'unit'));
  const saleUnits = saleMode === 'bulk' ? BULK_SALE_UNITS : PRODUCT_SALE_UNITS;
  const purchaseUnit = values.conversionFactor?.purchaseUnit || '';
  const factor = values.conversionFactor?.factor ?? '';
  const purchaseCost = values.conversionFactor?.purchaseCost ?? '';
  const saleUnitName = getProductUnitName(values.unit);
  const unitCost = calculateFractionedUnitCost({ purchaseCost, factor });
  const margin = calculateSaleMargin({ cost: unitCost, price: values.price });
  const setConversion = (field, value) => onFieldChange('conversionFactor', {
    ...values.conversionFactor,
    enabled: true,
    [field]: value
  });

  if (saleMode !== 'fractioned') {
    return <section className="product-form-v2__sale-setup">
      <div className="product-form-v2__field product-form-v2__field--compact">
        <label htmlFor="product-v2-unit">Unidad de venta</label>
        <select id="product-v2-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>
          {legacyOption(values.unit, isCanonicalProductUnit)}
          {saleUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </select>
      </div>
    </section>;
  }

  return <section className="product-form-v2__fractioned" aria-label="Configuración de producto fraccionado">
    <p className="product-form-v2__fractioned-intro">Compras este producto en una presentación y lo vendes en unidades más pequeñas. Ejemplo: compras una caja con 12 piezas y vendes cada pieza.</p>
    {!values.conversionFactor?.purchaseCost && values.id && <p className="product-form-v2__legacy-notice" role="status"><strong>Costo de compra no registrado.</strong> Agrega el costo de la caja para que Lanzo calcule automáticamente el costo por pieza.</p>}
    <div className="product-form-v2__fractioned-group">
      <h3>¿Cómo lo compras?</h3>
      <div className="product-form-v2__field-grid product-form-v2__field-grid--three">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-purchase-unit">Unidad de compra</label>
          <select id="product-v2-purchase-unit" value={purchaseUnit} onChange={(event) => setConversion('purchaseUnit', event.target.value)} aria-invalid={Boolean(errors.purchaseUnit)}>
            <option value="">Selecciona una unidad</option>
            {legacyOption(purchaseUnit, isCanonicalPurchaseUnit)}
            {PURCHASE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
          {errors.purchaseUnit && <small className="product-form-v2__error">{errors.purchaseUnit}</small>}
        </div>
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-factor">Contenido por {purchaseUnitLabel(purchaseUnit).toLowerCase()}</label>
          <div className="product-form-v2__suffix"><input id="product-v2-factor" type="number" min="2" value={factor} onChange={(event) => setConversion('factor', event.target.value)} aria-invalid={Boolean(errors.conversionFactor)} /><span>{saleUnitName}s</span></div>
          {errors.conversionFactor && <small className="product-form-v2__error">{errors.conversionFactor}</small>}
        </div>
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-purchase-cost">Costo de la {purchaseUnitLabel(purchaseUnit).toLowerCase()}</label>
          <input id="product-v2-purchase-cost" type="number" min="0" step="0.01" value={purchaseCost} onChange={(event) => setConversion('purchaseCost', event.target.value)} aria-invalid={Boolean(errors.purchaseCost)} />
          {errors.purchaseCost && <small className="product-form-v2__error">{errors.purchaseCost}</small>}
        </div>
      </div>
    </div>
    <div className="product-form-v2__fractioned-group">
      <h3>¿Cómo lo vendes?</h3>
      <div className="product-form-v2__field-grid">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-unit">Unidad de venta</label>
          <select id="product-v2-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>
            {legacyOption(values.unit, isCanonicalProductUnit)}
            {PRODUCT_SALE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
        </div>
        <div className="product-form-v2__field">
          <label>Costo calculado por {saleUnitName}</label>
          <output className="product-form-v2__readonly-price">${unitCost.toFixed(2)}</output>
        </div>
      </div>
    </div>
    {unitCost > 0 && Number(values.price) > 0 && <div className="product-form-v2__fractioned-summary" role="status">
      <strong>Resumen</strong>
      <span>Compras: 1 {purchaseUnitLabel(purchaseUnit).toLowerCase()} = {factor} {saleUnitName}s por ${Number(purchaseCost).toFixed(2)}</span>
      <span>Vendes: cada {saleUnitName} a ${Number(values.price).toFixed(2)} · Ganancia estimada: ${(Number(values.price) - unitCost).toFixed(2)} por {saleUnitName} · Margen: {margin.toFixed(2)}%</span>
    </div>}
  </section>;
}
