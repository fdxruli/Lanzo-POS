import { PRODUCE_WEIGHT_SALE_UNITS } from '../../../../utils/productUnitConfiguration';
import ProductTypeSelector from './ProductTypeSelector';

const PRODUCE_SALE_MODE_OPTIONS = [
  { value: 'unit', label: 'Por pieza / unidad' },
  { value: 'bulk', label: 'Por peso' }
];

export default function ProduceSaleSetupFields({ values, onFieldChange, onSaleMode }) {
  const isBulk = values.saleType === 'bulk';

  return <section className="product-form-v2__produce-sale-setup" aria-label="Modo de venta">
    <ProductTypeSelector
      title="¿Cómo vendes este producto?"
      options={PRODUCE_SALE_MODE_OPTIONS}
      value={isBulk ? 'bulk' : 'unit'}
      onChange={onSaleMode}
    />
    {isBulk ? <div className="product-form-v2__field product-form-v2__field--compact">
      <label htmlFor="product-v2-produce-unit">Unidad de venta</label>
      <select id="product-v2-produce-unit" value={values.unit} onChange={(event) => onFieldChange('unit', event.target.value)}>
        {PRODUCE_WEIGHT_SALE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
      </select>
    </div> : <p className="product-form-v2__help">Se venderá por pieza o unidad.</p>}
  </section>;
}
