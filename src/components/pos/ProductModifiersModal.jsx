import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, AlertCircle, Info, ShoppingCart, StickyNote } from 'lucide-react';
import { createCartLineId } from '../../utils/cartLineIdentity';
import {
    getModifierOptionLabel,
    normalizeModifierGroups,
    normalizeModifierOption,
    RESTAURANT_MODIFIER_SELECTION_TYPES
} from '../../utils/restaurantModifiers';
import './ProductModifiersModal.css';

const getGroupKey = (group = {}, index = 0) => String(group.id || group.name || index);

const getGroupInstruction = (group = {}) => {
    if (group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.SINGLE) {
        return group.minSelect > 0 ? 'Selecciona 1 opción' : 'Selecciona hasta 1 opción';
    }
    if (group.minSelect === group.maxSelect && group.minSelect > 0) {
        return `Selecciona ${group.minSelect} opciones`;
    }
    if (group.minSelect > 0) {
        return `Selecciona entre ${group.minSelect} y ${group.maxSelect} opciones`;
    }
    return `Elige hasta ${group.maxSelect} opciones`;
};

export default function ProductModifiersModal({ show, onClose, product, onConfirm }) {
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

    const allSelectedModifiers = useMemo(() =>
        Object.values(selectedOptions).flat(),
    [selectedOptions]);

    if (!show || !product) return null;

    const handleOptionChange = (group, groupIndex, option) => {
        const key = getGroupKey(group, groupIndex);
        setSelectedOptions(prev => {
            const currentSelections = prev[key] || [];
            const optionKey = option.id || option.name;
            const exists = currentSelections.some(opt => (opt.id || opt.name) === optionKey);

            if (group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE) {
                if (exists) {
                    return {
                        ...prev,
                        [key]: currentSelections.filter(opt => (opt.id || opt.name) !== optionKey)
                    };
                }
                if (currentSelections.length >= group.maxSelect) return prev;
                return { ...prev, [key]: [...currentSelections, option] };
            }

            if (exists && group.minSelect === 0) {
                return { ...prev, [key]: [] };
            }
            return { ...prev, [key]: [option] };
        });
    };

    const basePrice = product.price || 0;
    const modifiersTotal = allSelectedModifiers.reduce((sum, opt) => sum + (Number(opt.price) || 0), 0);
    const finalPrice = basePrice + modifiersTotal;

    const invalidGroups = normalizedModifierGroups.filter((group, index) => {
        const currentSelections = selectedOptions[getGroupKey(group, index)] || [];
        return currentSelections.length < group.minSelect || currentSelections.length > group.maxSelect;
    });
    const isValid = invalidGroups.length === 0;
    const completedGroupsCount = normalizedModifierGroups.filter((group, index) => {
        const currentSelections = selectedOptions[getGroupKey(group, index)] || [];
        return currentSelections.length >= group.minSelect && currentSelections.length <= group.maxSelect;
    }).length;

    const handleConfirm = () => {
        if (!isValid) return;
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
                                <AlertCircle size={14} /> Faltan {invalidGroups.length}
                            </span>
                        )}
                    </div>
                </div>

                <div className="modifiers-layout">
                    <div className="modifiers-body">
                        {normalizedModifierGroups.map((group, idx) => {
                            const groupKey = getGroupKey(group, idx);
                            const currentGroupSelection = selectedOptions[groupKey] || [];
                            const isSatisfied = currentGroupSelection.length >= group.minSelect
                                && currentGroupSelection.length <= group.maxSelect;
                            const isMultiple = group.selectionType === RESTAURANT_MODIFIER_SELECTION_TYPES.MULTIPLE;
                            const atMaximum = currentGroupSelection.length >= group.maxSelect;

                            return (
                                <section key={groupKey} className={`modifier-group ${!isSatisfied ? 'group-pending' : 'group-completed'}`}>
                                    <div className="modifier-group-header">
                                        <div>
                                            <h4 className="group-title">{group.name}</h4>
                                            <span className="group-instruction">
                                                {getGroupInstruction(group)}
                                            </span>
                                        </div>
                                        {group.minSelect > 0 ? (
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
                                            const inputType = !isMultiple && group.minSelect > 0 ? 'radio' : 'checkbox';
                                            const optionLabel = getModifierOptionLabel(opt);
                                            const optionPrice = Number(opt.price) || 0;
                                            const disabled = isMultiple && atMaximum && !isSelected;

                                            return (
                                                <label key={opt.id || optIdx} className={`modifier-option-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}>
                                                    <input
                                                        type={inputType}
                                                        name={`group-${groupKey}`}
                                                        checked={!!isSelected}
                                                        disabled={disabled}
                                                        onChange={() => handleOptionChange(group, idx, opt)}
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
                                `Faltan ${invalidGroups.length} grupos`
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
