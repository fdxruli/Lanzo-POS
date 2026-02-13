import { db } from '../database';

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
    Logger
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

        // 3. Actualizar Deuda de Cliente (ATÓMICO ⚛️)
        // Usamos .modify() para evitar condiciones de carrera si hay ventas simultáneas.
        if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
            await db.table(STORES.CUSTOMERS)
                .where('id').equals(sale.customerId)
                .modify(customer => {
                    // Suma atómica directa en la base de datos
                    customer.debt = (customer.debt || 0) + sale.saldoPendiente;
                })
                .catch(err => {
                    Logger?.error(`Error actualizando deuda del cliente ${sale.customerId}:`, err);
                });
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