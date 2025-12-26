// src/hooks/useProductLogic.js
import { useState, useEffect } from 'react';
import { generateID } from '../services/utils';

export const useProductLogic = (initialOverrides = {}) => {
    // Definimos valores por defecto seguros
    const defaults = {
        id: generateID('prod'),
        name: '',
        barcode: '',
        categoryId: '',
        cost: '',
        price: '',
        margin: '',
        stock: '',
        minStock: 5,
        trackStock: true,
        productType: 'sellable',
        saleType: 'unit', // Default seguro
        unit: 'pza'
    };

    // Fusionamos defaults + overrides
    const [data, setData] = useState({
        ...defaults,
        ...initialOverrides
    });

    // Lógica de cálculo de precios automática
    const updatePriceLogic = (field, value) => {
        let { cost, price, margin } = data;
        let newData = { ...data };

        // Actualizamos el campo específico
        if (field === 'cost') { cost = value; newData.cost = value; }
        if (field === 'price') { price = value; newData.price = value; }
        if (field === 'margin') { margin = value; newData.margin = value; }

        const nCost = parseFloat(cost) || 0;
        const nPrice = parseFloat(price) || 0;
        const nMargin = parseFloat(margin) || 0;

        // Regla 1: Costo cambia -> Recalcular Precio (manteniendo margen) O Recalcular Margen (manteniendo precio)?
        // UX Standard: Si tengo margen definido, respeto el margen.
        if (field === 'cost' && nMargin > 0) {
             newData.price = (nCost * (1 + (nMargin / 100))).toFixed(2);
        }
        
        // Regla 2: Margen cambia -> Calculo Precio
        else if (field === 'margin' && nCost > 0) {
            newData.price = (nCost * (1 + (nMargin / 100))).toFixed(2);
        }
        
        // Regla 3: Precio cambia -> Recalculo Margen
        else if (field === 'price' && nCost > 0) {
            // Evitamos división por cero
            newData.margin = (((nPrice - nCost) / nCost) * 100).toFixed(1);
        }

        setData(newData);
    };

    const setField = (field, value) => {
        setData(prev => ({ ...prev, [field]: value }));
    };

    return { data, setData, setField, updatePriceLogic };
};