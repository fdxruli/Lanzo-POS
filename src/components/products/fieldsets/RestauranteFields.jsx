import React, { useMemo, useState } from 'react';
import { useProductStore } from '../../../store/useProductStore';

const FALLBACK_STATION = { id: 'station_kitchen', code: 'kitchen', name: 'Cocina', isDefault: true, isActive: true };

export default function RestauranteFields({
  productType, setProductType,
  onManageRecipe,
  printStation, setPrintStation,
  prepTime, setPrepTime,
  modifiers, setModifiers,
  preparationStations = [],
  preparationStationsLoading = false,
  preparationStationsError = null,
  inactivePreparationStationNotice = false,
  hideTypeSelector = false
}) {
  const [newModGroup, setNewModGroup] = useState('');

  const stationOptions = useMemo(() => {
    const active = (Array.isArray(preparationStations) ? preparationStations : [])
      .filter((station) => station?.code && station?.name && station.isActive !== false);
    return active.length > 0 ? active : [FALLBACK_STATION];
  }, [preparationStations]);

  const selectedStation = stationOptions.some((station) => station.code === (printStation || 'kitchen'))
    ? (printStation || 'kitchen')
    : 'kitchen';

  const handleAddModifierGroup = () => {
    if (!newModGroup.trim()) return;
    const newGroup = {
      id: Date.now(),
      name: newModGroup,
      required: false,
      options: []
    };
    setModifiers([...(modifiers || []), newGroup]);
    setNewModGroup('');
  };

  const removeModifierGroup = (index) => {
    const updated = [...modifiers];
    updated.splice(index, 1);
    setModifiers(updated);
  };

  const addOptionToGroup = (groupIndex, optionName, price, ingredientId = null) => {
    const updated = [...(modifiers || [])];
    updated[groupIndex].options.push({
      name: optionName,
      price: parseFloat(price) || 0,
      ingredientId
    });
    setModifiers(updated);
  };

  const removeOptionFromGroup = (groupIndex, optionIndex) => {
    const updated = [...(modifiers || [])];
    updated[groupIndex].options.splice(optionIndex, 1);
    setModifiers(updated);
  };

  const menu = useProductStore(state => state.menu);
  const ingredientList = menu.filter(p => p.productType === 'ingredient' && p.isActive !== false);

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
              {preparationStationsLoading && <small>Cargando áreas de preparación...</small>}
              {preparationStationsError && (
                <small className="product-form-inline-badge product-form-inline-badge--warning">
                  No se pudieron actualizar las áreas. Se usará la última configuración disponible o Cocina.
                </small>
              )}
              {inactivePreparationStationNotice && (
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
              Ej: "Elige tu Salsa", "Agrega papas", "Término de carne".
            </p>

            <div className="product-form-field-row" style={{ marginBottom: '15px' }}>
              <input
                type="text"
                className="form-input product-form-field-grow"
                placeholder="Nuevo grupo (Ej: Salsas)"
                value={newModGroup}
                onChange={(e) => setNewModGroup(e.target.value)}
              />
              <button type="button" className="btn btn-save" style={{ width: 'auto' }} onClick={handleAddModifierGroup}>Crear</button>
            </div>

            <div className="modifiers-list">
              {modifiers && modifiers.map((group, idx) => (
                <div key={idx} className="product-form-modifier-card">
                  <div className="product-form-modifier-card__header">
                    <strong>{group.name}</strong>
                    <button type="button" className="product-form-link-danger" onClick={() => removeModifierGroup(idx)}>Eliminar grupo</button>
                  </div>

                  <div className="product-form-modifier-option-editor">
                    <div className="product-form-field-row">
                      <input
                        id={`opt-name-${idx}`}
                        type="text"
                        className="form-input product-form-field-grow"
                        placeholder="Opción (ej: Queso extra)"
                      />
                      <input
                        id={`opt-price-${idx}`}
                        type="number"
                        className="form-input"
                        placeholder="$ Extra"
                        style={{ width: '90px' }}
                      />
                    </div>

                    <div className="product-form-field-row">
                      <select
                        id={`opt-ing-${idx}`}
                        className="form-input product-form-field-grow"
                      >
                        <option value="">-- Solo texto (no descuenta stock) --</option>
                        {ingredientList.map(ing => (
                          <option key={ing.id} value={ing.id}>
                            {ing.name} (Stock: {ing.stock})
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        className="btn btn-help"
                        style={{ margin: 0, minHeight: '35px' }}
                        onClick={() => {
                          const nameInput = document.getElementById(`opt-name-${idx}`);
                          const priceInput = document.getElementById(`opt-price-${idx}`);
                          const ingInput = document.getElementById(`opt-ing-${idx}`);

                          if (nameInput.value) {
                            const linkedIngredientId = ingInput.value.trim() || '';

                            addOptionToGroup(
                              idx,
                              nameInput.value,
                              priceInput.value,
                              linkedIngredientId
                            );

                            nameInput.value = '';
                            priceInput.value = '';
                            ingInput.value = '';
                            nameInput.focus();
                          }
                        }}
                      >
                        + Agregar
                      </button>
                    </div>
                  </div>

                  <ul className="product-form-option-list">
                    {group.options.map((opt, optIdx) => (
                      <li key={optIdx} className="product-form-option-item">
                        <span>{opt.name} {opt.price > 0 && <span className="product-form-success-text">(+${opt.price})</span>}</span>

                        {opt.price > 0 && !opt.ingredientId && (
                          <span title="Cobra precio pero no descuenta inventario" className="product-form-inline-badge product-form-inline-badge--warning">
                            Sin descuento
                          </span>
                        )}

                        <button type="button" className="product-form-delete-inline" onClick={() => removeOptionFromGroup(idx, optIdx)}>×</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
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
