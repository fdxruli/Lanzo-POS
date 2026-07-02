// src/hooks/useTableManagement.js
import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { splitOpenTableOrder } from '../../services/salesService';
import Logger from '../../services/Logger';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { selectCurrentOrder, useActiveOrders } from './useActiveOrders';
import { showInputPromptModal } from '../../components/common/InputPromptModal';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';
import { reconcileCartWithCancelledRestaurantItems } from '../../services/restaurant/restaurantOrderReconciliation';
import {
    getLicenseKeyFromDetails,
    isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';
import { getRestaurantOrderCloudStatusSnapshot } from '../restaurant/useRestaurantOrderCloudStatus';

const EMPTY_ORDER = [];

const SPLIT_BILL_INTEGRITY_OPTIONS = {
    reason: 'split_bill_checkout',
    transactionMode: true,
    refreshProfile: false,
    forceRemote: false,
    allowLocalOnly: true
};

const countSellableItems = (items = []) => (
    (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0).length
);

export function useTableManagement({
    openModal,
    closeModal,
    refreshData,
    checkHasOutOfStockProducts: _checkHasOutOfStockProducts,
    fetchActiveTablesCount,
    features,
    handleInitiateCheckout,
    cajaActual,
    asegurarCajaAbierta
}) {
    const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');
    const licenseDetails = useAppStore((state) => state.licenseDetails);
    const licenseKey = getLicenseKeyFromDetails(licenseDetails);
    const isCloudRestaurantOrdersEnabled = Boolean(
        features?.hasTables &&
        licenseKey &&
        licenseDetails?.valid !== false &&
        isRestaurantOrdersCloudEnabled(licenseDetails)
    );

    const saveOrderAsOpen = useActiveOrders((state) => state.saveOrderAsOpen);
    const loadOpenOrder = useActiveOrders((state) => state.loadOpenOrder);
    const currentOrder = useActiveOrders(selectCurrentOrder);
    const order = currentOrder?.items || EMPTY_ORDER;
    const activeOrderId = useActiveOrders((state) => state.currentOrderId);

    const clearSession = useCallback(() => {
        useActiveOrders.getState().cancelCurrentOrder();
    }, []);

    const syncOpenRestaurantOrderToCloud = useCallback(async (orderId) => {
        if (!isCloudRestaurantOrdersEnabled || !licenseKey) {
            return { skipped: true };
        }

        if (!orderId) {
            return { success: false, message: 'No se encontró la orden guardada.' };
        }

        try {
            const sale = await db.table(STORES.SALES).get(orderId);
            if (!sale) {
                return {
                    success: false,
                    message: 'No se encontró la venta local para enviar a cocina cloud.'
                };
            }

            const response = await restaurantOrdersRepository.upsertRestaurantOrderFromLocalSale({
                licenseKey,
                sale
            });

            if (response?.success === false) {
                return {
                    success: false,
                    message: response.message || response.code || 'No se pudo enviar a cocina cloud.',
                    response
                };
            }

            return { success: true, response };
        } catch (error) {
            Logger.warn('[REST.2] No se pudo enviar comanda cloud:', error);
            return {
                success: false,
                error,
                message: error?.message || 'No se pudo enviar a cocina cloud.'
            };
        }
    }, [isCloudRestaurantOrdersEnabled, licenseKey]);

    const handleSaveAsOpen = useCallback(async () => {
        if (!features?.hasTables) return;

        let currentOrderState = selectCurrentOrder(useActiveOrders.getState());
        const currentTableData = currentOrderState?.tableData;
        const isUpdating = Boolean(currentOrderState?.isSaved);

        if (!currentTableData || currentTableData.trim() === '') {
            const promptedName = await showInputPromptModal({
                title: 'Identificador de mesa',
                message: 'Ingresa un nombre o número para reconocer esta mesa.',
                placeholder: 'Ej. Mesa 1, Terraza, Cliente Juan',
                confirmButtonText: 'Guardar mesa',
                cancelButtonText: 'Cancelar',
                required: true
            });

            if (!promptedName) return;
            useActiveOrders.getState().updateCurrentOrder({ tableData: promptedName });
        }

        currentOrderState = selectCurrentOrder(useActiveOrders.getState());

        if (isUpdating && isCloudRestaurantOrdersEnabled && currentOrderState?.id) {
            try {
                const response = await getRestaurantOrderCloudStatusSnapshot({
                    licenseDetails,
                    localOrderId: currentOrderState.id,
                    force: true
                });
                const summary = response?.summary || {};

                if (response?.success !== false && response?.order && summary.hasCancelledItems) {
                    const reconciliation = reconcileCartWithCancelledRestaurantItems(
                        currentOrderState.items,
                        summary.items
                    );

                    if (reconciliation.hasUnmatchedCancelledItems) {
                        await showConfirmModal(
                            'Hay items cancelados en cocina que no se pudieron empatar con el carrito. Revisa la cuenta antes de actualizar la mesa.',
                            {
                                title: summary.isCancelled ? 'Comanda cancelada en cocina' : 'Items cancelados en cocina',
                                type: 'warning',
                                confirmButtonText: 'Entendido',
                                showCancel: false
                            }
                        );
                        return;
                    }

                    if (reconciliation.hasRemovableCancelledItems) {
                        const confirmed = await showConfirmModal(
                            `Cocina cancelo ${reconciliation.removedCount} item(s). Se retiraran de la cuenta antes de actualizar la mesa.`,
                            {
                                title: 'Ajustar cuenta',
                                type: 'warning',
                                confirmButtonText: 'Retirar y actualizar',
                                cancelButtonText: 'Volver'
                            }
                        );

                        if (!confirmed) return;

                        if (countSellableItems(reconciliation.kept) === 0) {
                            showMessageModal(
                                'No quedan productos activos para actualizar. Anula la venta si cocina cancelo toda la comanda.',
                                null,
                                { type: 'warning' }
                            );
                            return;
                        }

                        useActiveOrders.getState().updateOrderItems(currentOrderState.id, reconciliation.kept);
                    }
                }
            } catch (error) {
                Logger.warn('[REST.7] No se pudo verificar cocina antes de actualizar mesa:', error);
            }
        }

        const result = await saveOrderAsOpen();
        if (result.success) {
            const orderId = useActiveOrders.getState().currentOrderId || result.id;
            let cloudSyncResult = { skipped: true };

            try {
                await db.table(STORES.SALES).update(orderId, {
                    fulfillmentStatus: 'pending',
                    updatedAt: new Date().toISOString()
                });
            } catch (err) {
                Logger.error('Error actualizando fulfillmentStatus a pending:', err);
            }

            if (isCloudRestaurantOrdersEnabled) {
                cloudSyncResult = await syncOpenRestaurantOrderToCloud(orderId);
            }

            try {
                await useActiveOrders.getState().removeOrder(orderId);
            } catch (err) {
                Logger.error('No se pudo cerrar la pestaña activa:', err);
            }

            if (isCloudRestaurantOrdersEnabled) {
                if (cloudSyncResult?.success) {
                    showMessageModal(isUpdating ? '✅ Mesa actualizada y enviada a cocina cloud.' : '✅ Pedido guardado y enviado a cocina cloud.');
                } else {
                    showMessageModal(
                        '⚠️ Pedido guardado localmente, pero no se pudo enviar a cocina cloud.',
                        null,
                        { type: 'warning' }
                    );
                }
            } else {
                showMessageModal(isUpdating ? '✅ Mesa actualizada correctamente.' : '✅ Pedido guardado y enviado a cocina.');
            }

            await fetchActiveTablesCount();
            return;
        }

        showMessageModal(result.message || 'No se pudo guardar la orden abierta.', null, { type: 'error' });
    }, [
        features?.hasTables,
        saveOrderAsOpen,
        isCloudRestaurantOrdersEnabled,
        syncOpenRestaurantOrderToCloud,
        fetchActiveTablesCount,
        licenseDetails
    ]);

    const executeLoadOpenOrder = useCallback(async (orderId, silent = false) => {
        const result = await loadOpenOrder(orderId);
        if (result.success) {
            if (!silent) {
                closeModal('tables');
                showMessageModal('Mesa cargada en el pedido actual.');
            }
            await fetchActiveTablesCount();
            return result;
        }

        if (!silent) {
            showMessageModal(result.message || 'No se pudo cargar la orden abierta.', null, { type: 'error' });
        }
        return result;
    }, [loadOpenOrder, closeModal, fetchActiveTablesCount]);

    const reconcileKitchenCancelledItemsBeforeSplit = useCallback(async () => {
        const activeOrdersState = useActiveOrders.getState();
        const targetOrderId = activeOrdersState.currentOrderId || activeOrderId;
        const targetOrder = targetOrderId ? activeOrdersState.activeOrders.get(targetOrderId) : null;
        const targetItems = Array.isArray(targetOrder?.items) ? targetOrder.items : order;

        if (!features?.hasTables || !targetOrderId) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        const response = await getRestaurantOrderCloudStatusSnapshot({
            licenseDetails,
            localOrderId: targetOrderId,
            force: true
        });

        if (response?.skipped || response?.found === false || !response?.order) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        if (response?.success === false) {
            const canContinue = await showConfirmModal(
                'No se pudo verificar cocina cloud. Revisa antes de separar/cobrar.',
                {
                    title: 'Verificacion de cocina no disponible',
                    type: 'warning',
                    confirmButtonText: 'Continuar de todos modos',
                    cancelButtonText: 'Volver a revisar'
                }
            );

            return { canContinue, orderItems: targetItems, removedCount: 0 };
        }

        const summary = response.summary || {};
        if (!summary.hasCancelledItems) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        const reconciliation = reconcileCartWithCancelledRestaurantItems(targetItems, summary.items);

        if (reconciliation.hasUnmatchedCancelledItems) {
            await showConfirmModal(
                'Hay items cancelados en cocina que no se pudieron empatar con el carrito. Revisa la cuenta antes de separar/cobrar.',
                {
                    title: summary.isCancelled ? 'Comanda cancelada en cocina' : 'Items cancelados en cocina',
                    type: 'warning',
                    confirmButtonText: 'Entendido',
                    showCancel: false
                }
            );

            return { canContinue: false, orderItems: targetItems, removedCount: 0 };
        }

        const nextOrderItems = reconciliation.hasRemovableCancelledItems
            ? reconciliation.kept
            : targetItems;
        const removedCount = reconciliation.removedCount;

        if (reconciliation.hasRemovableCancelledItems) {
            useActiveOrders.getState().updateOrderItems(targetOrderId, nextOrderItems);
            showMessageModal(
                'Se retiraron de la cuenta los items cancelados por cocina.',
                null,
                { type: 'success' }
            );
        }

        const updatedOrder = useActiveOrders.getState().activeOrders.get(targetOrderId);
        const saveResult = await useActiveOrders.getState().saveOrderAsOpen(targetOrderId, updatedOrder);
        if (!saveResult?.success) {
            showMessageModal(
                saveResult?.message || 'No se pudo actualizar la mesa antes de separar/cobrar.',
                null,
                { type: 'error' }
            );
            return { canContinue: false, orderItems: nextOrderItems, removedCount };
        }

        const persistedSale = await db.table(STORES.SALES).get(targetOrderId);
        const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : nextOrderItems;
        useActiveOrders.getState().updateOrderItems(targetOrderId, persistedItems);

        return { canContinue: true, orderItems: persistedItems, removedCount };
    }, [features?.hasTables, activeOrderId, order, licenseDetails]);

    const handleLoadOpenOrder = useCallback((orderId) => {
        if (!features?.hasTables) return;

        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);
        if (!hasCurrentOrder) {
            void executeLoadOpenOrder(orderId);
            return;
        }

        showMessageModal(
            'Hay un carrito activo. Deseas reemplazarlo por la mesa seleccionada?',
            () => void executeLoadOpenOrder(orderId),
            {
                title: 'Cambiar mesa activa',
                type: 'warning',
                confirmButtonText: 'Si, cargar mesa'
            }
        );
    }, [features?.hasTables, order, executeLoadOpenOrder]);

    const handleQuickTableAction = useCallback(async (targetOrder, actionType) => {
        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);

        if (hasCurrentOrder) {
            showMessageModal(
                'Tienes un carrito activo sin guardar. Limpialo o guardalo antes de cobrar una mesa diferente.',
                null,
                { title: 'Acción bloqueada', type: 'error', confirmButtonText: 'Entendido' }
            );
            return;
        }

        try {
            const result = await executeLoadOpenOrder(targetOrder.id, true);
            if (!result?.success) {
                showMessageModal(result?.message || 'Error al cargar la mesa para cobro.', null, { type: 'error' });
                return;
            }

            closeModal('tables');

            if (actionType === 'checkout') {
                if (typeof handleInitiateCheckout === 'function') {
                    await handleInitiateCheckout();
                } else {
                    console.error('[useTableManagement] handleInitiateCheckout no está disponible.');
                    openModal('payment');
                }
            } else if (actionType === 'split') {
                const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
                if (!kitchenReview.canContinue) return;

                if (countSellableItems(kitchenReview.orderItems) === 0) {
                    showMessageModal('No hay productos en la mesa activa para dividir.');
                    return;
                }

                openModal('split');
            }
        } catch (error) {
            console.error('Error al cargar la mesa para acción rápida:', error);
        }
    }, [order, executeLoadOpenOrder, closeModal, openModal, handleInitiateCheckout, reconcileKitchenCancelledItemsBeforeSplit]);

    const handleAnnulKitchenRejectedOrder = useCallback(async (targetOrder) => {
        if (!features?.hasTables) return { success: false, message: 'Mesas no disponibles.' };
        if (!targetOrder?.id) return { success: false, message: 'Orden inválida.' };

        let isCancelledInKitchen = targetOrder.fulfillmentStatus === 'cancelled';

        if (!isCancelledInKitchen) {
            try {
                const response = await getRestaurantOrderCloudStatusSnapshot({
                    licenseDetails,
                    localOrderId: targetOrder.id,
                    force: true
                });
                isCancelledInKitchen = Boolean(response?.summary?.isCancelled);
            } catch (error) {
                Logger.warn('[REST.6] No se pudo confirmar cancelacion cloud antes de anular:', error);
            }
        }

        if (targetOrder.status === SALE_STATUS.OPEN && !isCancelledInKitchen) {
            return {
                success: false,
                message: 'Solo se puede anular desde aqui una comanda cancelada en cocina.'
            };
        }

        if (targetOrder.status !== SALE_STATUS.OPEN) {
            return {
                success: false,
                message: 'Solo se puede anular desde aquí una comanda abierta y rechazada en cocina.'
            };
        }

        const ok = await showConfirmModal('¿Anular esta venta en el sistema?', {
            title: 'Anular venta',
            type: 'warning',
            confirmButtonText: 'Sí, anular',
            cancelButtonText: 'Cancelar'
        });

        if (!ok) return { success: false, cancelled: true };

        try {
            const { useActiveOrders } = await import('./useActiveOrders.js');
            const result = await useActiveOrders.getState().cancelOpenSaleByIdFromPos(targetOrder.id);

            if (result.success) {
                showMessageModal('Venta anulada correctamente.', null, { type: 'success' });
                await fetchActiveTablesCount();
            } else {
                showMessageModal(result.message || 'No se pudo anular la venta.', null, { type: 'error' });
            }
            return result;
        } catch (error) {
            Logger.error('Error anulando comanda rechazada en cocina:', error);
            showMessageModal(error?.message || 'Error al anular la venta.', null, { type: 'error' });
            return { success: false, message: error?.message };
        }
    }, [features?.hasTables, fetchActiveTablesCount, licenseDetails]);

    const handleOpenSplitBill = useCallback(async () => {
        if (!features?.hasTables) return;
        if (!activeOrderId) {
            showMessageModal('No hay una mesa activa cargada para dividir.');
            return;
        }

        const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
        if (!kitchenReview.canContinue) return;

        if (countSellableItems(kitchenReview.orderItems) === 0) {
            showMessageModal('No hay productos en la mesa activa para dividir.');
            return;
        }

        openModal('split');
    }, [features?.hasTables, activeOrderId, reconcileKitchenCancelledItemsBeforeSplit, openModal]);

    const handleConfirmSplitBill = useCallback(async (splitPayload) => {
        const isSessionValid = await verifySessionIntegrity(SPLIT_BILL_INTEGRITY_OPTIONS);
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
        if (!kitchenReview.canContinue) return;

        if (kitchenReview.removedCount > 0) {
            closeModal('split');
            showMessageModal(
                'La cuenta cambio por items cancelados en cocina. Vuelve a abrir Separar pago para cobrar con los importes actualizados.',
                null,
                { type: 'warning' }
            );
            return;
        }

        if (countSellableItems(kitchenReview.orderItems) === 0) {
            closeModal('split');
            showMessageModal('No hay productos en la mesa activa para dividir.', null, { type: 'warning' });
            return;
        }

        const hasCashPayment = splitPayload?.tickets?.some(
            (ticket) => ticket?.paymentData?.paymentMethod === 'efectivo'
        );

        if (hasCashPayment && (!cajaActual || cajaActual.estado !== 'abierta')) {
            if (typeof asegurarCajaAbierta !== 'function') {
                showMessageModal('No se pudo abrir la caja automáticamente.', null, { type: 'error' });
                return;
            }

            try {
                await asegurarCajaAbierta();
            } catch (error) {
                Logger.error('No se pudo abrir caja para Split Bill:', error);
                showMessageModal(error?.message || 'No se pudo abrir la caja automáticamente.', null, { type: 'error' });
                return;
            }
        }

        try {
            const result = await splitOpenTableOrder({
                parentOrderId: activeOrderId,
                orderSnapshot: kitchenReview.orderItems,
                mode: splitPayload.mode,
                tickets: splitPayload.tickets,
                features,
                companyName
            });

            if (result.success) {
                clearSession();
                closeModal('split');
                showMessageModal('✅ Split bill aplicado y cobro registrado correctamente.');
                await refreshData();
                await fetchActiveTablesCount();
                return;
            }

            if (result.errorType === 'DIRTY_ORDER' || result.errorType === 'RACE_CONDITION') {
                showMessageModal(result.message, null, { type: 'warning' });
                if (result.errorType === 'RACE_CONDITION') await refreshData();
                return;
            }

            showMessageModal(result.message || 'No se pudo dividir/cobrar la mesa.', null, { type: 'error' });
        } catch (error) {
            Logger.error('Error crítico en Split Bill:', error);
            showMessageModal(`Error inesperado: ${error.message}`, null, { type: 'error' });
        }
    }, [
        activeOrderId,
        features,
        companyName,
        verifySessionIntegrity,
        reconcileKitchenCancelledItemsBeforeSplit,
        clearSession,
        closeModal,
        refreshData,
        fetchActiveTablesCount,
        cajaActual,
        asegurarCajaAbierta
    ]);

    return {
        handleSaveAsOpen,
        handleLoadOpenOrder,
        handleQuickTableAction,
        handleOpenSplitBill,
        handleConfirmSplitBill,
        handleAnnulKitchenRejectedOrder
    };
}
