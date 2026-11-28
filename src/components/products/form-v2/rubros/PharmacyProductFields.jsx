import { useState } from 'react';
import ProductExpirationFields from '../components/ProductExpirationFields';
import ProductBatchSummary from '../components/ProductBatchSummary';
import { SANITARY_FRACTIONS } from '../../../../utils/pharmacyClassification';
import {
  PHARMACY_DOSAGE_FORMS,
  PHARMACY_PACKAGE_CONTENT_UNITS,
  PHARMACY_PACKAGE_TYPES,
  formatPharmacyCommercialPresentation,
  getPharmacyDosageFormLabel
} from '../../../../services/pharmacy/pharmacyCatalog';
import { formatCompositionConcentration } from '../../../../services/pharmacy/pharmacyComposition';
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

const hasValue = (value) => String(value ?? '').trim().length > 0;

export default function PharmacyProductFields({
  values, errors, onFieldChange, onCompositionChange, onExpirationMode, isEditing, productId, onOpenBatches
}) {
  const rows = Array.isArray(values.compositionIngredients) ? values.compositionIngredients : [];
  const hasStructuredComposition = rows.length > 0;
  const [legacyFieldVisibility] = useState(() => ({
    activeSubstance: isEditing && !hasStructuredComposition && hasValue(values.activeSubstance),
    concentration: isEditing && !hasStructuredComposition && hasValue(values.concentration),
    dosageFormLegacy: isEditing && Boolean(values.dosageFormCode) && hasValue(values.dosageFormLegacy),
    dosageForm: isEditing && !values.dosageFormCode && hasValue(values.dosageForm),
    presentationLegacy: isEditing && hasValue(values.presentationLegacy)
  }));
  const field = (name, label, placeholder = '') => (
    <div className="product-form-v2__field" key={name}>
      <label htmlFor={`product-v2-${name}`}>{label}</label>
      <input id={`product-v2-${name}`} value={values[name] || ''} placeholder={placeholder}
        onChange={(event) => onFieldChange(name, event.target.value)} />
      {errors[name] && <small className="product-form-v2__error">{errors[name]}</small>}
    </div>
  );

  const legacyFields = [];
  if (legacyFieldVisibility.activeSubstance) legacyFields.push(field('activeSubstance', 'Sustancia activa anterior'));
  if (legacyFieldVisibility.concentration) legacyFields.push(field('concentration', 'Concentración anterior'));
  if (legacyFieldVisibility.dosageFormLegacy) {
    legacyFields.push(field('dosageFormLegacy', 'Forma farmacéutica anterior'));
  } else if (legacyFieldVisibility.dosageForm) {
    legacyFields.push(field('dosageForm', 'Forma farmacéutica anterior (texto libre)'));
  }
  if (legacyFieldVisibility.presentationLegacy) {
    legacyFields.push(field('presentationLegacy', 'Presentación anterior (texto libre)', 'Descripción histórica'));
  }

  const compositionSummary = rows.length
    ? rows.map((row) => {
      const concentration = formatCompositionConcentration({ version: 1, activeIngredients: [row] });
      return concentration
        ? `${row.name} ${concentration}`
        : `${row.name} · concentración incompleta`;
    }).join(' + ')
    : [values.activeSubstance, values.concentration].filter(hasValue).length
      ? `Dato anterior: ${[values.activeSubstance, values.concentration].filter(hasValue).join(' · ')}`
      : 'Agrega los principios activos y sus concentraciones.';
  const selectedForm = getPharmacyDosageFormLabel(values.dosageFormCode);
  const formSummary = selectedForm
    || (hasValue(values.dosageForm) ? `Forma anterior: ${values.dosageForm}` : 'Forma farmacéutica pendiente');
  const commercialPresentation = formatPharmacyCommercialPresentation({
    version: 1,
    packageType: values.packageType,
    contentAmount: values.packageContentAmount,
    contentUnit: values.packageContentUnit
  });
  const hasCommercialData = Boolean(values.packageType || hasValue(values.packageContentAmount) || values.packageContentUnit);
  const presentationSummary = commercialPresentation
    ? `${formSummary} · ${commercialPresentation}`
    : `${formSummary} · ${hasCommercialData ? 'presentación comercial incompleta' : 'presentación comercial pendiente'}`;

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
        {values.pharmacyKind !== 'medicine' && field('presentation', 'Presentación', 'Descripción anterior o comercial')}
        {field('laboratory', 'Laboratorio')}
        {values.pharmacyKind === 'medicine' && field('sanitaryRegistration', 'Registro sanitario (opcional)')}
      </div>
      {legacyFields.length > 0 && <details className="pharmacy-legacy-data">
        <summary>Datos anteriores del medicamento</summary>
        <p>Son datos de texto libre y se conservan como fueron capturados. Puedes editar esta información y completar la composición estructurada abajo.</p>
        <div className="product-form-v2__field-grid">{legacyFields}</div>
      </details>}
    </div>

    {values.pharmacyKind === 'medicine' && <PharmacyCompositionEditor
      values={values}
      onCompositionChange={onCompositionChange}
      validationError={errors.compositionIngredients}
    />}

    {values.pharmacyKind === 'medicine' && <div className="product-form-v2__subsection pharmacy-commercial-presentation">
      <h4>Presentación comercial</h4>
      <p className="product-form-v2__hint">Indica el envase y cuántas unidades contiene. No cambia la unidad de venta ni las existencias.</p>
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
    </div>}

    {values.pharmacyKind === 'medicine' && <section className="pharmacy-summary" aria-label="Resumen de datos farmacéuticos">
      <h4>Resumen farmacéutico</h4>
      <p>{compositionSummary}</p>
      <p>{presentationSummary}</p>
    </section>}

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
