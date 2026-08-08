import ProductBatchSummary from '../components/ProductBatchSummary';
import ProductExpirationFields from '../components/ProductExpirationFields';
import {
  BULK_SALE_UNITS,
  isCanonicalProductUnit,
  isCanonicalPurchaseUnit,
  PRODUCT_SALE_UNITS,
  PURCHASE_UNITS
} from '../../../../utils/productUnitConfiguration';

const saleModes = [
  { value: 'unit', label: 'Unidad' },
  { value: 'bulk', label: 'A granel' },
  { value: 'fractioned', label: 'Fraccionado' }
];

const legacyOption = (value, isCanonical) => (
  value && !isCanonical(value)
    ? <option value={value}>Unidad anterior: {value}</option>
    : null
);

export default function GroceryProductFields({
  values,
  errors,
  onFieldChange,
  onSaleMode,
  onExpirationMode,
  isEditing = false,
  productId,
  onOpenBatches,
  onBatchSummary,
  features = {},
  onOpenWholesale
}) {
  const saleMode = values.saleMode || (values.saleType === 'bulk' ? 'bulk' : (values.conversionFactor?.enabled ? 'fractioned' : 'unit'));
  const saleUnits = saleMode === 'bulk' ? BULK_SALE_UNITS : PRODUCT_SALE_UNITS;
  const tierCount = values.wholesaleTiers?.length || 0;

  return <>
    <div className="product-form-v2__segmented" role="group" aria-label="Forma de venta">
      {saleModes.map((mode) => <button key={mode.value} type="button" className={saleMode === mode.value ? 'is-active' : ''} onClick={() => onSaleMode?.(mode.value)}>{mode.label}</button>)}
    </div>
    <div className="product-form-v2__field-grid">
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-unit">Unidad de venta</label>
        <select id="product-v2-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>
          {legacyOption(values.unit, isCanonicalProductUnit)}
          {saleUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </select>
      </div>
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-supplier">Proveedor</label>
        <input id="product-v2-supplier" value={values.supplier} onChange={(event) => onFieldChange('supplier', event.target.value)} />
      </div>
    </div>
    {saleMode === 'fractioned' && <div className="product-form-v2__field-grid">
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-purchase-unit">Unidad de compra</label>
        <select id="product-v2-purchase-unit" value={values.conversionFactor?.purchaseUnit || ''} onChange={(event) => onFieldChange('conversionFactor', { ...values.conversionFactor, enabled: true, purchaseUnit: event.target.value })} aria-invalid={Boolean(errors.purchaseUnit)}>
          <option value="">Selecciona una unidad</option>
          {legacyOption(values.conversionFactor?.purchaseUnit, isCanonicalPurchaseUnit)}
          {PURCHASE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </select>
        {errors.purchaseUnit && <small className="product-form-v2__error">{errors.purchaseUnit}</small>}
      </div>
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-factor">Contenido por compra</label>
        <input id="product-v2-factor" type="number" min="2" value={values.conversionFactor?.factor ?? ''} onChange={(event) => onFieldChange('conversionFactor', { ...values.conversionFactor, enabled: true, factor: event.target.value })} aria-invalid={Boolean(errors.conversionFactor)} />
        {errors.conversionFactor && <small className="product-form-v2__error">{errors.conversionFactor}</small>}
      </div>
    </div>}
    {features.hasWholesale && saleMode !== 'bulk' && <section className="product-form-v2__subsection" aria-label="Precios de mayoreo">
      <div className="product-form-v2__field-grid">
        <div><strong>Precios de mayoreo</strong><p className="product-form-v2__hint">{tierCount ? `${tierCount} nivel${tierCount === 1 ? '' : 'es'} configurado${tierCount === 1 ? '' : 's'}` : 'Sin niveles configurados'}</p></div>
        <div><button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onOpenWholesale}>Configurar mayoreo</button></div>
      </div>
    </section>}
    {isEditing && productId && <ProductBatchSummary productId={productId} onOpenBatches={onOpenBatches} onSummary={onBatchSummary} />}
    <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} isEditing={isEditing} />
  </>;
}
