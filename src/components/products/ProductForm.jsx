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
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: '20px' 
            }}>
                <h3 className="subtitle" style={{ margin: 0 }}>
                    {props.productToEdit ? `Editar: ${props.productToEdit.name}` : 'Añadir Nuevo Producto'}
                </h3>
                
                {/* Toggle Modo Asistido/Experto (solo para productos nuevos) */}
                {!props.productToEdit && (
                    <div style={{
                        display: 'flex',
                        backgroundColor: '#f1f5f9',
                        borderRadius: '8px',
                        padding: '4px',
                        gap: '4px'
                    }}>
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(false)}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: !isExpertMode ? 'white' : 'transparent',
                                color: !isExpertMode ? 'var(--primary-color)' : '#64748b',
                                fontWeight: !isExpertMode ? '600' : '400',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: !isExpertMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            ✨ Asistido
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsExpertMode(true)}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: isExpertMode ? 'white' : 'transparent',
                                color: isExpertMode ? 'var(--primary-color)' : '#64748b',
                                fontWeight: isExpertMode ? '600' : '400',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                boxShadow: isExpertMode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                            }}
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
                <div className="context-selector" style={{ marginBottom: '20px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: '#0369a1', marginBottom: '8px', fontWeight: 'bold' }}>
                        ¿A qué área pertenece este producto?
                    </label>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {globalBusinessTypes.map(rubro => (
                            <button
                                key={rubro}
                                type="button"
                                onClick={() => setActiveRubroContext(rubro)}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: '20px',
                                    border: activeRubroContext === rubro ? '2px solid #0284c7' : '1px solid #cbd5e1',
                                    backgroundColor: activeRubroContext === rubro ? 'white' : '#f1f5f9',
                                    color: activeRubroContext === rubro ? '#0284c7' : '#64748b',
                                    fontWeight: activeRubroContext === rubro ? 'bold' : 'normal',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
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