import React, { useMemo, useState } from 'react';
import { useProductStore } from '../../../store/useProductStore';
import { usePreparationStations } from '../../../hooks/restaurant/usePreparationStations';
import {
  getModifierOptionLabel,
  normalizeModifierGroup,
  normalizeModifierGroups,
  normalizeModifierOption,
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

  const handleAddModifierGroup = () => {
    if (!newModGroup.trim()) return;
    const newGroup = normalizeModifierGroup({
      id: Date.now(),
      name: newModGroup,
      required: false,
      options: []
    }, { groupIndex: normalizedModifiers.length });
    setModifiers([...(modifiers || []), newGroup]);
    setNewModGroup('');
  };

  const removeModifierGroup = (index) => {
    const updated = [...(modifiers || [])];
    updated.splice(index, 1);
    setModifiers(updated);
  };

  const addOptionToGroup = (groupIndex) => {
    const draft = getOptionDraft(groupIndex);
    const normalizedOption = normalizeModifierOption({
      id: `modopt_${Date.now()}`,
      name: draft.name,
      price: draft.price,
      ingredientId: draft.ingredientId || null,
      ingredientQuantity: draft.ingredientId ? draft.ingredientQuantity : null,
      ingredientUnit: draft.ingredientId ? draft.ingredientUnit : null
    }, { optionIndex: (normalizedModifiers[groupIndex]?.options || []).length });

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

    const updated = [...(modifiers || [])];
    const currentGroup = updated[groupIndex] || normalizedModifiers[groupIndex];
    updated[groupIndex] = {
      ...currentGroup,
      options: [...(currentGroup?.options || []), normalizedOption]
    };
    setModifiers(updated);
    resetOptionDraft(groupIndex);
  };

  const removeOptionFromGroup = (groupIndex, optionIndex) => {
    const updated = [...(modifiers || [])];
    const currentGroup = updated[groupIndex] || {};
    updated[groupIndex] = {
      ...currentGroup,
      options: [...(currentGroup.options || [])]
    };
    updated[groupIndex].options.splice(optionIndex, 1);
    setModifiers(updated);
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
              Define si cada opción solo agrega texto, cobra extra, descuenta inventario o hace ambas cosas.
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

                return (
                  <div key={group.id || idx} className="product-form-modifier-card">
                    <div className="product-form-modifier-card__header">
                      <strong>{group.name}</strong>
                      <button type="button" className="product-form-link-danger" onClick={() => removeModifierGroup(idx)}>Eliminar grupo</button>
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
