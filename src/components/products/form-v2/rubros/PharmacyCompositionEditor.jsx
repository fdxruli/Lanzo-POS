import { useCallback, useEffect, useRef, useState } from 'react';
import { activeIngredientRepository } from '../../../../services/pharmacy/activeIngredientRepository';
import { normalizeActiveIngredientEquivalenceKey } from '../../../../services/pharmacy/pharmacyComposition';
import {
  getDefaultPharmacyBaseUnit,
  normalizePharmacyBaseUnit,
  normalizePharmacyMeasureUnit,
  PHARMACY_BASE_UNITS,
  PHARMACY_MEASURE_UNITS
} from '../../../../services/pharmacy/pharmacyCatalog';

const newCompositionRow = (ingredient, dosageFormCode = '') => ({
  activeIngredientId: ingredient.id,
  name: ingredient.name,
  amount: '',
  unit: '',
  basisAmount: 1,
  basisUnit: getDefaultPharmacyBaseUnit(dosageFormCode)
});

const legacyChoice = (value) => `legacy:${value}`;
const choiceValue = (value, normalize) => normalize(value) || (value ? legacyChoice(value) : '');

const compareIdentityCandidates = (left, right, nameKey) => {
  const leftKeyMatch = left.nameKey === nameKey ? 1 : 0;
  const rightKeyMatch = right.nameKey === nameKey ? 1 : 0;
  if (leftKeyMatch !== rightKeyMatch) return rightKeyMatch - leftKeyMatch;
  return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
    || String(left.id).localeCompare(String(right.id));
};

const uniqueIngredientOptions = (rows) => {
  const byIdentity = new Map();
  for (const ingredient of rows) {
    if (!ingredient?.id) continue;
    const nameKey = normalizeActiveIngredientEquivalenceKey(ingredient.name);
    if (!nameKey) continue;
    const existing = byIdentity.get(nameKey);
    if (!existing || compareIdentityCandidates(ingredient, existing, nameKey) < 0) {
      byIdentity.set(nameKey, ingredient);
    }
  }
  return [...byIdentity.values()].sort((left, right) => (
    String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
  ));
};

function UnitSelect({ id, label, value, options, normalize, onChange }) {
  const normalizedValue = choiceValue(value, normalize);
  const isLegacy = normalizedValue.startsWith('legacy:');
  return <div className="product-form-v2__field pharmacy-composition__unit">
    <label htmlFor={id} className="sr-only">{label}</label>
    <select id={id} value={normalizedValue} onChange={(event) => {
      const selected = event.target.value;
      onChange(selected.startsWith('legacy:') ? value : selected);
    }}>
      <option value="">Selecciona una unidad</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      {isLegacy && <option value={normalizedValue}>Anterior: {value} (se conserva)</option>}
    </select>
  </div>;
}

