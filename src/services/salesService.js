import {
    db,
    loadData,
    recycleData,
    saveData,
    saveDataSafe,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe,
    executeSplitOpenTableOrderTransactionSafe,
    loadMultipleData
} from './database';
import { useStatsStore } from '../store/useStatsStore';
import { roundCurrency, sendWhatsAppMessage } from './utils';
import { calculatePricingDetails } from './pricingLogic';
import Logger from './Logger';
import { processSaleCore } from './sales/processSaleCore';
import { splitOpenTableOrderCore } from './sales/splitOrderService';
import { sendReceiptWhatsApp as sendReceiptWhatsAppBase } from './sales/receiptWhatsApp';
import { cancelSaleCore } from './sales/cancelSaleCore';

export { updateDailyStats, getFastDashboardStats } from './sales/statsService';

const sendReceiptWhatsApp = (params) => sendReceiptWhatsAppBase({
    ...params,
    loadData,
    STORES,
    sendWhatsAppMessage,
    Logger
});

// 1. Renombramos la logica original a una funcion interna (no exportada)
const _processSaleInternal = async (params) => {
    return processSaleCore(params, {
        loadData,
        saveData,
        STORES,
        queryBatchesByProductIdAndActive,
        queryByIndex,
        executeSaleTransactionSafe,
        loadMultipleData,
        useStatsStore,
        roundCurrency,
        sendReceiptWhatsApp,
        calculatePricingDetails,
        Logger
    });
};

const _splitOpenTableOrderInternal = async (params) => {
    return splitOpenTableOrderCore(params, {
        loadData,
        loadMultipleData,
        STORES,
        executeSplitOpenTableOrderTransactionSafe,
        useStatsStore,
        roundCurrency,
        sendReceiptWhatsApp,
        Logger
    });
};

// 2. Exportamos la funcion publica con la logica de Retry
// Esto permite que la UI siga llamando a "processSale" sin cambios, pero ahora tiene superpoderes.
export const processSale = async (params, maxRetries = 3) => {
    Logger.info('Iniciando proceso de venta (Safe Mode)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Llamamos a la logica interna
        const result = await _processSaleInternal(params);

        // Si fue exitoso, retornamos inmediatamente
        if (result.success) {
            return result;
        }

        // Si es un error de concurrencia (Race Condition) y nos quedan intentos
        if (result.errorType === 'RACE_CONDITION' && attempt < maxRetries) {
            const delay = 100 * attempt; // 100ms, 200ms, 300ms...
            Logger.warn(`[Retry ${attempt}/${maxRetries}] Race condition detectada en inventario. Reintentando en ${delay}ms...`);

            // Pausa (Backoff)
            await new Promise(r => setTimeout(r, delay));

            // IMPORTANTE: Al reintentar, la funcion _processSaleInternal volvera a:
            // 1. Leer el stock fresco (src/services/sales/stockValidation.js)
            // 2. Recalcular lotes disponibles
            // 3. Intentar guardar
            continue;
        }

        // Si es otro tipo de error (ej: tarjeta rechazada, validacion fallida), no reintentamos
        return result;
    }

    // Si agotamos los intentos
    Logger.error('Fallo en venta tras multiples intentos de concurrencia.');
    return {
        success: false,
        errorType: 'MAX_RETRIES',
        message: 'El sistema esta muy ocupado. Por favor intenta cobrar de nuevo.'
    };
};

export const splitOpenTableOrder = async (params, maxRetries = 3) => {
    Logger.info('Iniciando split bill de mesa (Safe Mode)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await _splitOpenTableOrderInternal(params);

        if (result.success) {
            return result;
        }

        if (result.errorType === 'RACE_CONDITION' && attempt < maxRetries) {
            const delay = 100 * attempt;
            Logger.warn(`[Retry ${attempt}/${maxRetries}] Race condition detectada en split bill. Reintentando en ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
        }

        return result;
    }

    Logger.error('Fallo en split bill tras multiples intentos de concurrencia.');
    return {
        success: false,
        errorType: 'MAX_RETRIES',
        message: 'El sistema esta muy ocupado. Por favor intenta dividir/cobrar de nuevo.'
    };
};

export const cancelSale = async ({
    timestamp,
    restoreStock = false,
    currentSales = []
}) => {
    const result = await cancelSaleCore(
        {
            saleTimestamp: timestamp,
            restoreStock,
            currentSales
        },
        {
            loadData,
            saveDataSafe,
            recycleData,
            STORES,
            db,
            Logger
        }
    );

    if (result.success) {
        try {
            await useStatsStore.getState().rebuildFinancialStats();
        } catch (error) {
            Logger.warn('La venta se cancelo, pero no se pudieron reconstruir las metricas financieras.', error);
        }
    }

    return result;
};
