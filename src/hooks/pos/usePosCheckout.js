// src/hooks/pos/usePosCheckout.js
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { broadcastDBChange } from '../../store/useProductStore';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { useActiveOrders } from './useActiveOrders';
import { Money } from '../../utils/moneyMath';
import { validateFefoSelectionBeforeCheckout } from '../../services/sales/fefoSaleValidation';
import { getRestaurantOrderCloudStatusSnapshot } from '../restaurant/useRestaurantOrderCloudStatus';
import { reconcileCartWithCancelledRestaurantItems } from '../../services/restaurant/restaurantOrderReconciliation';
import {
    closeRestaurantCloudOrderAfterSuccessfulPayment,
    retryPendingRestaurantCloudOrderCloses
} from '../../services/restaurant/restaurantOrderCheckoutClose';
import {
    isCloudSalesCashierEnabled,
    isCloudSalesCreditEnabled,
    isRestaurantOrdersCloudEnabled
} from '../../services/sync/syncConstants';

const CLOUD_TURN_REQUIRED_PAYMENT_METHODS = new Set(['cash', 'card', 'transfer', 'credit', 'mixed']);

const CHECKOUT_INTEGRITY_OPTIONS = {
    reason: 'sale_checkout',
    transactionMode: true,
    refreshProfile: false,
    forceRemote: false,
    allowLocalOnly: true
};

const countSellableItems = (items = []) => (
    (Array.isArray(items) ? items : []).filter((item) => Number(item?.quantity) > 0).length
);

const shouldRequireOpenCashSessionForCloudSale = (licenseDetails) => Boolean(
    licenseDetails?.valid &&
    (
        isCloudSalesCashierEnabled(licenseDetails) ||
        isCloudSalesCreditEnabled(licenseDetails)
    )
);

const hasOpenCashSession = (session) => (
    session?.estado === 'abierta' || session?.status === 'open'
);

const buildCashNeedsOpeningError = () => Object.assign(
    new Error('La caja requiere apertura manual. Confirma el fondo inicial.'),
    { code: 'CAJA_NEEDS_OPENING' }
);

const normalizePaymentMethod = (method) => {
    const raw = String(method || '').trim().toLowerCase();

    if (['cash', 'efectivo'].includes(raw)) return 'cash';
    if (['card', 'tarjeta', 'tarjeta_credito', 'tarjeta_debito', 'debit', 'credit_card', 'debit_card'].includes(raw)) return 'card';
    if (['transfer', 'transferencia', 'spei', 'bank_transfer'].includes(raw)) return 'transfer';
    if (['mixed', 'mixto'].includes(raw)) return 'mixed';
    if (['fiado', 'credit', 'credito', 'crédito', 'customer_credit', 'mixed_credit', 'partial_credit'].includes(raw)) return 'credit';

    return raw;
};

const deepClone = (value) => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => deepClone(item));

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    );
};

const buildKitchenReviewResult = (overrides = {}) => ({
    canContinue: true,
    orderItems: null,
    removedCancelledItems: [],
    removedCount: 0,
    ...overrides
});

