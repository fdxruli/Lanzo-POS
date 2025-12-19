// src/hooks/useProductLogic.js
import { useState } from 'react';
import { generateID } from '../services/utils';

export const useProductLogic = (initialData = {}) => {
    const [data, setData] = useState({
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
        productType: 'sellable', // sellable | ingredient
        ...initialData
    });

    // Lógica de cálculo de precios automática
    const updatePriceLogic = (field, value) => {
        let { cost, price, margin } = data;
        let newData = { ...data };

        if (field === 'cost') {
            cost = value;
            newData.cost = value;
        }
        if (field === 'price') {
            price = value;
            newData.price = value;
        }
        if (field === 'margin') {
            margin = value;
            newData.margin = value;
        }

        const nCost = parseFloat(cost) || 0;
        const nPrice = parseFloat(price) || 0;
        const nMargin = parseFloat(margin) || 0;

        // Si cambio el margen y tengo costo -> Calculo Precio
        if (field === 'margin' && nCost > 0) {
            newData.price = (nCost * (1 + (nMargin / 100))).toFixed(2);
        }
        // Si cambio precio o costo -> Recalculo Margen
        else if ((field === 'cost' || field === 'price') && nCost > 0 && nPrice > 0) {
            newData.margin = (((nPrice - nCost) / nCost) * 100).toFixed(1);
        }

        setData(newData);
    };

    const setField = (field, value) => {
        setData(prev => ({ ...prev, [field]: value }));
    };

    return { data, setData, setField, updatePriceLogic };
};