export default function PharmacyCompositionEditor({ values, onCompositionChange, validationError = '' }) {
  const [ingredients, setIngredients] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [savedStatus, setSavedStatus] = useState('');
  const [creatingIngredient, setCreatingIngredient] = useState(false);
  const creatingIngredientRef = useRef(false);
  const mounted = useRef(false);
  const rows = Array.isArray(values.compositionIngredients) ? values.compositionIngredients : [];

  const refreshIngredients = useCallback(async () => {
    try {
      const rows = await activeIngredientRepository.list();
      if (mounted.current) setIngredients(uniqueIngredientOptions(rows));
    } catch {
      if (mounted.current) setIngredients([]);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshIngredients();
    return () => { mounted.current = false; };
  }, [refreshIngredients]);

  const addIngredient = (ingredient) => {
    const nameKey = normalizeActiveIngredientEquivalenceKey(ingredient?.name);
    if (!ingredient?.id || rows.some((row) => (
      row.activeIngredientId === ingredient.id
      || normalizeActiveIngredientEquivalenceKey(row.name) === nameKey
    ))) {
      setError(ingredient?.id ? 'Este principio activo ya está en la composición.' : 'Selecciona un principio activo.');
      return false;
    }
    onCompositionChange([...rows, newCompositionRow(ingredient, values.dosageFormCode)]);
    setSelectedId('');
    setNewName('');
    setError('');
    return true;
  };

  const createIngredient = async () => {
    if (creatingIngredientRef.current) return;
    creatingIngredientRef.current = true;
    setCreatingIngredient(true);
    setError('');
    setSavedStatus('');
    try {
      const ingredient = await activeIngredientRepository.create(newName);
      await refreshIngredients();
      if (addIngredient(ingredient) && mounted.current) {
        setSavedStatus(`${ingredient.name} se guardó y agregó a la composición.`);
      }
    } catch (cause) {
      const messages = {
        PHARMACY_ACTIVE_INGREDIENT_NAME_REQUIRED: 'Escribe el nombre del principio activo.',
        PHARMACY_ACTIVE_INGREDIENT_NAME_TOO_LONG: 'El nombre no puede superar 160 caracteres.'
      };
      setError(messages[cause?.code] || 'No se pudo guardar el principio activo.');
    } finally {
      creatingIngredientRef.current = false;
      if (mounted.current) setCreatingIngredient(false);
    }
  };

  const updateRow = (activeIngredientId, field, value) => {
    const next = rows.map((row) => row.activeIngredientId === activeIngredientId
      ? { ...row, [field]: value }
      : row);
    onCompositionChange(next);
  };

  return <div className="product-form-v2__subsection pharmacy-composition">
    <h4>Principios activos y concentraciones</h4>
    <p className="product-form-v2__hint">Agrega las sustancias activas que contiene este medicamento y la concentración de cada una. Puedes incluir varios principios activos.</p>
    <div className="pharmacy-composition__controls">
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-active-ingredient">Principio activo</label>
        <select id="product-v2-active-ingredient" value={selectedId}
          onChange={(event) => { setSelectedId(event.target.value); setError(''); setSavedStatus(''); }}>
          <option value="">Selecciona un principio activo</option>
          {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
        </select>
      </div>
      <button type="button" className="pharmacy-composition__add"
        disabled={!selectedId}
        onClick={() => addIngredient(ingredients.find((ingredient) => ingredient.id === selectedId))}>
        Agregar al medicamento
      </button>
    </div>

    <details className="pharmacy-composition__create">
      <summary>Crear un principio activo</summary>
      <div className="pharmacy-composition__create-fields">
        <div className="product-form-v2__field">
          <label htmlFor="product-v2-new-active-ingredient">Nombre del nuevo principio activo</label>
          <input id="product-v2-new-active-ingredient" value={newName}
            placeholder="Escribe el nombre"
            disabled={creatingIngredient}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createIngredient(); } }} />
        </div>
        <button id="product-v2-create-active-ingredient" type="button"
          disabled={!newName.trim() || creatingIngredient} aria-busy={creatingIngredient}
          onClick={() => void createIngredient()}>
          {creatingIngredient ? 'Guardando…' : 'Crear y agregar'}
        </button>
      </div>
    </details>

    {(error || validationError) && <small className="product-form-v2__error" role="alert">{error || validationError}</small>}
    {savedStatus && <small className="pharmacy-composition__saved" role="status" aria-live="polite">{savedStatus}</small>}

    {rows.length > 0 && <div className="pharmacy-composition__rows">
      {rows.map((row, index) => <fieldset className="pharmacy-composition__row" key={row.activeIngredientId}>
        <legend>{row.name}</legend>
        <div className="pharmacy-composition__sentence" role="group" aria-label={`Concentración de ${row.name}`}>
          <div className="pharmacy-composition__quantity">
            <div className="product-form-v2__field pharmacy-composition__amount">
              <label className="sr-only" htmlFor={`product-v2-composition-amount-${index}`}>Cantidad de {row.name}</label>
              <input id={`product-v2-composition-amount-${index}`} type="number" min="0" step="any"
                inputMode="decimal" placeholder="Ej. 500"
                value={row.amount} onChange={(event) => updateRow(row.activeIngredientId, 'amount', event.target.value)} />
            </div>
            <UnitSelect id={`product-v2-composition-unit-${index}`} label={`Unidad de concentración de ${row.name}`}
              value={row.unit} options={PHARMACY_MEASURE_UNITS} normalize={normalizePharmacyMeasureUnit}
              onChange={(value) => updateRow(row.activeIngredientId, 'unit', value)} />
          </div>
          <span className="pharmacy-composition__connector" aria-hidden="true">por</span>
          <div className="pharmacy-composition__quantity">
            <div className="product-form-v2__field pharmacy-composition__amount">
              <label className="sr-only" htmlFor={`product-v2-composition-basis-amount-${index}`}>Cantidad base de {row.name}</label>
              <input id={`product-v2-composition-basis-amount-${index}`} type="number" min="0" step="any"
                inputMode="decimal" placeholder="1"
                value={row.basisAmount} onChange={(event) => updateRow(row.activeIngredientId, 'basisAmount', event.target.value)} />
            </div>
            <UnitSelect id={`product-v2-composition-basis-unit-${index}`} label={`Unidad base de ${row.name}`}
              value={row.basisUnit} options={PHARMACY_BASE_UNITS} normalize={normalizePharmacyBaseUnit}
              onChange={(value) => updateRow(row.activeIngredientId, 'basisUnit', value)} />
          </div>
        </div>
        <button type="button" className="pharmacy-composition__remove"
          aria-label={`Quitar ${row.name} de la composición`}
          onClick={() => onCompositionChange(rows.filter((item) => item.activeIngredientId !== row.activeIngredientId))}>
          Quitar
        </button>
      </fieldset>)}
    </div>}
  </div>;
}