const confirmKitchenStatusBeforeCheckout = async ({
    licenseDetails,
    localOrderId,
    orderItems = [],
    shouldVerifyCloudKitchen = false
}) => {
    if (!shouldVerifyCloudKitchen || !localOrderId) {
        return buildKitchenReviewResult();
    }

    try {
        const response = await getRestaurantOrderCloudStatusSnapshot({
            licenseDetails,
            localOrderId,
            force: true
        });

        if (response?.skipped || response?.found === false || !response?.order) {
            return buildKitchenReviewResult();
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
            return buildKitchenReviewResult({ canContinue: false });
        }

        const summary = response.summary || {};

        if (summary.hasCancelledItems) {
            const reconciliation = reconcileCartWithCancelledRestaurantItems(orderItems, summary.items);

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

                return buildKitchenReviewResult({ canContinue: false });
            }

            if (reconciliation.hasRemovableCancelledItems) {
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
                    return buildKitchenReviewResult({ canContinue: false });
                }

                if (countSellableItems(reconciliation.kept) === 0) {
                    showMessageModal(
                        'No quedan productos activos para cobrar. Anula la venta si cocina canceló toda la comanda.',
                        null,
                        { type: 'warning' }
                    );
                    return buildKitchenReviewResult({ canContinue: false });
                }

                return buildKitchenReviewResult({
                    orderItems: reconciliation.kept,
                    removedCancelledItems: reconciliation.removed,
                    removedCount: reconciliation.removedCount
                });
            }

            return buildKitchenReviewResult();
        }

        if (summary.hasPendingItems || summary.hasPreparingItems || (!summary.isReady && !summary.isCancelled)) {
            const canContinue = await showConfirmModal(
                'La comanda aún no está marcada como lista en cocina.',
                {
                    title: 'Comanda aún en cocina',
                    type: 'warning',
                    confirmButtonText: 'Continuar de todos modos',
                    cancelButtonText: 'Volver a revisar'
                }
            );
            return buildKitchenReviewResult({ canContinue });
        }

        return buildKitchenReviewResult();
    } catch (error) {
        console.warn('[REST.5.1] No se pudo verificar cocina cloud antes de cobrar:', error);
        showMessageModal(
            'No se pudo verificar cocina cloud. Revisa la mesa antes de cobrar.',
            null,
            {
                title: 'Verificación de cocina no disponible',
                type: 'warning',
                confirmButtonText: 'Entendido'
            }
        );
        return buildKitchenReviewResult({ canContinue: false });
    }
};

