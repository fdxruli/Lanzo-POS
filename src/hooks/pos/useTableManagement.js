// src/hooks/useTableManagement.js
import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { splitOpenTableOrder } from '../../services/salesService';
import { splitRequiresCashSessionCompatibility } from '../../services/sales/splitOrderContract';
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
import { closeRestaurantCloudOrderAfterSuccessfulSplitPayment } from '../../services/restaurant/restaurantOrderCheckoutClose';
import {
    ECOMMERCE_POS_CHECKOUT_MESSAGE,
    getEcommercePosBlockedResult,
    isEcommercePosEffectBlocked
} from '../../services/ecommerce/ecommercePosDraftGuards';
import { captureRefundsActorHandle } from '../../services/auth/refundsActorAuthorization';
import { salesCloudCashierService } from '../../services/salesCloud/salesCloudCashierService';
import { cashRepository } from '../../services/cash/cashRepository';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { handlePosActorAuthorityError, runPosActorUiOperation } from './posActorAuthorityUi';
import { hydrateRestaurantCloudOrderToLocalOpenSale } from '../../services/restaurant/restaurantTableHydration';
import { getRestaurantCloudTableState } from '../../services/restaurant/restaurantActiveTables';
import { isRestaurantCloudTableShadow, isRestaurantCloudTableTerminal, restaurantCloudTableBlockedResult, restaurantCloudTableSplitBlockedResult, restaurantCloudTableTerminalBlockedResult } from '../../services/restaurant/restaurantCloudTableGuards';
import { RESTAURANT_CLOUD_STATUS_EVENT } from '../../services/restaurant/restaurantCloudStatusSummary';

