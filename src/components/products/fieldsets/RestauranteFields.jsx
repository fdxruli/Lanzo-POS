import React, { useMemo, useState } from 'react';
import { useProductStore } from '../../../store/useProductStore';
import { usePreparationStations } from '../../../hooks/restaurant/usePreparationStations';
import {
  getModifierOptionLabel,
  normalizeModifierGroup,
  normalizeModifierGroups,
  normalizeModifierOption,
  RESTAURANT_MODIFIER_SELECTION_TYPES,
  RESTAURANT_MODIFIER_UNITS
} from '../../../utils/restaurantModifiers';

const FALLBACK_STATION = { id: 'station_kitchen', code: 'kitchen', name: 'Cocina', isDefault: true, isActive: true };
const EMPTY_OPTION_DRAFT = {
  name: '',
  price: '',
  ingredientId: '',
  ingredientQuantity: '',
  ingredientUnit: 'pza'
};

const getIngredientDefaultUnit = (ingredient) => {
  if (!ingredient) return 'pza';
  return ingredient.unit
    || ingredient.bulkData?.purchase?.unit
    || ingredient.bulkData?.unit
    || ingredient.measurementUnit
    || ingredient.saleUnit
    || 'pza';
};

const asInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export default function RestauranteFields({
  productType, setProductType,
  onManageRecipe,
  printStation, setPrintStation,
  prepTime, setPrepTime,
  modifiers, setModifiers,
  preparationStations = null,
  preparationStationsLoading = null,
  preparationStationsError = null,
  inactivePreparationStationNotice = false,
  hideTypeSelector = false
}) {
  const [newModGroup, setNewModGroup] = useState('');
  const [optionDrafts, setOptionDrafts] = useState({});
  const [optionDraftErrors, setOptionDraftErrors] = useState({});
  const stationState = usePreparationStations({ includeInactive: false });

  const resolvedStations = preparationStations || stationState.activeStations;
  const resolvedLoading = preparationStationsLoading ?? stationState.isLoading;
  const resolvedError = preparationStationsError ?? stationState.error;

  const stationOptions = useMemo(() => {
    const active = (Array.isArray(resolvedStations) ? resolvedStations : [])
      .filter((station) => station?.code && station?.name && station.isActive !== false);
    return active.length > 0 ? active : [FALLBACK_STATION];
  }, [resolvedStations]);

  const normalizedModifiers = useMemo(() => normalizeModifierGroups(modifiers), [modifiers]);

  const hasSelectedStation = stationOptions.some((station) => station.code === (printStation || 'kitchen'));
  const selectedStation = hasSelectedStation ? (printStation || 'kitchen') : 'kitchen';
  const showInactiveStationNotice = inactivePreparationStationNotice || (!hasSelectedStation && (printStation || 'kitchen') !== 'kitchen');

  const menu = useProductStore(state => state.menu);
  const ingredientList = useMemo(() => (
    (menu || []).filter(p => p.productType === 'ingredient' && p.isActive !== false)
  ), [menu]);

  const unitOptions = useMemo(() => {
    const ingredientUnits = ingredientList.map(getIngredientDefaultUnit).filter(Boolean);
    return Array.from(new Set([...RESTAURANT_MODIFIER_UNITS, ...ingredientUnits]));
  }, [ingredientList]);

  const getOptionDraft = (groupIndex) => optionDrafts[groupIndex] || EMPTY_OPTION_DRAFT;

  const updateOptionDraft = (groupIndex, patch) => {
    setOptionDrafts((prev) => ({
      ...prev,
      [groupIndex]: {
        ...(prev[groupIndex] || EMPTY_OPTION_DRAFT),
        ...patch
      }
    }));
    setOptionDraftErrors((prev) => ({ ...prev, [groupIndex]: '' }));
  };

  const resetOptionDraft = (groupIndex) => {
    setOptionDrafts((prev) => ({ ...prev, [groupIndex]: EMPTY_OPTION_DRAFT }));
    setOptionDraftErrors((prev) => ({ ...prev, [groupIndex]: '' }));
  };

  const handleIngredientDraftChange = (groupIndex, ingredientId) => {
    const ingredient = ingredientList.find((item) => item.id === ingredientId);
    updateOptionDraft(groupIndex, {
      ingredientId,
      ingredientQuantity: ingredientId ? getOptionDraft(groupIndex).ingredientQuantity : '',
      ingredientUnit: ingredientId ? getIngredientDefaultUnit(ingredient) : 'pza'
    });
  };

  const updateModifierGroup = (groupIndex, patch) => {
    const updated = normalizedModifiers.map((group, index) => (
      index === groupIndex
        ? normalizeModifierGroup({ ...group, ...patch }, { groupIndex: index })
        : group
    ));
    setModifiers(updated);
  };

  const handleSelectionTypeChange = (groupIndex, selectionType) => {
    const group = normalizedModifiers[groupIndex];
    if (!group) return;

    if (selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE) {
      updateModifierGroup(groupIndex, {
        selectionType: RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE,
        multiple: false,
        minSelect: group.required ? 1 : 0,
        maxSelect: 1
      });
      return;
    }

    const optionCount = Math.max(1, group.options.length);
    updateModifierGroup(groupIndex, {
      selectionType: RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE,
      multiple: true,
      minSelect: group.required ? Math.max(1, group.minSelect) : 0,
      maxSelect: Math.max(group.required ? 1 : 0, group.maxSelect, optionCount)
    });
  };

  const handleRequiredChange = (groupIndex, required) => {
    const group = normalizedModifiers[groupIndex];
    if (!group) return;
    updateModifierGroup(groupIndex, {
      required,
      minSelect: required ? Math.max(1, group.minSelect) : 0
    });
  };

  const handleMinimumChange = (groupIndex, value) => {
    const group = normalizedModifiers[groupIndex];
    if (!group) return;
    const maximum = group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
      ? 1
      : Math.max(1, Math.min(group.maxSelect, group.options.length || 1));
    const minimum = Math.max(group.required ? 1 : 0, Math.min(maximum, asInteger(value, group.minSelect)));
    updateModifierGroup(groupIndex, {
      required: minimum > 0,
      minSelect: minimum,
      maxSelect: Math.max(minimum, group.maxSelect)
    });
  };

  const handleMaximumChange = (groupIndex, value) => {
    const group = normalizedModifiers[groupIndex];
    if (!group || group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE) return;
    const optionCount = Math.max(1, group.options.length);
    const maximum = Math.max(group.minSelect, Math.min(optionCount, asInteger(value, group.maxSelect)));
    updateModifierGroup(groupIndex, { maxSelect: maximum });
  };

  const handleAddModifierGroup = () => {
    if (!newModGroup.trim()) return;
    const newGroup = normalizeModifierGroup({
      id: Date.now(),
      name: newModGroup,
      selectionType: RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE,
      multiple: false,
      required: false,
      minSelect: 0,
      maxSelect: 1,
      options: []
    }, { groupIndex: normalizedModifiers.length });
    setModifiers([...normalizedModifiers, newGroup]);
    setNewModGroup('');
  };

  const removeModifierGroup = (index) => {
    const updated = normalizedModifiers.filter((_, groupIndex) => groupIndex !== index);
    setModifiers(updated);
  };

  const addOptionToGroup = (groupIndex) => {
    const draft = getOptionDraft(groupIndex);
    const currentGroup = normalizedModifiers[groupIndex];
    const normalizedOption = normalizeModifierOption({
      id: `modopt_${Date.now()}`,
      name: draft.name,
      price: draft.price,
      ingredientId: draft.ingredientId || null,
      ingredientQuantity: draft.ingredientId ? draft.ingredientQuantity : null,
      ingredientUnit: draft.ingredientId ? draft.ingredientUnit : null
    }, { optionIndex: (currentGroup?.options || []).length });

    if (!normalizedOption.name) {
      setOptionDraftErrors((prev) => ({ ...prev, [groupIndex]: 'Escribe el nombre de la opción.' }));
      return;
    }

    if (normalizedOption.ingredientId && !normalizedOption.tracksInventory) {
      setOptionDraftErrors((prev) => ({
        ...prev,
        [groupIndex]: 'Indica una cantidad válida del ingrediente para poder descontar inventario.'
      }));
      return;
    }

    if (!currentGroup) return;
    const nextOptions = [...currentGroup.options, normalizedOption];
    const shouldExpandMaximum = currentGroup.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE
      && currentGroup.maxSelect >= Math.max(1, currentGroup.options.length);
    const nextMaxSelect = currentGroup.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
      ? 1
      : Math.max(
        currentGroup.minSelect,
        shouldExpandMaximum ? nextOptions.length : Math.min(currentGroup.maxSelect, nextOptions.length)
      );

    updateModifierGroup(groupIndex, {
      options: nextOptions,
      maxSelect: nextMaxSelect
    });
    resetOptionDraft(groupIndex);
  };

  const removeOptionFromGroup = (groupIndex, optionIndex) => {
    const currentGroup = normalizedModifiers[groupIndex];
    if (!currentGroup) return;
    const nextOptions = currentGroup.options.filter((_, index) => index !== optionIndex);
    const optionCount = Math.max(1, nextOptions.length);
    const nextMaxSelect = currentGroup.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE
      ? 1
      : Math.max(currentGroup.required ? 1 : 0, Math.min(currentGroup.maxSelect, optionCount));
    const nextMinSelect = currentGroup.required
      ? Math.max(1, Math.min(currentGroup.minSelect, nextMaxSelect))
      : 0;

    updateModifierGroup(groupIndex, {
      options: nextOptions,
      minSelect: nextMinSelect,
      maxSelect: nextMaxSelect
    });
  };

  return (
    <div className="restaurant-fields-container">
      {!hideTypeSelector && (
        <div className="form-group product-form-option-panel">
          <label className="form-label">Tipo de ítem</label>
          <div className="product-form-choice-grid">
            <label className={`product-form-choice ${productType === 'sellable' ? 'is-active' : ''}`}>
              <input
                type="radio" name="productType" value="sellable"
                checked={productType === 'sellable'}
                onChange={() => setProductType('sellable')}
              />
              <span>Platillo (venta)</span>
            </label>
            <label className={`product-form-choice ${productType === 'ingredient' ? 'is-active' : ''}`}>
              <input
                type="radio" name="productType" value="ingredient"
                checked={productType === 'ingredient'}
                onChange={() => setProductType('ingredient')}
              />
              <span>Insumo (inventario)</span>
            </label>
          </div>
        </div>
      )}

      {productType === 'sellable' && (
        <>
          <div className="product-form-grid product-form-grid--2">
            <div className="form-group">
              <label className="form-label">Inventario y costos</label>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onManageRecipe}
              >
                Configurar receta
              </button>
              <small>Define qué insumos se descuentan.</small>
            </div>

            <div className="form-group">
              <label className="form-label">Enviar comanda a:</label>
              <select
                className="form-input"
                value={selectedStation}
                onChange={(e) => setPrintStation(e.target.value)}
              >
                {stationOptions.map((station) => (
                  <option key={station.id || station.code} value={station.code}>{station.name}</option>
                ))}
              </select>
              {resolvedLoading && <small>Cargando áreas de preparación...</small>}
              {resolvedError && (
                <small className="product-form-inline-badge product-form-inline-badge--warning">
                  No se pudieron actualizar las áreas. Se usará la última configuración disponible o Cocina.
                </small>
              )}
              {showInactiveStationNotice && (
                <small className="product-form-inline-badge product-form-inline-badge--warning">
                  El área anterior ya no está activa; se usará Cocina.
                </small>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Tiempo promedio de preparación</label>
            <div className="product-form-field-row product-form-field-row--wrap">
              <input
                type="number"
                className="form-input product-form-field-grow"
                placeholder="Ej: 15"
                value={prepTime || ''}
                onChange={(e) => setPrepTime(e.target.value)}
              />
              <span className="product-form-help">minutos</span>
            </div>
            {prepTime > 20 && (
              <small className="product-form-inline-badge product-form-inline-badge--warning">
                Tiempo de espera considerable para comida rápida.
              </small>
            )}
          </div>

          <div className="product-form-modifier-panel">
            <label className="product-form-fieldset-title">Modificadores / extras</label>
            <p className="product-form-help">
              Define qué opciones puede combinar el cliente, cuánto cobran y qué inventario descuentan.
            </p>

            <div className="product-form-field-row" style={{ marginBottom: '15px' }}>
              <input
                type="text"
                className="form-input product-form-field-grow"
                placeholder="Nuevo grupo (Ej: Extras)"
                value={newModGroup}
                onChange={(e) => setNewModGroup(e.target.value)}
              />
              <button type="button" className="btn btn-save" style={{ width: 'auto' }} onClick={handleAddModifierGroup}>Crear</button>
            </div>

            <div className="modifiers-list">
              {normalizedModifiers.map((group, idx) => {
                const draft = getOptionDraft(idx);
                const selectedIngredient = ingredientList.find((item) => item.id === draft.ingredientId);
                const canAddOption = Boolean(draft.name.trim())
                  && (!draft.ingredientId || Number(draft.ingredientQuantity) > 0);
                const optionCount = Math.max(1, group.options.length);
                const groupModeLabel = group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE
                  ? `Varias opciones · máximo ${group.maxSelect}`
                  : 'Una sola opción';

                return (
                  <div key={group.id || idx} className="product-form-modifier-card">
                    <div className="product-form-modifier-card__header">
                      <div>
                        <strong>{group.name}</strong>
                        <small className="product-form-help">{groupModeLabel}</small>
                      </div>
                      <button type="button" className="product-form-link-danger" onClick={() => removeModifierGroup(idx)}>Eliminar grupo</button>
                    </div>

                    <div className="product-form-option-panel" style={{ marginBottom: '14px' }}>
                      <div className="product-form-grid product-form-grid--2">
                        <label className="form-group product-form-no-margin">
                          <span className="form-label">Tipo de selección</span>
                          <select
                            className="form-input"
                            value={group.selectionType}
                            onChange={(event) => handleSelectionTypeChange(idx, event.target.value)}
                          >
                            <option value={RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE}>Una sola opción</option>
                            <option value={RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE}>Varias opciones</option>
                          </select>
                        </label>

                        <label className="product-form-choice">
                          <input
                            type="checkbox"
                            checked={group.required}
                            onChange={(event) => handleRequiredChange(idx, event.target.checked)}
                          />
                          <span>
                            <strong>Selección obligatoria</strong>
                            <small>El cliente no podrá continuar sin cumplir el mínimo.</small>
                          </span>
                        </label>
                      </div>

                      <div className="product-form-grid product-form-grid--2" style={{ marginTop: '10px' }}>
                        <label className="form-group product-form-no-margin">
                          <span className="form-label">Selección mínima</span>
                          <input
                            type="number"
                            className="form-input"
                            min={group.required ? 1 : 0}
                            max={group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE ? 1 : Math.min(group.maxSelect, optionCount)}
                            value={group.minSelect}
                            disabled={!group.required}
                            onChange={(event) => handleMinimumChange(idx, event.target.value)}
                          />
                        </label>

                        <label className="form-group product-form-no-margin">
                          <span className="form-label">Selección máxima</span>
                          <input
                            type="number"
                            className="form-input"
                            min={Math.max(1, group.minSelect)}
                            max={optionCount}
                            value={group.maxSelect}
                            disabled={group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE}
                            onChange={(event) => handleMaximumChange(idx, event.target.value)}
                          />
                        </label>
                      </div>

                      <small className="product-form-help">
                        {group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE
                          ? `La tienda permitirá combinar hasta ${group.maxSelect} opción${group.maxSelect === 1 ? '' : 'es'} de este grupo.`
                          : 'La tienda reemplazará la opción anterior cuando el cliente elija otra.'}
                      </small>
                    </div>

                    <div className="product-form-modifier-option-editor">
                      <div className="product-form-field-row">
                        <input
                          type="text"
                          className="form-input product-form-field-grow"
                          placeholder="Opción (ej: Queso extra)"
                          value={draft.name}
                          onChange={(event) => updateOptionDraft(idx, { name: event.target.value })}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="form-input"
                          placeholder="$ Extra"
                          value={draft.price}
                          onChange={(event) => updateOptionDraft(idx, { price: event.target.value })}
                          style={{ width: '100px' }}
                        />
                      </div>

                      <div className="product-form-field-row product-form-field-row--wrap">
                        <select
                          className="form-input product-form-field-grow"
                          value={draft.ingredientId}
                          onChange={(event) => handleIngredientDraftChange(idx, event.target.value)}
                        >
                          <option value="">Solo texto / no descuenta inventario</option>
                          {ingredientList.map(ing => (
                            <option key={ing.id} value={ing.id}>
                              {ing.name} (Stock: {ing.stock})
                            </option>
                          ))}
                        </select>

                        {draft.ingredientId && (
                          <>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              className="form-input"
                              placeholder="Cantidad"
                              value={draft.ingredientQuantity}
                              onChange={(event) => updateOptionDraft(idx, { ingredientQuantity: event.target.value })}
                              style={{ width: '110px' }}
                            />
                            <select
                              className="form-input"
                              value={draft.ingredientUnit || getIngredientDefaultUnit(selectedIngredient)}
                              onChange={(event) => updateOptionDraft(idx, { ingredientUnit: event.target.value })}
                              style={{ width: '90px' }}
                            >
                              {unitOptions.map((unit) => (
                                <option key={unit} value={unit}>{unit}</option>
                              ))}
                            </select>
                          </>
                        )}

                        <button
                          type="button"
                          className={`btn btn-help ${!canAddOption ? 'disabled' : ''}`}
                          style={{ margin: 0, minHeight: '35px' }}
                          onClick={() => addOptionToGroup(idx)}
                          disabled={!canAddOption}
                        >
                          + Agregar
                        </button>
                      </div>
                      {optionDraftErrors[idx] && (
                        <small className="product-form-inline-badge product-form-inline-badge--warning">
                          {optionDraftErrors[idx]}
                        </small>
                      )}
                    </div>

                    <ul className="product-form-option-list">
                      {group.options.map((opt, optIdx) => {
                        const optionLabel = getModifierOptionLabel(opt);
                        const badgeClass = opt.isLegacyIncomplete || optionLabel === 'Cobra extra'
                          ? 'product-form-inline-badge product-form-inline-badge--warning'
                          : 'product-form-inline-badge';

                        return (
                          <li key={opt.id || optIdx} className="product-form-option-item">
                            <span>
                              {opt.name} {opt.price > 0 && <span className="product-form-success-text">(+${opt.price})</span>}
                              {opt.tracksInventory && (
                                <small className="product-form-help"> · descuenta {opt.ingredientQuantity} {opt.ingredientUnit || ''}</small>
                              )}
                            </span>

                            <span title={opt.isLegacyIncomplete ? 'Tiene ingrediente legacy, pero falta cantidad real.' : ''} className={badgeClass}>
                              {optionLabel}
                            </span>

                            {opt.legacyQuantityMapped && (
                              <span title="Se normalizó desde el campo legacy quantity." className="product-form-inline-badge">
                                Legacy normalizado
                              </span>
                            )}

                            <button type="button" className="product-form-delete-inline" onClick={() => removeOptionFromGroup(idx, optIdx)}>×</button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {productType === 'ingredient' && (
        <div className="product-form-alert product-form-alert--info product-form-risk-card">
          <h4 className="product-form-section__title">Modo insumo</h4>
          <p>
            Este producto <strong>no aparecerá en el menú de ventas</strong>.
            Se usará exclusivamente para construir recetas de otros platillos y descontar inventario automáticamente.
          </p>
        </div>
      )}
    </div>
  );
}
