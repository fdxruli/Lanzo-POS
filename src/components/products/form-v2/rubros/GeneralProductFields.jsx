import ProductExpirationFields from '../components/ProductExpirationFields';
import { isCanonicalProductUnit, PRODUCT_SALE_UNITS } from '../../../../utils/productUnitConfiguration';

export default function GeneralProductFields({ values, errors, onFieldChange, onExpirationMode }) {
  return <><div className="product-form-v2__field"><label htmlFor="product-v2-general-unit">Unidad de venta</label><select id="product-v2-general-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>{values.unit && !isCanonicalProductUnit(values.unit) && <option value={values.unit}>Unidad anterior: {values.unit}</option>}{PRODUCT_SALE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div><ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} /></>;
}
