import React, { useState, useMemo } from 'react';
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
                    <div className="product-form-mode-toggle">
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(false)}
                            className={`product-form-mode-button ${!isExpertMode ? 'is-active' : ''}`}
                        >
                            ✨ Asistido
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(true)}
                            className={`product-form-mode-button ${isExpertMode ? 'is-active' : ''}`}
                        >
                            🛠️ Experto
                        </button>
                    </div>
                )}
            </div>

            {/* Descripción del modo seleccionado */}
            {!props.productToEdit && (
                <div style={{
                    marginBottom: '20px',
                    padding: '10px 14px',
                    backgroundColor: isExpertMode ? '#f8fafc' : '#eff6ff',
                    borderRadius: '8px',
                    border: `1px solid ${isExpertMode ? '#e2e8f0' : '#bfdbfe'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span style={{ fontSize: '1.2rem' }}>{isExpertMode ? '🛠️' : '✨'}</span>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: isExpertMode ? '#475569' : '#0c4a6e' }}>
                        {isExpertMode 
                            ? 'Modo experto: Todos los campos y opciones avanzadas disponibles. Ideal para productos complejos con recetas, variantes o configuración detallada.'
                            : 'Modo asistido: Te guiamos paso a paso para registrar tu producto rápidamente. Perfecto para productos simples.'}
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