export function usePosCheckout({
    pos,
    posSearch,
    modal,
    mobileCart,
    prescription,
    features,
    fetchActiveTablesCount
}) {
    const verifySessionIntegrity = pos.verifySessionIntegrity;
    const abrirCaja = pos.abrirCaja;
    const asegurarCajaAbierta = pos.asegurarCajaAbierta;
    const checkoutSnapshotRef = useRef(null);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const retryPendingCloses = () => {
            const licenseDetails = useAppStore.getState().licenseDetails;
            retryPendingRestaurantCloudOrderCloses({ licenseDetails, features }).catch((error) => {
                console.warn('[REST.7] No se pudieron reintentar cierres pendientes de cocina cloud:', error);
            });
        };

        retryPendingCloses();
        window.addEventListener('online', retryPendingCloses);
        return () => window.removeEventListener('online', retryPendingCloses);
    }, [features]);

    const handlePaymentModalClose = useCallback(() => {
        const snapshot = checkoutSnapshotRef.current;
        checkoutSnapshotRef.current = null;

        if (snapshot?.orderId) {
            useActiveOrders.getState().unlockOrder(snapshot.orderId).catch((err) => {
                console.error('[usePosCheckout] Error en rollback al cerrar modal de pago:', err);
            });
        }

        modal.closeModal('payment');
    }, [modal]);

    const handleQuickCajaClose = useCallback(async () => {
        const snapshot = checkoutSnapshotRef.current;
        checkoutSnapshotRef.current = null;

        try {
            if (snapshot?.orderId) {
                await useActiveOrders.getState().unlockOrder(snapshot.orderId);
            }
        } catch (err) {
            console.error('[usePosCheckout] Error liberando lock al cancelar apertura de caja:', err);
        } finally {
            modal.closeModal('quickCaja');
        }

        if (snapshot?.orderId) {
            showMessageModal(
                'Apertura de caja cancelada. La venta no se cobró; puedes volver a cobrar cuando abras caja.',
                null,
                { type: 'warning' }
            );
        }
    }, [modal]);

    const handleInitiateCheckout = useCallback(async () => {
        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return;
        }

        const activeOrdersState = useActiveOrders.getState();
        const activeOrderId = activeOrdersState.currentOrderId || pos.activeOrderId;
        const activeOrder = activeOrderId ? activeOrdersState.activeOrders.get(activeOrderId) : null;
        let orderItems = Array.isArray(activeOrder?.items) ? activeOrder.items : pos.order;
        const pendingInventoryCount = activeOrdersState.pendingInventoryResolutions?.get(activeOrderId) || 0;

        if (pendingInventoryCount > 0) {
            showMessageModal(
                'Espera a que termine la asignación de inventario antes de cobrar.',
                null,
                { type: 'warning' }
            );
            return;
        }

        const shouldVerifyCloudKitchen = Boolean(
            features?.hasTables &&
            activeOrder?.isSaved &&
            isRestaurantOrdersCloudEnabled(licenseDetails)
        );

        if (features?.hasTables) {
            const kitchenReview = await confirmKitchenStatusBeforeCheckout({
                licenseDetails,
                localOrderId: activeOrderId,
                orderItems,
                shouldVerifyCloudKitchen
            });

            if (!kitchenReview.canContinue) {
                return;
            }

            if (Array.isArray(kitchenReview.orderItems)) {
                orderItems = kitchenReview.orderItems;
                const activeOrdersApi = useActiveOrders.getState();
                activeOrdersApi.updateOrderItems(activeOrderId, orderItems);

                const updatedOrder = useActiveOrders.getState().activeOrders.get(activeOrderId);
                const saveResult = await useActiveOrders.getState().saveOrderAsOpen(activeOrderId, updatedOrder);
                if (!saveResult?.success) {
                    showMessageModal(
                        saveResult?.message || 'No se pudo actualizar la mesa antes de cobrar.',
                        null,
                        { type: 'error' }
                    );
                    return;
                }

                const persistedSale = await db.table(STORES.SALES).get(activeOrderId);
                const persistedItems = Array.isArray(persistedSale?.items) ? persistedSale.items : orderItems;
                useActiveOrders.getState().updateOrderItems(activeOrderId, persistedItems);
                orderItems = persistedItems;

                if (kitchenReview.removedCount > 0) {
                    showMessageModal(
                        'Se retiraron de la cuenta los items cancelados por cocina antes de cobrar.',
                        null,
                        { type: 'success' }
                    );
                }
            }
        }

        const itemsToProcess = orderItems.filter((item) => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.', null, { type: 'warning' });
            return;
        }

        mobileCart.closeCart();

        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(activeOrderId);
        if (!lockResult.success) {
            showMessageModal(`⚠️ No se puede iniciar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
            return;
        }

        const lockedState = useActiveOrders.getState();
        const lockedOrder = lockedState.activeOrders.get(activeOrderId);
        const pendingAfterLock = lockedState.pendingInventoryResolutions?.get(activeOrderId) || 0;

        if (pendingAfterLock > 0 || !lockedOrder) {
            await lockedState.unlockOrder(activeOrderId);
            showMessageModal(
                pendingAfterLock > 0
                    ? 'Espera a que termine la asignación de inventario antes de cobrar.'
                    : 'No se encontró la orden activa para iniciar el cobro.',
                null,
                { type: 'warning' }
            );
            return;
        }

        const lockedItemsToProcess = lockedOrder.items.filter((item) => item.quantity && item.quantity > 0);
        if (lockedItemsToProcess.length === 0) {
            await lockedState.unlockOrder(activeOrderId);
            showMessageModal('El pedido está vacío.', null, { type: 'warning' });
            return;
        }

        const fefoValidation = await validateFefoSelectionBeforeCheckout(
            lockedItemsToProcess,
            posSearch.menuVisual
        );

        if (fefoValidation.blocked) {
            await lockedState.unlockOrder(activeOrderId);
            showMessageModal(
                fefoValidation.message || 'Hay un lote vencido que no puede venderse.',
                null,
                { type: 'error' }
            );
            return;
        }

        if (fefoValidation.warnings?.length > 0) {
            console.info('[CAD.5 FEFO] Advertencias preventivas de selección:', fefoValidation.warnings);
        }

        checkoutSnapshotRef.current = {
            orderId: activeOrderId,
            order: deepClone(lockedOrder.items),
            total: Number(lockedOrder.total),
            tableData: deepClone(lockedOrder.tableData ?? null)
        };

        const itemsRequiring = features?.hasLabFields
            ? lockedItemsToProcess.filter((item) =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        prescription.setTempPrescriptionData(null);

        if (itemsRequiring.length > 0) {
            prescription.setPrescriptionItems(itemsRequiring);
            modal.openModal('prescription');
        } else {
            modal.openModal('payment');
        }
    }, [
        pos.order,
        pos.activeOrderId,
        posSearch.menuVisual,
        features?.hasLabFields,
        features?.hasTables,
        mobileCart,
        modal,
        prescription
    ]);

    const handleProcessOrder = useCallback(async (paymentData, forceSale = false) => {
        const snapshot = checkoutSnapshotRef.current;

        if (!snapshot) {
            console.error('[usePosCheckout] handleProcessOrder llamado sin snapshot activo.');
            showMessageModal('⚠️ Error interno: cierra el modal y vuelve a intentar el cobro.');
            modal.closeModal('payment');
            return;
        }

        const isSessionValid = await verifySessionIntegrity(CHECKOUT_INTEGRITY_OPTIONS);
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        if (paymentData.paymentMethod === 'fiado') {
            if (!paymentData.dueDate) {
                showMessageModal('⚠️ Fecha de vencimiento es requerida para ventas a crédito.');
                checkoutSnapshotRef.current = null;
                modal.closeModal('payment');
                return;
            }

            const todayStr = new Date().toISOString().split('T')[0];
            const dueDateStr = paymentData.dueDate.split('T')[0];
            if (dueDateStr < todayStr) {
                showMessageModal('⚠️ La fecha de vencimiento no puede ser en el pasado.');
                checkoutSnapshotRef.current = null;
                modal.closeModal('payment');
                return;
            }
        }

        const paymentMethod = normalizePaymentMethod(paymentData.paymentMethod);
        const initialPaymentMethod = normalizePaymentMethod(
            paymentData.initialPaymentMethod ||
            paymentData.abonoPaymentMethod ||
            paymentData.creditPaymentMethod ||
            paymentData.partialPaymentMethod ||
            'efectivo'
        );

        const hasInitialCreditPayment = paymentMethod === 'credit' && Money.init(paymentData.amountPaid || 0).gt(0);
        const hasCashComponent = paymentMethod === 'cash' || (hasInitialCreditPayment && initialPaymentMethod === 'cash');

        const licenseDetails = useAppStore.getState().licenseDetails;
        const cloudSalesTurnRequired = shouldRequireOpenCashSessionForCloudSale(licenseDetails);
        const requiresOpenCashSession = cloudSalesTurnRequired
            ? CLOUD_TURN_REQUIRED_PAYMENT_METHODS.has(paymentMethod)
            : hasCashComponent;

        if (requiresOpenCashSession && !hasOpenCashSession(pos.cajaActual)) {
            try {
                const ensuredCashSession = await asegurarCajaAbierta?.();

                if (!hasOpenCashSession(ensuredCashSession)) {
                    throw buildCashNeedsOpeningError();
                }
            } catch (cashError) {
                if (cashError?.code === 'CAJA_NEEDS_OPENING') {
                    modal.closeModal('payment');
                    modal.openModal('quickCaja');
                    return;
                }

                showMessageModal(
                    cashError?.message || 'No se pudo verificar la caja abierta. Intenta de nuevo.',
                    null,
                    {
                        title: 'Caja requerida',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    }
                );
                return;
            }
        }

        checkoutSnapshotRef.current = null;

        let isSuccess = false;
        let isStockWarning = false;

        try {
            modal.closeModal('payment');
            const { processSale } = await import('../../services/salesService');
            const result = await processSale({
                order: snapshot.order,
                paymentData,
                total: snapshot.total,
                allProducts: posSearch.menuVisual,
                features,
                companyName: useAppStore.getState().companyProfile?.name || 'Tu Negocio',
                tempPrescriptionData: prescription.tempPrescriptionData,
                ignoreStock: forceSale,
                activeOrderId: snapshot.orderId
            });

            if (result.success) {
                isSuccess = true;

                let kitchenCloseWarning = null;
                try {
                    const closeResult = await closeRestaurantCloudOrderAfterSuccessfulPayment({
                        localOrderId: snapshot.orderId,
                        saleResult: result,
                        paymentData,
                        licenseDetails,
                        saleTotal: snapshot.total,
                        features
                    });

                    if (closeResult?.success === false && !closeResult?.skipped) {
                        kitchenCloseWarning = 'La venta se cobró, pero no se pudo cerrar cocina cloud. Revisa conexión y actualiza Mesas/Cocina.';
                    }
                } catch (closeError) {
                    console.warn('[REST.7] Cierre cloud de cocina falló después del cobro:', closeError);
                    kitchenCloseWarning = 'La venta se cobró, pero no se pudo cerrar cocina cloud. Revisa conexión y actualiza Mesas/Cocina.';
                }

                try {
                    await useActiveOrders.getState().removeOrder(snapshot.orderId);
                } catch (closeErr) {
                    console.error('[usePosCheckout] Error eliminando orden en activeOrders:', closeErr);
                }

                prescription.setTempPrescriptionData(null);
                mobileCart.closeCart();

                if (kitchenCloseWarning) {
                    showMessageModal(kitchenCloseWarning, null, {
                        title: 'Cierre de cocina pendiente',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    });
                } else {
                    showMessageModal('✅ ¡Venta registrada correctamente!');
                }

                broadcastDBChange({ action: 'sale-completed', saleId: result.saleId });
                await posSearch.refreshOutOfStock();
                await fetchActiveTablesCount();
            } else if (result.errorType === 'RACE_CONDITION') {
                showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                await posSearch.refreshOutOfStock();
            } else if (result.errorType === 'STOCK_WARNING') {
                isStockWarning = true;
                checkoutSnapshotRef.current = snapshot;
                showMessageModal(
                    result.message,
                    async () => {
                        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(snapshot.orderId);
                        if (lockResult.success) {
                            handleProcessOrder(paymentData, true);
                        } else {
                            showMessageModal(`⚠️ No se puede forzar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
                        }
                    },
                    { confirmButtonText: 'Sí, Vender Igual', type: 'warning' }
                );
            } else {
                showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
            }
        } catch (error) {
            console.error('[usePosCheckout] Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
        } finally {
            if (!isSuccess) {
                await useActiveOrders.getState().unlockOrder(snapshot.orderId).catch((err) => {
                    console.error('[usePosCheckout] Error en rollback en finally:', err);
                });

                if (!isStockWarning) {
                    checkoutSnapshotRef.current = null;
                }
            }
        }
    }, [
        verifySessionIntegrity,
        pos.cajaActual,
        asegurarCajaAbierta,
        posSearch,
        features,
        prescription,
        modal,
        mobileCart,
        fetchActiveTablesCount
    ]);

    const handleQuickCajaSubmit = useCallback(async (openingData) => {
        const success = await abrirCaja(openingData);
        if (success) {
            try {
                const ensuredCashSession = await asegurarCajaAbierta?.();
                if (!hasOpenCashSession(ensuredCashSession)) {
                    throw buildCashNeedsOpeningError();
                }
            } catch (cashError) {
                showMessageModal(
                    cashError?.message || 'La caja se abrió, pero no se pudo confirmar la sesión abierta. Intenta de nuevo.',
                    null,
                    {
                        title: 'Verificación de caja pendiente',
                        type: 'warning',
                        confirmButtonText: 'Entendido'
                    }
                );
                return false;
            }

            modal.closeModal('quickCaja');
            modal.openModal('payment');
        }
        return success;
    }, [abrirCaja, asegurarCajaAbierta, modal]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handlePaymentModalClose,
        handleQuickCajaClose,
        handleQuickCajaSubmit
    };
}
