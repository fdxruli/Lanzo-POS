import React, { useState, useEffect } from 'react';
import './ProductModifiersModal.css';

export default function ProductModifiersModal({ show, onClose, product, onConfirm }) {
    const [selectedOptions, setSelectedOptions] = useState({}); // Mapa: { "GrupoID": [opciones] }
    const [note, setNote] = useState('');

    // Reiniciar estado al abrir
    useEffect(() => {
        if (show) {
            setSelectedOptions({});
            setNote('');
        }
    }, [show, product]);

    if (!show || !product) return null;

    // --- LÓGICA DE SELECCIÓN ---
    const handleOptionChange = (groupName, option, isMultiSelect) => {
        setSelectedOptions(prev => {
            const currentSelections = prev[groupName] || [];

            if (isMultiSelect) {
                // Checkbox logic (Toggle)
                const exists = currentSelections.find(opt => opt.name === option.name);
                if (exists) {
                    return { ...prev, [groupName]: currentSelections.filter(opt => opt.name !== option.name) };
                } else {
                    return { ...prev, [groupName]: [...currentSelections, option] };
                }
            } else {
                // Radio logic (Reemplazar)
                return { ...prev, [groupName]: [option] };
            }
        });
    };

    // --- CÁLCULOS ---
    const basePrice = product.price || 0;

    // Sumar precio de todos los modificadores seleccionados
    const modifiersTotal = Object.values(selectedOptions).flat().reduce((sum, opt) => sum + (opt.price || 0), 0);

    const finalPrice = basePrice + modifiersTotal;

    // --- VALIDACIÓN ---
    const missingRequired = product.modifiers?.filter(group => {
        // Es requerido Y (no tiene selección O la selección está vacía)
        return group.required && (!selectedOptions[group.name] || selectedOptions[group.name].length === 0);
    });

    const isValid = !missingRequired || missingRequired.length === 0;

    const handleConfirm = () => {
        // Aplanamos las opciones seleccionadas para guardarlas en el item del pedido
        const allSelectedModifiers = Object.values(selectedOptions).flat();

        // Construimos el objeto final
        const modifiedProduct = {
            ...product,
            price: finalPrice, // Precio actualizado
            originalPrice: finalPrice, // Importante para el store
            selectedModifiers: allSelectedModifiers, // Guardamos qué eligió para el ticket/cocina
            notes: note,
            // TRUCO: Generamos un ID único para que el carrito no agrupe 
            // este producto con otros que tengan diferentes modificadores.
            id: `${product.id}-mod-${Date.now()}`,
            // Guardamos el ID padre por si necesitamos referencia
            parentId: product.id
        };

        onConfirm(modifiedProduct);
    };

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-high)' }}>
            <div className="modal-content modifiers-modal">
                <div className="modifiers-header">
                    <h2 className="modal-title">{product.name}</h2>
                    <p className="base-price-label">Precio Base: ${basePrice.toFixed(2)}</p>
                </div>

                <div className="modifiers-body">
                    {product.modifiers && product.modifiers.map((group, idx) => (
                        <div key={idx} className="modifier-group">
                            <h4 className="modifier-group-title">
                                {group.name}
                                {group.required && <span className="badge-required">Obligatorio</span>}
                            </h4>

                            <div className="modifier-options-grid">
                                {group.options.map((opt, optIdx) => {
                                    const isSelected = selectedOptions[group.name]?.some(s => s.name === opt.name);
                                    // Asumimos que si es requerido es selección única (Radio), si no es Checkbox.
                                    // (Puedes cambiar esta lógica si quieres grupos requeridos de múltiple selección)
                                    const inputType = group.required ? 'radio' : 'checkbox';

                                    return (
                                        <label key={optIdx} className={`modifier-option-card ${isSelected ? 'selected' : ''}`}>
                                            <input
                                                type={inputType}
                                                name={`group-${idx}`} // Para agrupar los radio buttons
                                                checked={!!isSelected}
                                                onChange={() => handleOptionChange(group.name, opt, !group.required)}
                                                style={{ display: 'none' }} // Ocultamos el input nativo
                                            />
                                            <span className="opt-name">{opt.name}</span>
                                            {opt.price > 0 && <span className="opt-price">+${opt.price.toFixed(2)}</span>}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <div className="form-group" style={{ marginTop: '20px' }}>
                        <label className="form-label">Notas de Cocina (Opcional)</label>
                        <textarea
                            className="form-textarea"
                            rows="2"
                            placeholder="Ej: Sin cebolla, salsa aparte..."
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        ></textarea>
                    </div>
                </div>

                <div className="modifiers-footer">
                    <div className="price-summary">
                        <span>Total:</span>
                        <span className="final-price">${finalPrice.toFixed(2)}</span>
                    </div>
                    <div className="actions">
                        <button className="btn btn-cancel" onClick={onClose}>Cancelar</button>
                        <button
                            className="btn btn-save"
                            onClick={handleConfirm}
                            disabled={!isValid}
                            title={!isValid ? 'Faltan opciones obligatorias' : ''}
                        >
                            Agregar al Pedido
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}