const EMPTY_ORDER = [];
const durableTableCleanupPending = (id, recoveryRequired = false) => ({
    success: true, id, durableSaveSucceeded: true, cleanupPending: true, recoveryRequired
});

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

    const blockEcommerceRestaurantEffect = useCallback(() => {
        const liveOrder = selectCurrentOrder(useActiveOrders.getState());
        if (!isEcommercePosEffectBlocked(liveOrder)) return null;

        showMessageModal(ECOMMERCE_POS_CHECKOUT_MESSAGE, null, { type: 'warning' });
        return getEcommercePosBlockedResult();
    }, []);

    const blockRemoteSplit = useCallback(async () => {
        const liveOrder = selectCurrentOrder(useActiveOrders.getState());
        let result = isRestaurantCloudTableTerminal(liveOrder)
            ? restaurantCloudTableTerminalBlockedResult(liveOrder)
            : isRestaurantCloudTableShadow(liveOrder) ? restaurantCloudTableSplitBlockedResult() : null;
        if (!result && liveOrder?.id) {
            const splitActor = actorRuntimeController.capture();
            const durableOrder = await db.table(STORES.SALES).get(liveOrder.id);
            splitActor.assertCurrent();
            result = isRestaurantCloudTableTerminal(durableOrder)
                ? restaurantCloudTableTerminalBlockedResult(durableOrder)
                : isRestaurantCloudTableShadow(durableOrder) ? restaurantCloudTableSplitBlockedResult() : null;
        }
        if (result) showMessageModal(result.message, null, { type: 'warning' });
        return result;
    }, []);

    const syncOpenRestaurantOrderToCloud = useCallback(async (orderId, saveActor) => {
        if (!isCloudRestaurantOrdersEnabled || !licenseKey) {
            return { skipped: true };
        }

        if (!orderId) {
            return { success: false, message: 'No se encontró la orden guardada.' };
        }

        try {
            saveActor.assertCurrent();
            const sale = await db.table(STORES.SALES).get(orderId);
            saveActor.assertCurrent();
            if (!sale) {
                return {
                    success: false,
                    message: 'No se encontró la venta local para enviar a cocina cloud.'
                };
            }

            saveActor.assertCurrent();
            const response = await restaurantOrdersRepository.upsertRestaurantOrderFromLocalSale({
                licenseKey,
                sale
            });
            saveActor.assertCurrent();
            window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));

            if (response?.success === false) {
                return {
                    success: false,
                    message: response.message || response.code || 'No se pudo enviar a cocina cloud.',
                    response
                };
            }

            const remoteOrder = response?.order || response?.restaurantOrder || null;
            const remoteUpdatedAt = remoteOrder?.updatedAt || remoteOrder?.updated_at || null;
            if (remoteUpdatedAt) {
                try {
                    saveActor.assertCurrent();
                    await db.table(STORES.SALES).update(orderId, {
                        updatedAt: remoteUpdatedAt,
                        cloudRestaurantOrderUpdatedAt: remoteUpdatedAt,
                        cloudRestaurantOrderServerVersion: remoteOrder?.serverVersion ?? remoteOrder?.server_version ?? null
                    });
                    saveActor.assertCurrent();
                } catch (localTokenError) {
                    if (localTokenError?.code?.startsWith('ACTOR_')) throw localTokenError;
                    Logger.warn('[REST.2] La comanda cloud se guardó, pero no se pudo actualizar el token local:', localTokenError);
                }
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
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return blocked;
        if (!features?.hasTables) return;

        let durableOrderId = selectCurrentOrder(useActiveOrders.getState())?.id || null;
        try {
            const saveActor = actorRuntimeController.capture();
            const durableBeforeSave = durableOrderId ? await db.table(STORES.SALES).get(durableOrderId) : null;
            saveActor.assertCurrent();
            if (durableBeforeSave?.tableTabCleanup?.status === 'pending'
                && !selectCurrentOrder(useActiveOrders.getState())?.isSaved) {
                showMessageModal('La mesa ya quedó guardada. Vuelve a cargarla antes de editarla.', null, { type: 'warning' });
                return durableTableCleanupPending(durableOrderId);
            }

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
                saveActor.assertCurrent();

                if (!promptedName) return;
                useActiveOrders.getState().updateCurrentOrder({ tableData: promptedName });
            }

            currentOrderState = selectCurrentOrder(useActiveOrders.getState());
            if (isEcommercePosEffectBlocked(currentOrderState)) {
                return blockEcommerceRestaurantEffect();
            }

            if (isUpdating && isCloudRestaurantOrdersEnabled && currentOrderState?.id) {
                try {
                    const response = await getRestaurantOrderCloudStatusSnapshot({
                        licenseDetails,
                        localOrderId: currentOrderState.id,
                        force: true
                    });
                    saveActor.assertCurrent();
                    const authorityResult = response?.success === false && handlePosActorAuthorityError(response, 'save_table');
                    if (authorityResult) return authorityResult;
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
                            saveActor.assertCurrent();

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
                    const handled = handlePosActorAuthorityError(error, 'save_table');
                    if (handled) return handled;
                    Logger.warn('[REST.7] No se pudo verificar cocina antes de actualizar mesa:', error);
                }
            }

            durableOrderId = currentOrderState?.id || durableOrderId;
            saveActor.assertCurrent();
            const result = await saveOrderAsOpen(durableOrderId, currentOrderState, {
                tableTabCleanup: { status: 'pending', actorKey: saveActor.actorKey, createdAt: new Date().toISOString() }
            });
            if (result.success) {
                const orderId = result.id || durableOrderId;
                durableOrderId = orderId;
                let cloudSyncResult = { skipped: true };

                if (isCloudRestaurantOrdersEnabled) {
                    saveActor.assertCurrent();
                    cloudSyncResult = await syncOpenRestaurantOrderToCloud(orderId, saveActor);
                }

                const cloudAuthority = handlePosActorAuthorityError(
                    cloudSyncResult?.error || cloudSyncResult?.response,
                    'save_table', { durableSaveSucceeded: true }
                );
                try {
                    saveActor.assertCurrent();
                    await useActiveOrders.getState().removeOrder(orderId);
                } catch (err) {
                    const handled = handlePosActorAuthorityError(err, 'save_table', { durableSaveSucceeded: true });
                    if (!handled) showMessageModal('La mesa quedó guardada, pero falta cerrar el pedido activo. Vuelve a cargarla antes de editarla.', null, { type: 'warning' });
                    await fetchActiveTablesCount();
                    return durableTableCleanupPending(orderId, handled?.recoveryRequired || cloudAuthority?.recoveryRequired);
                }

                // This is runtime bookkeeping only; the table and its reservation
                // stay durable even if authority expires before this acknowledgement.
                try {
                    saveActor.assertCurrent();
                    await db.table(STORES.SALES).update(orderId, { tableTabCleanup: null });
                    saveActor.assertCurrent();
                } catch (error) {
                    const handled = handlePosActorAuthorityError(error, 'save_table', { durableSaveSucceeded: true });
                    if (handled) return durableTableCleanupPending(orderId, handled.recoveryRequired);
                    Logger.warn('La mesa quedó guardada; se conserva el marcador de limpieza del pedido.');
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
                return result;
            }

            const failedSaveAuthority = handlePosActorAuthorityError(result, 'save_table');
            if (failedSaveAuthority) return failedSaveAuthority;
            showMessageModal(result.message || 'No se pudo guardar la orden abierta.', null, { type: 'error' });
            return result;
        } catch (error) {
            let durableSale = null;
            try { durableSale = durableOrderId ? await db.table(STORES.SALES).get(durableOrderId) : null; } catch { /* authority may also deny the read */ }
            const saved = durableSale?.tableTabCleanup?.status === 'pending';
            const handled = handlePosActorAuthorityError(error, 'save_table', { durableSaveSucceeded: saved });
            if (saved) {
                if (!handled) showMessageModal('La mesa quedó guardada, pero falta cerrar el pedido activo. Vuelve a cargarla antes de editarla.', null, { type: 'warning' });
                return durableTableCleanupPending(durableOrderId, handled?.recoveryRequired);
            }
            if (handled) return handled;
            showMessageModal('No se pudo guardar la mesa. Revisa el pedido y vuelve a intentarlo.', null, { type: 'error' });
            return { success: false, code: 'TABLE_SAVE_FAILED' };
        }
    }, [
        blockEcommerceRestaurantEffect,
        features?.hasTables,
        saveOrderAsOpen,
        isCloudRestaurantOrdersEnabled,
        syncOpenRestaurantOrderToCloud,
        fetchActiveTablesCount,
        licenseDetails
    ]);

    const executeLoadOpenOrder = useCallback(async (orderId, silent = false) => {
        try {
            const loadActor = actorRuntimeController.capture();
            const localSale = await db.table(STORES.SALES).get(orderId);
            loadActor.assertCurrent();
            if (localSale?.restaurantCloudTerminalState === 'terminal') {
                const message = localSale.restaurantCloudTerminalPaymentStatus === 'paid'
                    ? 'La mesa ya fue cobrada.' : 'La mesa ya no está activa. Actualiza las mesas.';
                showMessageModal(message, null, { type: 'warning' });
                return { success: false, code: 'CLOUD_TABLE_TERMINAL', message };
            }
            if (isCloudRestaurantOrdersEnabled && (!localSale || isRestaurantCloudTableShadow(localSale))) {
                const hydrated = await hydrateRestaurantCloudOrderToLocalOpenSale({
                    licenseKey, localOrderId: orderId, actorHandle: loadActor
                });
                loadActor.assertCurrent();
                if (!hydrated.success) {
                    showMessageModal(hydrated.message, null, { type: 'warning' });
                    return hydrated;
                }
            } else if (isCloudRestaurantOrdersEnabled && navigator.onLine !== false) {
                const current = await getRestaurantOrderCloudStatusSnapshot({ licenseDetails,
                    localOrderId: orderId, force: true });
                loadActor.assertCurrent();
                if (current?.success !== false && current?.order && getRestaurantCloudTableState(current.order) === 'terminal') {
                    const message = current.order.paymentStatus === 'paid'
                        ? 'La mesa ya fue cobrada.' : 'La mesa ya no está activa. Actualiza las mesas.';
                    showMessageModal(message, null, { type: 'warning' });
                    return { success: false, code: 'CLOUD_TABLE_TERMINAL', message };
                }
            }
            const result = await loadOpenOrder(orderId);
            loadActor.assertCurrent();
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
        } catch (error) {
            const handled = handlePosActorAuthorityError(error, 'load_table');
            if (handled) return handled;
            if (!silent) showMessageModal('No se pudo cargar la mesa. Vuelve a intentarlo.', null, { type: 'error' });
            return { success: false, code: 'TABLE_LOAD_FAILED' };
        }
    }, [loadOpenOrder, closeModal, fetchActiveTablesCount, isCloudRestaurantOrdersEnabled, licenseDetails, licenseKey]);

    const reconcileKitchenCancelledItemsBeforeSplit = useCallback(async () => {
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return { ...blocked, canContinue: false, orderItems: [], removedCount: 0 };

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
        const authorityResult = response?.success === false && handlePosActorAuthorityError(response, 'split_checkout');
        if (authorityResult) return { ...authorityResult, canContinue: false, orderItems: targetItems, removedCount: 0 };

        if (isRestaurantCloudTableShadow(targetOrder)) {
            if (response?.success === false || response?.found === false || !response?.order
                || getRestaurantCloudTableState(response.order) !== 'active'
                || response.order.updatedAt !== targetOrder.cloudUpdatedAt
                || response.summary?.hasCancelledItems) {
                const message = 'La mesa cambió en otro dispositivo. Actualízala antes de cobrar.';
                showMessageModal(message, null, { type: 'warning' });
                return { success: false, canContinue: false, code: 'RESTAURANT_ORDER_VERSION_CONFLICT',
                    message, orderItems: targetItems, removedCount: 0 };
            }
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

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
    }, [blockEcommerceRestaurantEffect, features?.hasTables, activeOrderId, order, licenseDetails]);

    const reconcileKitchenCancelledItemsBeforeTablePayment = useCallback(async () => {
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return { ...blocked, canContinue: false, orderItems: [], removedCount: 0 };

        const activeOrdersState = useActiveOrders.getState();
        const targetOrderId = activeOrdersState.currentOrderId || activeOrderId;
        const targetOrder = targetOrderId ? activeOrdersState.activeOrders.get(targetOrderId) : null;
        const targetItems = Array.isArray(targetOrder?.items) ? targetOrder.items : order;

        if (!features?.hasTables || !targetOrderId || !isCloudRestaurantOrdersEnabled) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        let response;
        try {
            response = await getRestaurantOrderCloudStatusSnapshot({
                licenseDetails,
                localOrderId: targetOrderId,
                force: true
            });
        } catch (error) {
            const authorityResult = handlePosActorAuthorityError(error, 'checkout');
            if (authorityResult) return { ...authorityResult, canContinue: false, orderItems: targetItems, removedCount: 0 };
            Logger.warn('[REST.5.1] No se pudo verificar cocina antes de cobrar mesa:', error);
            showMessageModal(
                'No se pudo verificar cocina cloud. Revisa la mesa antes de cobrar.',
                null,
                {
                    title: 'Verificación de cocina no disponible',
                    type: 'warning',
                    confirmButtonText: 'Entendido'
                }
            );
            return { canContinue: false, orderItems: targetItems, removedCount: 0 };
        }

        const authorityResult = response?.success === false && handlePosActorAuthorityError(response, 'checkout');
        if (authorityResult) return { ...authorityResult, canContinue: false, orderItems: targetItems, removedCount: 0 };
        if (response?.skipped || response?.found === false || !response?.order) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        if (response?.success === false) {
            showMessageModal(
                'No se pudo verificar cocina cloud. Revisa la mesa antes de cobrar.',
                null,
                {
                    title: 'Verificación de cocina no disponible',
                    type: 'warning',
                    confirmButtonText: 'Entendido'
                }
            );
            return { canContinue: false, orderItems: targetItems, removedCount: 0 };
        }

        const summary = response.summary || {};
        if (!summary.hasCancelledItems) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        const reconciliation = reconcileCartWithCancelledRestaurantItems(targetItems, summary.items);

        if (reconciliation.hasUnmatchedCancelledItems) {
            await showConfirmModal(
                'Hay items cancelados en cocina que no se pudieron empatar con la cuenta. Abre la mesa y revisa antes de cobrar.',
                {
                    title: summary.isCancelled ? 'Comanda cancelada en cocina' : 'Items cancelados en cocina',
                    type: 'warning',
                    confirmButtonText: 'Entendido',
                    showCancel: false
                }
            );

            return { canContinue: false, orderItems: targetItems, removedCount: 0 };
        }

        if (!reconciliation.hasRemovableCancelledItems) {
            return { canContinue: true, orderItems: targetItems, removedCount: 0 };
        }

        const confirmed = await showConfirmModal(
            `Cocina canceló ${reconciliation.removedCount} item(s). Se retirarán de la cuenta antes de cobrar.`,
            {
                title: 'Ajustar cuenta antes de cobrar',
                type: 'warning',
                confirmButtonText: 'Retirar y cobrar',
                cancelButtonText: 'Revisar mesa'
            }
        );

        if (!confirmed) {
            return { canContinue: false, orderItems: targetItems, removedCount: 0 };
        }

        const nextOrderItems = reconciliation.kept;
        if (countSellableItems(nextOrderItems) === 0) {
            showMessageModal(
                'No quedan productos activos para cobrar. Anula la venta si cocina canceló toda la comanda.',
                null,
                { type: 'warning' }
            );
            return { canContinue: false, orderItems: targetItems, removedCount: reconciliation.removedCount };
        }

        useActiveOrders.getState().updateOrderItems(targetOrderId, nextOrderItems);

        const updatedOrder = useActiveOrders.getState().activeOrders.get(targetOrderId);
        const saveResult = await useActiveOrders.getState().saveOrderAsOpen(targetOrderId, updatedOrder);
        if (!saveResult?.success) {
            showMessageModal(
                saveResult?.message || 'No se pudo actualizar la mesa antes de cobrar.',
                null,
                { type: 'error' }
            );
            return { canContinue: false, orderItems: nextOrderItems, removedCount: reconciliation.removedCount };
        }

        const persistedSale = await db.table(STORES.SALES).get(targetOrderId);
        const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : nextOrderItems;
        useActiveOrders.getState().updateOrderItems(targetOrderId, persistedItems);

        showMessageModal(
            'Se retiraron de la cuenta los items cancelados por cocina antes de cobrar.',
            null,
            { type: 'success' }
        );

        return { canContinue: true, orderItems: persistedItems, removedCount: reconciliation.removedCount };
    }, [
        blockEcommerceRestaurantEffect,
        features?.hasTables,
        activeOrderId,
        order,
        licenseDetails,
        isCloudRestaurantOrdersEnabled
    ]);

    const handleLoadOpenOrder = useCallback(async (orderId) => {
        if (!features?.hasTables) return;
        try { actorRuntimeController.capture(); } catch (error) {
            return handlePosActorAuthorityError(error, 'load_table');
        }

        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);
        if (!hasCurrentOrder) {
            return executeLoadOpenOrder(orderId);
        }

        showMessageModal(
            'Hay un carrito activo. Deseas reemplazarlo por la mesa seleccionada?',
            () => executeLoadOpenOrder(orderId),
            {
                title: 'Cambiar mesa activa',
                type: 'warning',
                confirmButtonText: 'Si, cargar mesa'
            }
        );
        return { success: false, confirmationRequired: true };
    }, [features?.hasTables, order, executeLoadOpenOrder]);

    const handleQuickTableAction = useCallback(async (targetOrder, actionType) => {
        if (actionType === 'split' && isRestaurantCloudTableShadow(targetOrder)) {
            const result = restaurantCloudTableSplitBlockedResult();
            showMessageModal(result.message, null, { type: 'warning' });
            return result;
        }
        if (actionType === 'checkout' && isRestaurantCloudTableShadow(targetOrder)) {
            const result = restaurantCloudTableBlockedResult('checkout');
            showMessageModal(result.message, null, { type: 'warning' });
            return result;
        }
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return blocked;

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
                if (result?.code) return result;
                showMessageModal(result?.message || 'Error al cargar la mesa para cobro.', null, { type: 'error' });
                return result;
            }

            closeModal('tables');

            if (actionType === 'checkout') {
                const kitchenReview = await reconcileKitchenCancelledItemsBeforeTablePayment();
                if (!kitchenReview.canContinue) return kitchenReview;

                if (countSellableItems(kitchenReview.orderItems) === 0) {
                    showMessageModal(
                        'No quedan productos activos para cobrar. Anula la venta si cocina canceló toda la comanda.',
                        null,
                        { type: 'warning' }
                    );
                    return;
                }

                if (typeof handleInitiateCheckout === 'function') {
                    return handleInitiateCheckout();
                }
                console.error('[useTableManagement] handleInitiateCheckout no está disponible.');
                openModal('payment');
            } else if (actionType === 'split') {
                const remoteBlocked = await blockRemoteSplit();
                if (remoteBlocked) return remoteBlocked;
                const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
                if (!kitchenReview.canContinue) return kitchenReview;

                if (countSellableItems(kitchenReview.orderItems) === 0) {
                    showMessageModal('No hay productos en la mesa activa para dividir.');
                    return;
                }

                openModal('split');
            }
        } catch (error) {
            const handled = handlePosActorAuthorityError(error, 'load_table');
            if (handled) return handled;
            console.error('Error al cargar la mesa para acción rápida:', error);
        }
    }, [
        blockEcommerceRestaurantEffect,
        blockRemoteSplit,
        order,
        executeLoadOpenOrder,
        closeModal,
        openModal,
        handleInitiateCheckout,
        reconcileKitchenCancelledItemsBeforeSplit,
        reconcileKitchenCancelledItemsBeforeTablePayment
    ]);

    const handleAnnulKitchenRejectedOrder = useCallback(async (targetOrder) => {
        if (isRestaurantCloudTableShadow(targetOrder)) {
            const result = restaurantCloudTableBlockedResult('cancel');
            showMessageModal(result.message, null, { type: 'warning' });
            return result;
        }
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
                const handled = handlePosActorAuthorityError(error, 'cancel_order');
                if (handled) return handled;
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

        let actorHandle;
        try {
            actorHandle = captureRefundsActorHandle();
        } catch (error) {
            const handled = handlePosActorAuthorityError(error, 'cancel_order');
            if (handled) return handled;
            return {
                success: false,
                code: error?.code || 'ACTOR_PERMISSION_DENIED',
                message: 'No tienes permiso vigente para anular esta venta.'
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
            const { useActiveOrders: activeOrdersStore } = await import('./useActiveOrders.js');
            const result = await activeOrdersStore.getState().cancelOpenSaleByIdFromPos(targetOrder.id, { actorHandle });

            if (result.success) {
                showMessageModal('Venta anulada correctamente.', null, { type: 'success' });
                await fetchActiveTablesCount();
            } else {
                showMessageModal(result.message || 'No se pudo anular la venta.', null, { type: 'error' });
            }
            return result;
        } catch (error) {
            const handled = handlePosActorAuthorityError(error, 'cancel_order');
            if (handled) return handled;
            Logger.error('Error anulando comanda rechazada en cocina:', error);
            showMessageModal(error?.message || 'Error al anular la venta.', null, { type: 'error' });
            return { success: false, message: error?.message };
        }
    }, [features?.hasTables, fetchActiveTablesCount, licenseDetails]);

    const handleOpenSplitBill = useCallback(async () => {
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return blocked;
        if (!features?.hasTables) return;
        if (!activeOrderId) {
            showMessageModal('No hay una mesa activa cargada para dividir.');
            return;
        }

        const remoteBlocked = await blockRemoteSplit();
        if (remoteBlocked) return remoteBlocked;

        const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
        if (!kitchenReview.canContinue) return kitchenReview;

        if (countSellableItems(kitchenReview.orderItems) === 0) {
            showMessageModal('No hay productos en la mesa activa para dividir.');
            return;
        }

        openModal('split');
    }, [blockEcommerceRestaurantEffect, blockRemoteSplit, features?.hasTables, activeOrderId, reconcileKitchenCancelledItemsBeforeSplit, openModal]);

    const handleConfirmSplitBill = useCallback(async (splitPayload) => {
        const blocked = blockEcommerceRestaurantEffect();
        if (blocked) return blocked;

        const remoteBlocked = await blockRemoteSplit();
        if (remoteBlocked) return remoteBlocked;

        const isSessionValid = await verifySessionIntegrity(SPLIT_BILL_INTEGRITY_OPTIONS);
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        const kitchenReview = await reconcileKitchenCancelledItemsBeforeSplit();
        if (!kitchenReview.canContinue) return kitchenReview;

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

        const requiresCashSessionCompatibility = splitRequiresCashSessionCompatibility(splitPayload?.tickets);

        let cloudSpecialFlows = false;
        if (isCloudRestaurantOrdersEnabled && licenseKey) {
            try {
                cloudSpecialFlows = await salesCloudCashierService.canUseCloudSplitTableSale({
                    tickets: splitPayload?.tickets || [],
                    licenseDetails
                });
            } catch (cloudSpecialFlowError) {
                const authorityResult = handlePosActorAuthorityError(cloudSpecialFlowError, 'split_checkout');
                if (authorityResult) return authorityResult;
                Logger.error('[SalesCloud/Cashier] No se pudo verificar la capacidad del split cloud:', cloudSpecialFlowError);
                showMessageModal(
                    'No se pudo verificar el cobro cloud de la mesa. La cuenta no se cobró; revisa conexión y vuelve a intentarlo.',
                    null,
                    { type: 'error' }
                );
                return {
                    success: false,
                    errorType: 'CLOUD_SPECIAL_FLOW_UNAVAILABLE',
                    message: 'No se pudo verificar el cobro cloud de la mesa.'
                };
            }
        }

        let resolvedCashSessionId = cajaActual?.id || null;
        if (cloudSpecialFlows) {
            try {
                const appCashStateNeedsEnsure = !cajaActual || cajaActual.estado !== 'abierta';
                let ensuredCashSession = false;
                if (appCashStateNeedsEnsure && typeof asegurarCajaAbierta === 'function') {
                    await asegurarCajaAbierta();
                    ensuredCashSession = true;
                }

                let currentCashState = await cashRepository.getCurrentCashSession({ force: true });
                const cashAuthority = currentCashState?.success === false && handlePosActorAuthorityError(currentCashState, 'split_checkout');
                if (cashAuthority) return cashAuthority;
                let currentCashSession = currentCashState?.cashSession || null;
                const sessionIsUsable = () => currentCashState?.success !== false
                    && currentCashSession?.estado === 'abierta'
                    && !currentCashState?.readOnly
                    && currentCashState?.stateKnown !== false;

                if (!sessionIsUsable() && !ensuredCashSession && typeof asegurarCajaAbierta === 'function') {
                    await asegurarCajaAbierta();
                    currentCashState = await cashRepository.getCurrentCashSession({ force: true });
                    currentCashSession = currentCashState?.cashSession || null;
                }
                if (!sessionIsUsable()) {
                    throw new Error('CASH_SESSION_NOT_OPEN');
                }
                resolvedCashSessionId = currentCashSession.id;
            } catch (cashStateError) {
                const authorityResult = handlePosActorAuthorityError(cashStateError, 'split_checkout');
                if (authorityResult) return authorityResult;
                Logger.error('[SalesCloud/Cashier] No se pudo resolver la caja antes del split cloud:', cashStateError);
                const message = cashStateError?.message === 'CASH_SESSION_NOT_OPEN'
                    ? 'El cobro cloud de una cuenta dividida requiere una caja abierta. Ábrela y vuelve a intentarlo; no se aplicaron cobros.'
                    : 'No se pudo verificar la caja abierta antes de cobrar. No se aplicaron cobros.';
                showMessageModal(message, null, { type: 'error' });
                return { success: false, errorType: 'CASH_SESSION_NOT_OPEN', message };
            }
        } else if (requiresCashSessionCompatibility && (!cajaActual || cajaActual.estado !== 'abierta')) {
            if (typeof asegurarCajaAbierta !== 'function') {
                showMessageModal('No se pudo abrir la caja automáticamente.', null, { type: 'error' });
                return;
            }

            try {
                await asegurarCajaAbierta();
            } catch (error) {
                const authorityResult = handlePosActorAuthorityError(error, 'split_checkout');
                if (authorityResult) return authorityResult;
                Logger.error('No se pudo abrir caja para Split Bill:', error);
                showMessageModal(error?.message || 'No se pudo abrir la caja automáticamente.', null, { type: 'error' });
                return;
            }
        }

        try {
            const result = await splitOpenTableOrder({
                parentOrderId: activeOrderId,
                orderSnapshot: kitchenReview.orderItems,
                splitIntent: splitPayload.splitIntent,
                tickets: splitPayload.tickets,
                features,
                companyName,
                cloudSpecialFlows,
                licenseDetails,
                cashSessionId: resolvedCashSessionId
            });

            if (!result.success) {
                const authorityResult = handlePosActorAuthorityError(result, 'split_checkout');
                if (authorityResult) return authorityResult;
            }
            if (result.success) {
                let cloudCloseResult = { success: true, skipped: true };

                if (isCloudRestaurantOrdersEnabled && !result.cloudCommitted) {
                    try {
                        cloudCloseResult = await closeRestaurantCloudOrderAfterSuccessfulSplitPayment({
                            localOrderId: activeOrderId,
                            splitResult: result,
                            licenseDetails,
                            saleTotal: result.total,
                            features
                        });
                    } catch (cloudCloseError) {
                        Logger.warn('[REST.SPLIT.1] No se pudo cerrar cocina cloud después del split:', cloudCloseError);
                        cloudCloseResult = {
                            success: false,
                            retryable: true,
                            pendingSaved: false,
                            error: cloudCloseError,
                            message: cloudCloseError?.message || 'La cuenta se cobró, pero no se pudo cerrar cocina cloud.'
                        };
                    }
                }

                try {
                    // Settlement already consumed the local reservation or reconciled
                    // it against Cloud. Runtime cleanup must never cancel that parent.
                    await useActiveOrders.getState().removeOrder(activeOrderId);
                    closeModal('split');

                    if (isCloudRestaurantOrdersEnabled && cloudCloseResult?.success === false) {
                        showMessageModal(
                            '⚠️ La cuenta se cobró, pero no se pudo cerrar cocina cloud. Se reintentará cuando haya conexión.',
                            null,
                            { type: 'warning' }
                        );
                    } else {
                        showMessageModal('✅ Split bill aplicado y cobro registrado correctamente.');
                    }

                    await refreshData();
                    await fetchActiveTablesCount();
                    window.dispatchEvent(new CustomEvent(RESTAURANT_CLOUD_STATUS_EVENT));
                } catch (postCheckoutError) {
                    if (!result.cloudCommitted) throw postCheckoutError;
                    Logger.warn('[REST.SPLIT.1] Cobro cloud confirmado; actualización de UI pendiente:', postCheckoutError);
                }
                return result;
            }

            if (result.errorType === 'DIRTY_ORDER' || result.errorType === 'RACE_CONDITION') {
                showMessageModal(result.message, null, { type: 'warning' });
                if (result.errorType === 'RACE_CONDITION') await refreshData();
                return result;
            }

            showMessageModal(result.message || 'No se pudo dividir/cobrar la mesa.', null, { type: 'error' });
            return result;
        } catch (error) {
            const handled = handlePosActorAuthorityError(error, 'split_checkout');
            if (handled) return handled;
            Logger.error('Error crítico en Split Bill:', error);
            showMessageModal(`Error inesperado: ${error.message}`, null, { type: 'error' });
            return { success: false, message: error?.message || 'No se pudo dividir la cuenta.' };
        }
    }, [
        blockEcommerceRestaurantEffect,
        activeOrderId,
        blockRemoteSplit,
        features,
        companyName,
        verifySessionIntegrity,
        reconcileKitchenCancelledItemsBeforeSplit,
        closeModal,
        refreshData,
        fetchActiveTablesCount,
        cajaActual,
        asegurarCajaAbierta,
        isCloudRestaurantOrdersEnabled,
        licenseDetails,
        licenseKey
    ]);

    const safeOpenSplitBill = useCallback((...args) => runPosActorUiOperation('split_checkout', handleOpenSplitBill, ...args), [handleOpenSplitBill]);
    const safeConfirmSplitBill = useCallback((...args) => runPosActorUiOperation('split_checkout', handleConfirmSplitBill, ...args), [handleConfirmSplitBill]);

    return {
        handleSaveAsOpen,
        handleLoadOpenOrder,
        handleQuickTableAction,
        handleOpenSplitBill: safeOpenSplitBill,
        handleConfirmSplitBill: safeConfirmSplitBill,
        handleAnnulKitchenRejectedOrder
    };
}
