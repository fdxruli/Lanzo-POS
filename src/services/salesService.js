import {
    loadData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe
} from './database';
import { useStatsStore } from '../store/useStatsStore';
import { roundCurrency, sendWhatsAppMessage } from './utils';
import { calculateCompositePrice } from './pricingLogic';
import Logger from './Logger';
import { processSaleCore } from './sales/processSaleCore';
import { sendReceiptWhatsApp as sendReceiptWhatsAppBase } from './sales/receiptWhatsApp';

export { updateDailyStats, getFastDashboardStats } from './sales/statsService';

const sendReceiptWhatsApp = (params) => sendReceiptWhatsAppBase({
    ...params,
    loadData,
    STORES,
    sendWhatsAppMessage,
    Logger
});

// 1. Renombramos la lógica original a una función interna (no exportada)
const _processSaleInternal = async (params) => {
    return processSaleCore(params, {
        loadData,
        saveData,
        STORES,
        queryBatchesByProductIdAndActive,
        queryByIndex,
        executeSaleTransactionSafe,
        useStatsStore,
        roundCurrency,
        sendReceiptWhatsApp,
        calculateCompositePrice,
        Logger
    });
};

// 2. Exportamos la función pública con la lógica de Retry
// Esto permite que la UI siga llamando a "processSale" sin cambios, pero ahora tiene superpoderes.
export const processSale = async (params, maxRetries = 3) => {
    Logger.info('Iniciando proceso de venta (Safe Mode)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Llamamos a la lógica interna
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

            // IMPORTANTE: Al reintentar, la función _processSaleInternal volverá a:
            // 1. Leer el stock fresco (src/services/sales/stockValidation.js)
            // 2. Recalcular lotes disponibles
            // 3. Intentar guardar
            continue;
        }

        // Si es otro tipo de error (ej: tarjeta rechazada, validación fallida), no reintentamos
        return result;
    }

    // Si agotamos los intentos
    Logger.error('Fallo en venta tras múltiples intentos de concurrencia.');
    return {
        success: false,
        errorType: 'MAX_RETRIES',
        message: 'El sistema está muy ocupado. Por favor intenta cobrar de nuevo.'
    };
};