import ProductExpirationFields from '../components/ProductExpirationFields';
import { BULK_SALE_UNITS, isCanonicalProductUnit, PRODUCT_SALE_UNITS } from '../../../../utils/productUnitConfiguration';

export default function ProduceProductFields({ values, errors, onFieldChange, onExpirationMode }) {
  const saleUnits = values.saleType === 'bulk' ? BULK_SALE_UNITS : PRODUCT_SALE_UNITS;
  return <>
    <div className="product-form-v2__segmented" role="group" aria-label="Unidad de venta"><button type="button" className={values.saleType === 'unit' ? 'is-active' : ''} onClick={() => onFieldChange('saleType', 'unit')}>Por pieza</button><button type="button" className={values.saleType === 'bulk' ? 'is-active' : ''} onClick={() => onFieldChange('saleType', 'bulk')}>Por peso</button></div>
    <div className="product-form-v2__field"><label htmlFor="product-v2-produce-unit">Unidad</label><select id="product-v2-produce-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>{values.unit && !isCanonicalProductUnit(values.unit) && <option value={values.unit}>Unidad anterior: {values.unit}</option>}{saleUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div>
    <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} />
  </>;
}
