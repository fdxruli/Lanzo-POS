import { db } from '../database';
import { useSalesStore } from '../../store/useSalesStore';
import { notificationNotRequested, prepareCustomerMessageOutbox } from '../customerMessaging/index.js';

const NOTIFICATION_STATUSES = new Set([
    'not_requested',
    'missing_phone',
    'invalid_phone',
    'payload_invalid',
    'ready',
    'opened',
    'cancelled',
    'unsupported',
    'failed'
]);

const normalizeNotificationResult = (result) => {
    if (result?.status && NOTIFICATION_STATUSES.has(result.status)) return result;
    if (result === true) return { status: 'opened', code: null };
    if (result === false || result === null) {
        return { status: 'failed', code: 'IMAGE_RECEIPT_PREPARATION_FAILED' };
    }
    return { status: 'failed', code: 'NOTIFICATION_RESULT_INVALID' };
};

const notificationFailureResult = (error) => ({
    status: 'failed',
    code: error?.code || 'IMAGE_RECEIPT_PREPARATION_FAILED',
    message: error?.message || 'No se pudo preparar el comprobante.'
});

export const runPostSaleEffects = async ({
    sale,
    processedItems,
    paymentData,
    total,
    companyName,
    features,
    loadData: _loadData,
    saveData: _saveData,
    STORES,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    prepareMessageOutbox = prepareCustomerMessageOutbox,
    Logger,
    skipLocalInventoryEffects = false
}) => {
    let notificationResult = notificationNotRequested();

    // 🛡️ 1. Guardabarrera de Idempotencia: Si ya se hizo, abortamos.
    if (sale.postEffectsCompleted) {
        Logger?.warn(`⚠️ Post-Effects omitidos: La venta ${sale.id} ya fue procesada.`);
        return { notificationResult, skipped: true };
    }

    try {
        // 2. Actualizar Estadísticas (Store)
        const costOfGoodsSold = processedItems.reduce(
            (acc, item) => roundCurrency(acc + roundCurrency(item.cost * item.quantity)),
            0
        );
        await useStatsStore.getState().updateStatsForNewSale(sale, costOfGoodsSold);

        // Actualizar el historial de ventas recientes en el store para que el
        // Dashboard (StatsGrid y SalesHistory) reflejen la venta de inmediato.
        useSalesStore.getState().loadRecentSales().catch(
            e => Logger?.error('Error actualizando ventas recientes post-venta', e)
        );

        // FASE 6C:
        // Este módulo no debe descontar inventario por sí mismo. El parámetro
        // skipLocalInventoryEffects deja explícito que una venta cloud committed
        // ya aplicó inventario en Supabase y Dexie debe quedar solo como cache.
        if (skipLocalInventoryEffects) {
            Logger?.info?.('PostSaleEffects cloud-safe: inventario local omitido; Supabase es la fuente oficial.');
        }

        // 4. Después del compromiso financiero sólo se prepara el payload.
        // Compartir el PNG queda reservado a una acción explícita en la UI.
        if (paymentData?.sendReceipt) {
            try {
                const result = typeof sendReceiptWhatsApp === 'function'
                    ? await sendReceiptWhatsApp({
                        sale,
                        items: processedItems,
                        paymentData,
                        total,
                        companyName,
                        features
                    })
                    : { status: 'unsupported', code: 'IMAGE_PAYLOAD_BUILDER_UNAVAILABLE' };
                notificationResult = normalizeNotificationResult(result);

                if (notificationResult.status === 'ready' && notificationResult.payload) {
                    try {
                        const preparedOutbox = typeof prepareMessageOutbox === 'function'
                            ? await prepareMessageOutbox({ payload: notificationResult.payload })
                            : { ok: false, code: 'OUTBOX_PREPARER_UNAVAILABLE' };
                        notificationResult = preparedOutbox?.ok
                            ? {
                                ...notificationResult,
                                outboxRecord: preparedOutbox.record,
                                outboxDuplicate: preparedOutbox.duplicate === true
                            }
                            : {
                                ...notificationResult,
                                outboxErrorCode: preparedOutbox?.code || 'OUTBOX_PERSISTENCE_FAILED'
                            };
                    } catch (outboxError) {
                        Logger?.error('Error registrando comprobante en outbox', outboxError);
                        notificationResult = {
                            ...notificationResult,
                            outboxErrorCode: outboxError?.code || 'OUTBOX_PERSISTENCE_FAILED'
                        };
                    }
                }
            } catch (notificationError) {
                Logger?.error('Error preparando comprobante de imagen', notificationError);
                notificationResult = notificationFailureResult(notificationError);
            }
        }

        // 5. ✅ SELLADO FINAL: Marcar efectos como completados
        sale.postEffectsCompleted = true;
        // Usamos db.table().update() directo para evitar sobrescribir otros cambios si los hubiera
        await db.table(STORES.SALES).update(sale.id, { postEffectsCompleted: true });

        return { notificationResult };

    } catch (error) {
        Logger?.error('Error crítico en PostSaleEffects:', error);
        return { notificationResult };
    }
};

export const runPostSaleEffectsForCloudCommittedSale = async (args = {}) => runPostSaleEffects({
    ...args,
    skipLocalInventoryEffects: true
});

export const postSaleEffectsInternals = Object.freeze({
    normalizeNotificationResult,
    notificationFailureResult
});
