import ProductExpirationFields from '../components/ProductExpirationFields';
import ProductBatchSummary from '../components/ProductBatchSummary';
import { SANITARY_FRACTIONS } from '../../../../utils/pharmacyClassification';
import {
  PHARMACY_DOSAGE_FORMS,
  PHARMACY_PACKAGE_CONTENT_UNITS,
  PHARMACY_PACKAGE_TYPES
} from '../../../../services/pharmacy/pharmacyCatalog';
import PharmacyCompositionEditor from './PharmacyCompositionEditor';

const prescriptionSummary = (values) => {
  if (values.pharmacyKind === 'other') return 'No aplica a este producto de farmacia.';
  const fraction = values.sanitaryFraction;
  if (!fraction) return 'Clasificación sanitaria pendiente de confirmar. No se habilitará una nueva venta libre.';
  if (['I', 'II', 'III'].includes(fraction)) return 'Control especial: registro de catálogo solamente. Dispensación genérica bloqueada.';
  if (fraction === 'IV' || values.isAntibiotic) return values.isAntibiotic
    ? 'Requiere receta médica y controles adicionales de antibióticos.'
    : 'Requiere receta médica.';
  return 'No requiere receta por la fracción seleccionada.';
};

export default function PharmacyProductFields({
  values, errors, onFieldChange, onCompositionChange, onExpirationMode, isEditing, productId, onOpenBatches
}) {
  const hasStructuredComposition = Array.isArray(values.compositionIngredients) && values.compositionIngredients.length > 0;
  const field = (name, label, placeholder = '') => (
    <div className="product-form-v2__field" key={name}>
      <label htmlFor={`product-v2-${name}`}>{label}</label>
      <input id={`product-v2-${name}`} value={values[name] || ''} placeholder={placeholder}
        onChange={(event) => onFieldChange(name, event.target.value)} />
      {errors[name] && <small className="product-form-v2__error">{errors[name]}</small>}
    </div>
  );
  return <>
    <div className="product-form-v2__subsection">
      <h4>Identificación farmacéutica</h4>
      <div className="product-form-v2__field-grid">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-pharmacyKind">Tipo de artículo</label>
          <select id="product-v2-pharmacyKind" value={values.pharmacyKind}
            aria-invalid={Boolean(errors.pharmacyKind)}
            onChange={(event) => onFieldChange('pharmacyKind', event.target.value)}>
            <option value="">Selecciona el tipo de artículo</option>
            <option value="medicine">Medicamento</option>
            <option value="other">Otro producto de farmacia</option>
          </select>
          {errors.pharmacyKind && <small className="product-form-v2__error">{errors.pharmacyKind}</small>}
        </div>
        {values.pharmacyKind === 'medicine' && isEditing && !hasStructuredComposition
          && field('activeSubstance', 'Sustancia activa (dato anterior)')}
        {values.pharmacyKind === 'medicine' && isEditing && !hasStructuredComposition
          && field('concentration', 'Concentración (dato anterior)')}
        {values.pharmacyKind === 'medicine' && <div className="product-form-v2__field">
          <label htmlFor="product-v2-dosageFormCode">Forma farmacéutica</label>
          <select id="product-v2-dosageFormCode" value={values.dosageFormCode || ''}
            aria-invalid={Boolean(errors.dosageFormCode)}
            onChange={(event) => onFieldChange('dosageFormCode', event.target.value)}>
            <option value="">Selecciona una forma farmacéutica</option>
            {PHARMACY_DOSAGE_FORMS.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            {values.dosageFormCode && !PHARMACY_DOSAGE_FORMS.some(({ value }) => value === values.dosageFormCode)
              && <option value={values.dosageFormCode}>Forma guardada: {values.dosageFormCode}</option>}
          </select>
          {errors.dosageFormCode && <small className="product-form-v2__error">{errors.dosageFormCode}</small>}
        </div>}
        {values.pharmacyKind === 'medicine' && isEditing && values.dosageFormCode && values.dosageFormLegacy
          && field('dosageFormLegacy', 'Forma anterior conservada')}
        {values.pharmacyKind === 'medicine' && isEditing && !values.dosageFormCode && values.dosageForm
          && field('dosageForm', 'Forma anterior (texto libre)')}
        {values.pharmacyKind !== 'medicine' && field('presentation', 'Presentación', 'Descripción anterior o comercial')}
        {field('laboratory', 'Laboratorio')}
        {values.pharmacyKind === 'medicine' && field('sanitaryRegistration', 'Registro sanitario (opcional)')}
      </div>
    </div>
    {values.pharmacyKind === 'medicine' && <div className="product-form-v2__subsection pharmacy-commercial-presentation">
      <h4>Presentación comercial</h4>
      <p className="product-form-v2__hint">Describe el envase y su contenido. Esto no modifica la unidad de venta, existencias, costos ni precios.</p>
      <div className="product-form-v2__field-grid">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-packageType">Tipo de envase</label>
          <select id="product-v2-packageType" value={values.packageType || ''}
            aria-invalid={Boolean(errors.commercialPresentation)}
            onChange={(event) => onFieldChange('packageType', event.target.value)}>
            <option value="">Selecciona un envase</option>
            {PHARMACY_PACKAGE_TYPES.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            {values.packageType && !PHARMACY_PACKAGE_TYPES.some(({ value }) => value === values.packageType)
              && <option value={values.packageType}>Envase guardado: {values.packageType}</option>}
          </select>
        </div>
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-packageContentAmount">Contenido</label>
          <input id="product-v2-packageContentAmount" type="number" min="0" step="any"
            value={values.packageContentAmount ?? ''}
            aria-invalid={Boolean(errors.commercialPresentation)}
            onChange={(event) => onFieldChange('packageContentAmount', event.target.value)} />
        </div>
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-packageContentUnit">Unidad del contenido</label>
          <select id="product-v2-packageContentUnit" value={values.packageContentUnit || ''}
            aria-invalid={Boolean(errors.commercialPresentation)}
            onChange={(event) => onFieldChange('packageContentUnit', event.target.value)}>
            <option value="">Selecciona una unidad</option>
            {PHARMACY_PACKAGE_CONTENT_UNITS.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            {values.packageContentUnit && !PHARMACY_PACKAGE_CONTENT_UNITS.some(({ value }) => value === values.packageContentUnit)
              && <option value={values.packageContentUnit}>Unidad guardada: {values.packageContentUnit}</option>}
          </select>
        </div>
      </div>
      {errors.commercialPresentation && <small className="product-form-v2__error" role="alert">{errors.commercialPresentation}</small>}
      {isEditing && <div className="product-form-v2__field">
        <label htmlFor="product-v2-presentationLegacy">Descripción anterior (texto libre)</label>
        <input id="product-v2-presentationLegacy" value={values.presentationLegacy || ''}
          placeholder="Se conserva como referencia histórica"
          onChange={(event) => onFieldChange('presentationLegacy', event.target.value)} />
      </div>}
    </div>}
    {values.pharmacyKind === 'medicine' && <PharmacyCompositionEditor values={values} onCompositionChange={onCompositionChange} validationError={errors.compositionIngredients} />}
    {values.pharmacyKind === 'medicine' && <div className="product-form-v2__subsection">
      <h4>Control sanitario</h4>
      <div className="product-form-v2__field-grid">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-sanitaryFraction">Fracción sanitaria (art. 226 LGS)</label>
          <select id="product-v2-sanitaryFraction" aria-invalid={Boolean(errors.sanitaryFraction)}
            value={values.sanitaryFraction || ''}
            onChange={(event) => onFieldChange('sanitaryFraction', event.target.value)}>
            <option value="">Pendiente de confirmar</option>
            {SANITARY_FRACTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
          {errors.sanitaryFraction && <small className="product-form-v2__error">{errors.sanitaryFraction}</small>}
        </div>
        <div className="product-form-v2__field">
          <label>Estado de clasificación</label>
          <output className="product-form-v2__readonly-price">
            {values.sanitaryFraction ? 'Confirmada por el operador' : 'Pendiente de revisión'}
          </output>
        </div>
      </div>
      <label className="product-form-v2__checkbox">
        <input type="checkbox" checked={Boolean(values.isAntibiotic)}
          onChange={(event) => onFieldChange('isAntibiotic', event.target.checked)} />
        Antibiótico sujeto a controles adicionales
      </label>
      <p className="product-form-v2__legacy-notice" role="status">{prescriptionSummary(values)}</p>
      {!values.sanitaryFraction && <p className="product-form-v2__legacy-notice">
        Clasificación sanitaria pendiente de confirmar. Los datos antiguos de receta se conservan.
      </p>}
      {['I', 'II', 'III'].includes(values.sanitaryFraction) && <p className="product-form-v2__legacy-notice">
        Solo registro de catálogo. No habilita dispensación.
      </p>}
    </div>}
    <div className="product-form-v2__subsection">
      {isEditing
        ? <><ProductBatchSummary productId={productId} onOpenBatches={onOpenBatches} />
          <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} isEditing /></>
        : <><h4>Entrada inicial</h4>
          <ProductExpirationFields values={values} errors={errors} onExpirationMode={onExpirationMode} onFieldChange={onFieldChange} /></>}
    </div>
  </>;
}
