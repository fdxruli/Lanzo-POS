import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';

// Importar los nuevos formularios
import RestaurantProductForm from './forms/RestaurantProductForm.jsx';
import PharmacyProductForm from './forms/PharmacyProductForm';
import RetailProductForm from './forms/RetailProductForm';

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

    // 1. OBTENER GIROS GLOBALES
    const globalBusinessTypes = useMemo(() => {
        const types = companyProfile?.business_type;
        if (Array.isArray(types)) return types;
        if (typeof types === 'string') return types.split(',').map(s => s.trim()).filter(Boolean);
        return ['otro'];
    }, [companyProfile]);

    // 2. DETERMINAR EL CONTEXTO INICIAL
    // Si se está editando, respetar el contexto guardado, si no, usar el primero de la lista global
    const initialContext = props.productToEdit?.rubroContext || globalBusinessTypes[0] || 'otro';
    const [activeRubroContext, setActiveRubroContext] = useState(initialContext);

    // 3. OBTENER FEATURES DEL CONTEXTO
    const features = useFeatureConfig(activeRubroContext);

    // 4. FACTORY LOGIC: ELEGIR FORMULARIO
    const renderForm = () => {
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
                // Retail maneja la mayoría de casos "comunes" (Tienda, Ropa, Ferretería)
                return <RetailProductForm {...props} activeRubroContext={activeRubroContext} features={features} />;
        }
    };

    return (
        <div className="product-form-container">
            <h3 className="subtitle">
                {props.productToEdit ? `Editar: ${props.productToEdit.name}` : 'Añadir Nuevo Producto'}
            </h3>

            {/* SELECTOR DE CONTEXTO (Solo si hay múltiples rubros y es producto nuevo) */}
            {!props.productToEdit && globalBusinessTypes.length > 1 && (
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