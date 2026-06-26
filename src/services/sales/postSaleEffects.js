import { db } from '../database';
import { useSalesStore } from '../../store/useSalesStore';

export const runPostSaleEffects = async ({
    sale,
    processedItems,
    paymentData,
    total,
    companyName,
    features,
    loadData,
    saveData,
    STORES,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    Logger,
    skipLocalInventoryEffects = false
}) => {
    // 🛡️ 1. Guardabarrera de Idempotencia: Si ya se hizo, abortamos.
    if (sale.postEffectsCompleted) {
        Logger?.warn(`⚠️ Post-Effects omitidos: La venta ${sale.id} ya fue procesada.`);
        return;
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

        // 4. Enviar WhatsApp (En segundo plano)
        if (paymentData.sendReceipt && paymentData.customerId) {
            sendReceiptWhatsApp({
                sale,
                items: processedItems,
                paymentData,
                total,
                companyName,
                features
            }).catch(e => Logger?.error('Error enviando WhatsApp en background', e));
        }

        // 5. ✅ SELLADO FINAL: Marcar efectos como completados
        sale.postEffectsCompleted = true;
        // Usamos db.table().update() directo para evitar sobrescribir otros cambios si los hubiera
        await db.table(STORES.SALES).update(sale.id, { postEffectsCompleted: true });

    } catch (error) {
        Logger?.error('Error crítico en PostSaleEffects:', error);
    }
};

export const runPostSaleEffectsForCloudCommittedSale = async (args = {}) => runPostSaleEffects({
    ...args,
    skipLocalInventoryEffects: true
});
