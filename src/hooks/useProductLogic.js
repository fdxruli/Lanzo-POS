import { useState } from 'react';
import { generateID } from '../services/utils';

export const useProductLogic = (initialOverrides = {}) => {
    const defaults = {
        id: generateID('prod'),
        name: '',
        barcode: '',
        categoryId: '',
        cost: 0, 
        price: 0,
        margin: 0,
        stock: 0,
        minStock: 5,
        trackStock: true,
        productType: 'sellable',
        saleType: 'unit',
        unit: 'pza'
    };

    const [data, setData] = useState({
        ...defaults,
        ...initialOverrides
    });

    // Utilidad de redondeo estricto que retorna Number, no String.
    const roundNumber = (num, decimals = 2) => {
        const factor = Math.pow(10, decimals);
        return Math.round((Number(num) + Number.EPSILON) * factor) / factor;
    };

    const updatePriceLogic = (field, value) => {
        let { cost, price, margin } = data;
        const newData = { ...data };

        // Asegurar que las entradas manuales se traten como números
        if (field === 'cost') { cost = value; newData.cost = Number(value) || 0; }
        if (field === 'price') { price = value; newData.price = Number(value) || 0; }
        if (field === 'margin') { margin = value; newData.margin = Number(value) || 0; }

        const nCost = Number(cost) || 0;
        const nPrice = Number(price) || 0;
        const nMargin = Number(margin) || 0;

        if (field === 'cost' && nMargin > 0) {
            newData.price = roundNumber(nCost * (1 + (nMargin / 100)), 2);
        }
        else if (field === 'margin' && nCost >= 0) { // Aplica incluso si nCost es 0
            newData.price = roundNumber(nCost * (1 + (nMargin / 100)), 2);
        }
        else if (field === 'price') {
            if (nCost > 0) {
                newData.margin = roundNumber(((nPrice - nCost) / nCost) * 100, 1);
            } else if (nCost === 0 && nPrice > 0) {
                // Manejo de división por cero: Si no hay costo pero hay precio, el margen es 100%
                newData.margin = 100;
            } else {
                newData.margin = 0;
            }
        }

        setData(newData);
    };

    const setField = (field, value) => {
        setData(prev => ({ ...prev, [field]: value }));
    };

    return { data, setData, setField, updatePriceLogic };
};