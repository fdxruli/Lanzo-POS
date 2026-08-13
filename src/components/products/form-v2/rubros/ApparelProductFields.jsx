import { useCallback } from 'react';
import QuickVariantEntry from '../../QuickVariantEntry';

export default function ApparelProductFields({ values, errors, onFieldChange }) {
  // QuickVariantEntry synchronizes its rows from an effect. Keep this callback
  // stable so a parent re-render is not interpreted as a row change.
  const handleVariantsChange = useCallback(
    (quickVariants) => onFieldChange('quickVariants', quickVariants),
    [onFieldChange]
  );

  return <>
    <div className="product-form-v2__toggle product-form-v2__toggle--compact">
      <input id="product-v2-has-variants" className="product-form-v2__toggle-input" type="checkbox" checked={values.hasVariants} onChange={(event) => onFieldChange('hasVariants', event.target.checked)} aria-labelledby="product-v2-has-variants-label" />
      <label className="product-form-v2__toggle-control" htmlFor="product-v2-has-variants"><span /></label>
      <div id="product-v2-has-variants-label" className="product-form-v2__toggle-copy"><strong>¿El producto tiene variantes?</strong><small>Activa tallas, colores y existencias por combinación.</small></div>
    </div>
    {values.hasVariants ? <>
      <p className="product-form-v2__help">La existencia total se calcula desde las combinaciones activas. Para variantes existentes, ajusta existencias desde inventario o lotes.</p>
      <QuickVariantEntry basePrice={values.price} baseCost={values.cost} initialData={values.quickVariants} onVariantsChange={handleVariantsChange} />
      {errors.quickVariants && <small className="product-form-v2__error">{errors.quickVariants}</small>}
    </> : <p className="product-form-v2__help">Mantén un producto simple con una existencia general.</p>}
  </>;
}
