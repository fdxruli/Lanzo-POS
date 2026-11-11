import ProductExpirationFields from '../components/ProductExpirationFields';
import ProductBatchSummary from '../components/ProductBatchSummary';
import { SANITARY_FRACTIONS } from '../../../../utils/pharmacyClassification';

const DOSAGE_FORMS = [
  ['tablet', 'Tableta'], ['capsule', 'Cápsula'], ['solution', 'Solución'],
  ['suspension', 'Suspensión'], ['cream', 'Crema'], ['injectable', 'Inyectable'],
  ['other', 'Otra']
];

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
  values, errors, onFieldChange, onExpirationMode, isEditing, productId, onOpenBatches
}) {
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
            <option value="medicine">Medicamento</option>
            <option value="other">Otro producto de farmacia</option>
          </select>
          {errors.pharmacyKind && <small className="product-form-v2__error">{errors.pharmacyKind}</small>}
        </div>
        {values.pharmacyKind === 'medicine' && field('activeSubstance', 'Sustancia activa', 'Ej. Amoxicilina')}
        {values.pharmacyKind === 'medicine' && field('concentration', 'Concentración', 'Ej. 500 mg o 250 mg/5 mL')}
        {values.pharmacyKind === 'medicine' && <div className="product-form-v2__field">
          <label htmlFor="product-v2-dosageForm">Forma farmacéutica</label>
          <input id="product-v2-dosageForm" list="pharmacy-dosage-forms"
            value={values.dosageForm || ''} placeholder="Ej. Cápsula"
            onChange={(event) => onFieldChange('dosageForm', event.target.value)} />
          <datalist id="pharmacy-dosage-forms">
            {DOSAGE_FORMS.filter(([id]) => id !== 'other').map(([, label]) => <option value={label} key={label} />)}
          </datalist>
        </div>}
        {field('presentation', 'Presentación', 'Ej. Caja con 12 cápsulas')}
        {field('laboratory', 'Laboratorio')}
        {values.pharmacyKind === 'medicine' && field('sanitaryRegistration', 'Registro sanitario (opcional)')}
      </div>
    </div>
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
