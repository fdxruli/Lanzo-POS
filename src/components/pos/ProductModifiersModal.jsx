import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, AlertCircle, Info } from 'lucide-react'; 
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
        <div className="ui-modal product-modifiers-modal-overlay">
            <div className="ui-modal__content modal-content modifiers-modal product-modifiers-modal-content">
                {/* HEADER */}
                <div className="modifiers-header">
                    <div className="header-top product-modifiers-header-top">
                        <h2 className="modal-title product-modifiers-modal-title">{product.name}</h2>
                        <button className="close-btn product-modifiers-close-button" onClick={onClose}><X size={24} /></button>
                    </div>
                    {product.description && (
                        <p className="product-description">{product.description}</p>
                    )}
                    <div className="base-price-badge">
                        Precio Base: <span>${basePrice.toFixed(2)}</span>
                    </div>
                </div>

                <div className="modifiers-body">
                    {normalizedModifierGroups.map((group, idx) => {
                        const currentGroupSelection = selectedOptions[group.name] || [];
                        const isSatisfied = !group.required || currentGroupSelection.length > 0;
                        
                        return (
                            <div key={group.id || idx} className={`modifier-group ${!isSatisfied ? 'group-pending' : 'group-completed'}`}>
                                <div className="modifier-group-header">
                                    <h4 className="group-title">
                                        {group.name}
                                        {group.required ? (
                                            !isSatisfied ? 
                                                <span className="badge-required"><AlertCircle size={12}/> Obligatorio</span> : 
                                                <span className="badge-completed"><Check size={12}/> Completado</span>
                                        ) : (
                                            <span className="badge-optional">Opcional</span>
                                        )}
                                    </h4>
                                    <span className="group-instruction">
                                        {group.required ? "Selecciona 1 opción" : "Elige los extras que desees"}
                                    </span>
                                </div>

                                <div className="modifier-options-grid">
                                    {group.options.map((opt, optIdx) => {
                                        const isSelected = currentGroupSelection.some(s => (s.id || s.name) === (opt.id || opt.name));
                                        const inputType = group.required ? 'radio' : 'checkbox';
                                        const optionLabel = getModifierOptionLabel(opt);

                                        return (
                                            <label key={opt.id || optIdx} className={`modifier-option-card ${isSelected ? 'selected' : ''}`}>
                                                <input
                                                    type={inputType}
                                                    name={`group-${idx}`}
                                                    checked={!!isSelected}
                                                    onChange={() => handleOptionChange(group.name, opt, !group.required)}
                                                    className="hidden-input"
                                                />
                                                
                                                <div className="opt-content">
                                                    <div className="opt-top">
                                                        <span className="opt-name">{opt.name}</span>
                                                        {isSelected && <div className="check-icon"><Check size={14} /></div>}
                                                    </div>
                                                    
                                                    <span className={`opt-price ${opt.price === 0 ? 'free' : ''}`}>
                                                        {opt.price > 0 ? `+$${opt.price.toFixed(2)}` : 'Gratis'}
                                                    </span>
                                                    <small className="product-form-help">
                                                        {optionLabel}
                                                        {opt.tracksInventory && ` · ${opt.ingredientQuantity} ${opt.ingredientUnit || ''}`}
                                                    </small>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    <div className="form-group notes-section">
                        <label className="form-label"><Info size={14}/> Notas de Cocina</label>
                        <textarea
                            className="form-textarea"
                            rows="2"
                            placeholder="Ej: Sin cebolla, salsa aparte, bien cocido..."
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        ></textarea>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="modifiers-footer">
                    {allSelectedModifiers.length > 0 && (
                        <div className="selection-summary">
                            <span className="summary-label">Incluye:</span>
                            <div className="summary-tags">
                                {allSelectedModifiers.map((mod, i) => (
                                    <span key={mod.id || i} className="summary-tag">
                                        {mod.name} 
                                        {mod.price > 0 && <span className="tiny-price">+${mod.price}</span>}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="footer-bottom-row">
                        <div className="price-summary-container">
                            <span className="label-total">Total a Pagar</span>
                            <span className="final-price-display">${finalPrice.toFixed(2)}</span>
                        </div>
                        
                        <div className="actions-container">
                            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
                            <button
                                className={`btn-primary-action ${!isValid ? 'disabled' : ''}`}
                                onClick={handleConfirm}
                                disabled={!isValid}
                            >
                                {isValid ? (
                                    <>Agregar <span className="btn-price-tag">${finalPrice.toFixed(2)}</span></>
                                ) : (
                                    `Faltan ${missingRequiredGroups ? missingRequiredGroups.length : 0} opciones`
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
