import React, { useState, useMemo } from 'react';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useProductWizard } from '../../hooks/useProductWizard';

// Importar los formularios expertos (para edición)
import RestaurantProductForm from './forms/RestaurantProductForm.jsx';
import PharmacyProductForm from './forms/PharmacyProductForm';
import RetailProductForm from './forms/RetailProductForm';

// Importar el nuevo Wizard
import ProductFormWizard from './wizard/ProductFormWizard';

import './ProductForm.css';

const RUBRO_LABELS = {
    'food_service': 'Restaurante / Cocina',
    'abarrotes': 'Abarrotes / Tienda',
    'farmacia': 'Farmacia',
    'verduleria/fruteria': 'Frutería',
    'apparel': 'Ropa y Accesorios',
    'hardware': 'Ferretería',
    'otro': 'General'
};

export default function ProductForm(props) {
    const companyProfile = useAppStore(state => state.companyProfile);
    const [isExpertMode, setIsExpertMode] = useState(false);

    // 1. OBTENER GIROS GLOBALES
    const globalBusinessTypes = useMemo(() => {
        const types = companyProfile?.business_type;
        if (Array.isArray(types)) return types;
        if (typeof types === 'string') return types.split(',').map(s => s.trim()).filter(Boolean);
        return ['otro'];
    }, [companyProfile]);

    // 2. DETERMINAR EL CONTEXTO INICIAL
    const initialContext = useMemo(() => {
        const savedContext = props.productToEdit?.rubroContext;
        if (savedContext && globalBusinessTypes.includes(savedContext)) {
            return savedContext;
        }
        return globalBusinessTypes[0] || 'otro';
    }, [props.productToEdit, globalBusinessTypes]);

    const [activeRubroContext, setActiveRubroContext] = useState(initialContext);
    const features = useFeatureConfig(activeRubroContext);
    const ModeIcon = isExpertMode ? SlidersHorizontal : Sparkles;

    // 3. INITIALIZAR EL WIZARD (solo para productos nuevos en modo asistido)
    const wizard = useProductWizard(props.productToEdit, activeRubroContext);

    // 4. FACTORY LOGIC: ELEGIR FORMULARIO
    const renderForm = () => {
        // Si es edición O modo experto → usar formularios expertos
        if (props.productToEdit || isExpertMode) {
            switch (activeRubroContext) {
                case 'food_service':
                case 'restaurante':
                case 'cafeteria':
                    return <RestaurantProductForm {...props} activeRubroContext={activeRubroContext} features={features} />;

                case 'farmacia':
                case 'consultorio':
                    return <PharmacyProductForm {...props} activeRubroContext={activeRubroContext} features={features} />;

                case 'abarrotes':
                case 'verduleria/fruteria':
                case 'apparel':
                case 'hardware':
                case 'papeleria':
                default:
                    return <RetailProductForm {...props} activeRubroContext={activeRubroContext} features={features} />;
            }
        }

        // Producto nuevo en modo asistido → usar Wizard
        return (
            <ProductFormWizard
                wizard={wizard}
                categories={props.categories}
                onOpenCategoryManager={props.onOpenCategoryManager}
                activeRubroContext={activeRubroContext}
                onSave={props.onSave}
                onCancel={props.onCancel}
                productToEdit={props.productToEdit}
            />
        );
    };

    // Determinar si mostramos el selector de rubro
    const showRubroSelector = !props.productToEdit && globalBusinessTypes.length > 1;

    return (
        <div className="product-form-container">
            <div className="product-form-header">
                <h3 className="subtitle product-form-title">
                    {props.productToEdit ? `Editar: ${props.productToEdit.name}` : 'Añadir Nuevo Producto'}
                </h3>
                
                {/* Toggle Modo Asistido/Experto (solo para productos nuevos) */}
                {!props.productToEdit && (
                    <div className="product-form-mode-toggle" aria-label="Modo de registro de producto">
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(false)}
                            className={`product-form-mode-button ${!isExpertMode ? 'is-active' : ''}`}
                        >
                            <Sparkles size={16} aria-hidden="true" />
                            Asistido
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(true)}
                            className={`product-form-mode-button ${isExpertMode ? 'is-active' : ''}`}
                        >
                            <SlidersHorizontal size={16} aria-hidden="true" />
                            Experto
                        </button>
                    </div>
                )}
            </div>

            {/* Descripción del modo seleccionado */}
            {!props.productToEdit && (
                <div className={`product-form-mode-note ${isExpertMode ? 'is-expert' : ''}`}>
                    <span className="product-form-mode-icon" aria-hidden="true">
                        <ModeIcon size={18} />
                    </span>
                    <p className="product-form-mode-copy">
                        {isExpertMode 
                            ? 'Modo experto: todos los campos y opciones avanzadas disponibles. Ideal para productos complejos con recetas, variantes o configuración detallada.'
                            : 'Modo asistido: te guiamos paso a paso para registrar tu producto rápidamente. Perfecto para productos simples.'}
                    </p>
                </div>
            )}

            {/* SELECTOR DE CONTEXTO (Solo si hay múltiples rubros y es producto nuevo) */}
            {showRubroSelector && (
                <div className="context-selector">
                    <label className="context-selector-label">
                        ¿A qué área pertenece este producto?
                    </label>
                    <div className="context-selector-options">
                        {globalBusinessTypes.map(rubro => (
                            <button
                                key={rubro}
                                type="button"
                                onClick={() => setActiveRubroContext(rubro)}
                                className={`context-selector-button ${activeRubroContext === rubro ? 'is-active' : ''}`}
                            >
                                {RUBRO_LABELS[rubro] || rubro}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {renderForm()}
        </div>
    );
}
