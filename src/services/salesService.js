import {
    db,
    loadData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe,
    executeSplitOpenTableOrderTransactionSafe,
    loadMultipleData,
    productsRepository
} from './database';
import { useStatsStore } from '../store/useStatsStore';
import { generateID, roundCurrency, sendWhatsAppMessage } from './utils';
import { calculatePricingDetails } from './pricingLogic';
import Logger from './Logger';
import { processSaleCore } from './sales/processSaleCore';
import { splitOpenTableOrderCore } from './sales/splitOrderService';
import { sendReceiptWhatsApp as sendReceiptWhatsAppBase } from './sales/receiptWhatsApp';
import { cancelSaleCore } from './sales/cancelSaleCore';
import { restoreDeletedSaleCore } from './sales/restoreDeletedSaleCore';

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
    currentSales = [],
    dispositionPlan = null,
    reason = '',
    cancelledBy = 'local-user',
    allowWaste = false
}) => {
    const result = await cancelSaleCore(
        {
            saleTimestamp: timestamp,
            restoreStock,
            currentSales,
            dispositionPlan,
            reason,
            cancelledBy,
            allowWaste
        },
        {
            STORES,
            db,
            Logger,
            generateId: generateID,
            restoreStockFromCancellation: (items) =>
                productsRepository.restoreStockFromCancellation(items)
        }
    );

    if (result.success) {
      try {
            if (result.restoreStock && result.restoredInventoryValue > 0) {
                await useStatsStore.getState().adjustInventoryValue(result.restoredInventoryValue);
            }
            await useStatsStore.getState().rebuildFinancialStats();
        } catch (error) {
            Logger.warn('La venta se cancelo, pero no se pudieron reconstruir las metricas financieras.', error);
        }
    }

    return result;
};

export const restoreDeletedSale = async (saleId) => {
    const result = await restoreDeletedSaleCore(
        { saleId },
        {
            db,
            STORES,
            Logger,
            generateId: generateID,
            reapplyStockFromCancellation: (items) =>
                productsRepository.reapplyStockFromCancellation(items)
        }
    );

    if (result.success) {
        try {
            await useStatsStore.getState().rebuildFinancialStats();
        } catch (error) {
            Logger.warn('La venta se restauro, pero no se pudieron reconstruir las metricas.', error);
        }
    }

    return result;
};

export const moveCancelledSaleToTrash = async (saleId) => {
    try {
        await db.transaction(
            'rw',
            [STORES.SALES, STORES.DELETED_SALES],
            async () => {
                const sale = await db.table(STORES.SALES).get(saleId);
                if (!sale) {
                    const error = new Error('La venta ya no existe en el historial.');
                    error.code = 'NOT_FOUND';
                    throw error;
                }
                if (sale.status !== 'cancelled') {
                    const error = new Error('Solo las ventas canceladas pueden moverse a papelera.');
                    error.code = 'NOT_CANCELLED';
                    throw error;
                }

                const deletedAt = new Date().toISOString();
                await db.table(STORES.DELETED_SALES).put({
                    ...sale,
                    deletedAt,
                    deletedTimestamp: deletedAt,
                    deletedReason: 'Venta cancelada archivada',
                    originalStore: STORES.SALES
                });
                await db.table(STORES.SALES).delete(sale.id);
            }
        );
        return { success: true, code: 'MOVED_TO_TRASH', saleId };
    } catch (error) {
        Logger.error('Error moviendo venta cancelada a papelera:', error);
        return {
            success: false,
            code: error?.code || 'TRASH_FAILED',
            message: error?.message || 'No se pudo mover la venta a papelera.'
        };
    }
};
