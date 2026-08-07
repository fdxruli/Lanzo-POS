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
    <label className="product-form-v2__checkbox">
      <input type="checkbox" checked={values.hasVariants} onChange={(event) => onFieldChange('hasVariants', event.target.checked)} /> ¿El producto tiene variantes?
    </label>
    {values.hasVariants ? <>
      <p className="product-form-v2__help">La existencia total se calcula desde las combinaciones activas.</p>
      <QuickVariantEntry basePrice={values.price} baseCost={values.cost} initialData={values.quickVariants} onVariantsChange={handleVariantsChange} />
      {errors.quickVariants && <small className="product-form-v2__error">{errors.quickVariants}</small>}
    </> : <p className="product-form-v2__help">Mantén un producto simple con una existencia general.</p>}
  </>;
}
