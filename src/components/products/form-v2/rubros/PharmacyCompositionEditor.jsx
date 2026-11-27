import { useCallback, useEffect, useRef, useState } from 'react';
import { activeIngredientRepository } from '../../../../services/pharmacy/activeIngredientRepository';

const newCompositionRow = (ingredient, dosageForm = '') => ({
  activeIngredientId: ingredient.id,
  name: ingredient.name,
  amount: '',
  unit: '',
  basisAmount: 1,
  basisUnit: dosageForm || ''
});

export default function PharmacyCompositionEditor({ values, onCompositionChange, validationError = '' }) {
  const [ingredients, setIngredients] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const rows = Array.isArray(values.compositionIngredients) ? values.compositionIngredients : [];

  const refreshIngredients = useCallback(async () => {
    try {
      const rows = await activeIngredientRepository.list();
      if (mounted.current) setIngredients(rows);
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
    if (!ingredient?.id || rows.some((row) => row.activeIngredientId === ingredient.id)) {
      setError(ingredient?.id ? 'Este principio activo ya está en la composición.' : 'Selecciona un principio activo.');
      return;
    }
    onCompositionChange([...rows, newCompositionRow(ingredient, values.dosageForm)]);
    setSelectedId('');
    setNewName('');
    setError('');
  };

  const createIngredient = async () => {
    try {
      const ingredient = await activeIngredientRepository.create(newName);
      await refreshIngredients();
      addIngredient(ingredient);
    } catch (cause) {
      const messages = {
        PHARMACY_ACTIVE_INGREDIENT_NAME_REQUIRED: 'Escribe el nombre del principio activo.',
        PHARMACY_ACTIVE_INGREDIENT_NAME_TOO_LONG: 'El nombre no puede superar 160 caracteres.'
      };
      setError(messages[cause?.code] || 'No se pudo guardar el principio activo.');
    }
  };

  const updateRow = (index, field, value) => {
    const next = rows.map((row, rowIndex) => rowIndex === index
      ? { ...row, [field]: value }
      : row);
    onCompositionChange(next);
  };

  return <div className="product-form-v2__subsection pharmacy-composition">
    <h4>Composición farmacéutica</h4>
    <p className="product-form-v2__hint">Datos descriptivos. No cambian existencias ni clasificación sanitaria.</p>
    <div className="product-form-v2__field-grid">
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-active-ingredient">Principio activo registrado</label>
        <select id="product-v2-active-ingredient" value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Selecciona un principio activo</option>
          {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
        </select>
      </div>
      <div className="product-form-v2__field pharmacy-composition__add-action">
        <button id="product-v2-add-active-ingredient" type="button" disabled={!selectedId}
          onClick={() => addIngredient(ingredients.find((ingredient) => ingredient.id === selectedId))}>
          Agregar a la composición
        </button>
      </div>
      <div className="product-form-v2__field">
        <label htmlFor="product-v2-new-active-ingredient">Crear principio activo</label>
        <input id="product-v2-new-active-ingredient" value={newName}
          placeholder="Escribe cualquier nombre válido"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createIngredient(); } }} />
      </div>
      <div className="product-form-v2__field pharmacy-composition__add-action">
        <label className="sr-only" htmlFor="product-v2-create-active-ingredient">Crear y agregar</label>
        <button id="product-v2-create-active-ingredient" type="button" disabled={!newName.trim()}
          onClick={() => void createIngredient()}>
          Crear y agregar
        </button>
      </div>
    </div>
    {(error || validationError) && <small className="product-form-v2__error" role="alert">{error || validationError}</small>}
    {rows.length > 0 && <div className="pharmacy-composition__rows">
      {rows.map((row, index) => <fieldset className="pharmacy-composition__row" key={row.activeIngredientId}>
        <legend>{row.name}</legend>
        <div className="product-form-v2__field-grid">
          <div className="product-form-v2__field">
            <label htmlFor={`product-v2-composition-amount-${index}`}>Cantidad</label>
            <input id={`product-v2-composition-amount-${index}`} type="number" min="0" step="any"
              value={row.amount} onChange={(event) => updateRow(index, 'amount', event.target.value)} />
          </div>
          <div className="product-form-v2__field">
            <label htmlFor={`product-v2-composition-unit-${index}`}>Unidad</label>
            <input id={`product-v2-composition-unit-${index}`} value={row.unit}
              onChange={(event) => updateRow(index, 'unit', event.target.value)} />
          </div>
          <div className="product-form-v2__field">
            <label htmlFor={`product-v2-composition-basis-amount-${index}`}>Por cantidad base</label>
            <input id={`product-v2-composition-basis-amount-${index}`} type="number" min="0" step="any"
              value={row.basisAmount} onChange={(event) => updateRow(index, 'basisAmount', event.target.value)} />
          </div>
          <div className="product-form-v2__field">
            <label htmlFor={`product-v2-composition-basis-unit-${index}`}>Unidad base</label>
            <input id={`product-v2-composition-basis-unit-${index}`} value={row.basisUnit}
              onChange={(event) => updateRow(index, 'basisUnit', event.target.value)} />
          </div>
        </div>
        <button type="button" className="pharmacy-composition__remove"
          aria-label={`Quitar ${row.name} de la composición`}
          onClick={() => onCompositionChange(rows.filter((_, rowIndex) => rowIndex !== index))}>
          Quitar
        </button>
      </fieldset>)}
    </div>}
  </div>;
}
