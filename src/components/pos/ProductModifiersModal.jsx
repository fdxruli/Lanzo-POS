import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, AlertCircle, Info, ShoppingCart, StickyNote } from 'lucide-react';
import { createCartLineId } from '../../utils/cartLineIdentity';
import { getModifierOptionLabel, normalizeModifierGroups, normalizeModifierOption } from '../../utils/restaurantModifiers';
import './ProductModifiersModal.css';

export default function ProductModifiersModal({ show, onClose, product, onConfirm }) {
    // 1. TODOS los Hooks deben ir al principio
    const [selectedOptions, setSelectedOptions] = useState({}); 
    const [note, setNote] = useState('');

    const normalizedModifierGroups = useMemo(() => (
        normalizeModifierGroups(product?.modifiers || [])
    ), [product]);

    useEffect(() => {
        if (show) {
            setSelectedOptions({});
            setNote('');
        }
    }, [show, product]);

    // ✅ CORRECCIÓN: El useMemo debe estar ANTES de cualquier return condicional
    const allSelectedModifiers = useMemo(() => 
        Object.values(selectedOptions).flat(), 
    [selectedOptions]);

    // 2. AHORA sí podemos hacer el return condicional
    if (!show || !product) return null;

    // --- LÓGICA Y CÁLCULOS (Seguro ejecutarlos aquí) ---
    const handleOptionChange = (groupName, option, isMultiSelect) => {
        setSelectedOptions(prev => {
            const currentSelections = prev[groupName] || [];
            if (isMultiSelect) {
                const exists = currentSelections.find(opt => (opt.id || opt.name) === (option.id || option.name));
                if (exists) {
                    return { ...prev, [groupName]: currentSelections.filter(opt => (opt.id || opt.name) !== (option.id || option.name)) };
                } else {
                    return { ...prev, [groupName]: [...currentSelections, option] };
                }
            } else {
                return { ...prev, [groupName]: [option] };
            }
        });
    };

    const basePrice = product.price || 0;
    const modifiersTotal = allSelectedModifiers.reduce((sum, opt) => sum + (Number(opt.price) || 0), 0);
    const finalPrice = basePrice + modifiersTotal;

    // Validación de grupos requeridos
    const missingRequiredGroups = normalizedModifierGroups.filter(group => {
        return group.required && (!selectedOptions[group.name] || selectedOptions[group.name].length === 0);
    }).map(g => g.name);

    const isValid = !missingRequiredGroups || missingRequiredGroups.length === 0;
    const completedGroupsCount = normalizedModifierGroups.filter((group) => {
        const currentGroupSelection = selectedOptions[group.name] || [];
        return !group.required || currentGroupSelection.length > 0;
    }).length;

    const handleConfirm = () => {
        const cleanedModifiers = allSelectedModifiers.map((mod, index) => {
            const normalized = normalizeModifierOption(mod, { optionIndex: index });
            const inventoryQuantity = normalized.tracksInventory ? normalized.ingredientQuantity : null;

            return {
                id: normalized.id,
                name: normalized.name,
                price: normalized.price,
                ingredientId: normalized.tracksInventory ? normalized.ingredientId : null,
                ingredientQuantity: inventoryQuantity,
                ingredientUnit: normalized.tracksInventory ? normalized.ingredientUnit : null,
                tracksInventory: normalized.tracksInventory,
                ...(normalized.tracksInventory ? { quantity: inventoryQuantity } : {}),
                ...(normalized.legacyQuantityMapped ? { legacyQuantityMapped: true } : {}),
                ...(normalized.isLegacyIncomplete ? { isLegacyIncomplete: true } : {})
            };
        });

        const modifiedProduct = {
            ...product,
            price: finalPrice,
            originalPrice: finalPrice,
            selectedModifiers: cleanedModifiers,
            notes: note,
            id: product.id,
            parentId: product.id,
            lineId: createCartLineId(product),
            forceNewLine: true
        };

        onConfirm(modifiedProduct);
    };

    return (
        <div className="ui-modal product-modifiers-modal-overlay" role="presentation">
            <div
                className="ui-modal__content modal-content modifiers-modal product-modifiers-modal-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="product-modifiers-title"
            >
                <div className="modifiers-header">
                    <div className="header-top product-modifiers-header-top">
                        <div className="modifiers-title-block">
                            <span className="modifiers-kicker">Configura extras</span>
                            <h2 id="product-modifiers-title" className="modal-title product-modifiers-modal-title">{product.name}</h2>
                            {product.description && (
                                <p className="product-description">{product.description}</p>
                            )}
                        </div>
                        <button type="button" className="close-btn product-modifiers-close-button" onClick={onClose} aria-label="Cerrar extras">
                            <X size={22} />
                        </button>
                    </div>

                    <div className="modifiers-status-row">
                        <span className="base-price-badge">
                            Base <strong>${basePrice.toFixed(2)}</strong>
                        </span>
                        <span className="progress-badge">
                            {completedGroupsCount}/{normalizedModifierGroups.length} secciones listas
                        </span>
                        {!isValid && (
                            <span className="missing-badge">
                                <AlertCircle size={14} /> Faltan {missingRequiredGroups.length}
                            </span>
                        )}
                    </div>
                </div>

                <div className="modifiers-layout">
                    <div className="modifiers-body">
                        {normalizedModifierGroups.map((group, idx) => {
                            const currentGroupSelection = selectedOptions[group.name] || [];
                            const isSatisfied = !group.required || currentGroupSelection.length > 0;

                            return (
                                <section key={group.id || idx} className={`modifier-group ${!isSatisfied ? 'group-pending' : 'group-completed'}`}>
                                    <div className="modifier-group-header">
                                        <div>
                                            <h4 className="group-title">{group.name}</h4>
                                            <span className="group-instruction">
                                                {group.required ? 'Selecciona 1 opción' : 'Elige los extras que desees'}
                                            </span>
                                        </div>
                                        {group.required ? (
                                            !isSatisfied ?
                                                <span className="badge-required"><AlertCircle size={12} /> Obligatorio</span> :
                                                <span className="badge-completed"><Check size={12} /> Completado</span>
                                        ) : (
                                            <span className="badge-optional">Opcional</span>
                                        )}
                                    </div>

                                    <div className="modifier-options-grid">
                                        {group.options.map((opt, optIdx) => {
                                            const isSelected = currentGroupSelection.some(s => (s.id || s.name) === (opt.id || opt.name));
                                            const inputType = group.required ? 'radio' : 'checkbox';
                                            const optionLabel = getModifierOptionLabel(opt);
                                            const optionPrice = Number(opt.price) || 0;

                                            return (
                                                <label key={opt.id || optIdx} className={`modifier-option-card ${isSelected ? 'selected' : ''}`}>
                                                    <input
                                                        type={inputType}
                                                        name={`group-${idx}`}
                                                        checked={!!isSelected}
                                                        onChange={() => handleOptionChange(group.name, opt, !group.required)}
                                                        className="hidden-input"
                                                    />

                                                    <span className="option-select-indicator" aria-hidden="true">
                                                        {isSelected && <Check size={14} />}
                                                    </span>

                                                    <span className="opt-content">
                                                        <span className="opt-top">
                                                            <span className="opt-name">{opt.name}</span>
                                                            <span className={`opt-price ${optionPrice === 0 ? 'free' : ''}`}>
                                                                {optionPrice > 0 ? `+$${optionPrice.toFixed(2)}` : 'Gratis'}
                                                            </span>
                                                        </span>
                                                        <small className="option-detail">
                                                            {optionLabel}
                                                            {opt.tracksInventory && ` · ${opt.ingredientQuantity} ${opt.ingredientUnit || ''}`}
                                                        </small>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>

                    <aside className="modifiers-summary-panel" aria-label="Resumen de extras seleccionados">
                        <section className="summary-panel-section">
                            <div className="summary-panel-heading">
                                <ShoppingCart size={17} />
                                <span>Tu selección</span>
                            </div>
                            {allSelectedModifiers.length > 0 ? (
                                <div className="summary-tags">
                                    {allSelectedModifiers.map((mod, i) => (
                                        <span key={mod.id || i} className="summary-tag">
                                            {mod.name}
                                            {Number(mod.price) > 0 && <span className="tiny-price">+${Number(mod.price).toFixed(2)}</span>}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="summary-empty">Aún no has elegido extras.</p>
                            )}
                        </section>

                        <section className="summary-panel-section notes-section">
                            <label className="form-label" htmlFor="kitchen-notes">
                                <StickyNote size={15} /> Notas de cocina
                            </label>
                            <textarea
                                id="kitchen-notes"
                                className="form-textarea"
                                rows="4"
                                placeholder="Ej: Sin cebolla, salsa aparte, bien cocido..."
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                            />
                            <small className="notes-hint"><Info size={13} /> Visible para cocina en la comanda.</small>
                        </section>
                    </aside>
                </div>

                <div className="modifiers-footer">
                    <div className="price-summary-container">
                        <span className="label-total">Total</span>
                        <span className="final-price-display">${finalPrice.toFixed(2)}</span>
                    </div>

                    <div className="actions-container">
                        <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
                        <button
                            type="button"
                            className={`btn-primary-action ${!isValid ? 'disabled' : ''}`}
                            onClick={handleConfirm}
                            disabled={!isValid}
                        >
                            {isValid ? (
                                <>Agregar <span className="btn-price-tag">${finalPrice.toFixed(2)}</span></>
                            ) : (
                                `Faltan ${missingRequiredGroups.length} opciones`
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
