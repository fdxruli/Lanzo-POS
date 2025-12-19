// src/components/products/ProductWizard.jsx
import React, { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import GroceryWizard from './wizards/GroceryWizard';
import RestaurantWizard from './wizards/RestaurantWizard';
// Importar otros wizards futuros aquí...

export default function ProductWizard(props) {
    const companyProfile = useAppStore(state => state.companyProfile);

    const mainRubro = useMemo(() => {
        const types = companyProfile?.business_type || [];
        return Array.isArray(types) ? types[0]?.toLowerCase() : 'general';
    }, [companyProfile]);

    // DECISIÓN DE WIZARD SEGÚN RUBRO
    switch (mainRubro) {
        case 'food_service':
        case 'restaurante':
        case 'cafeteria':
            return <RestaurantWizard {...props} />;
            
        case 'abarrotes':
        case 'farmacia':
        case 'fruteria':
        case 'papeleria':
            return <GroceryWizard {...props} mainRubro={mainRubro} />;

        default:
            // Por defecto usamos el de Abarrotes pero en modo genérico
            return <GroceryWizard {...props} mainRubro="general" />;
    }
}