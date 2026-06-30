// src/hooks/pos/usePosCheckout.js
import { useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { broadcastDBChange } from '../../store/useProductStore';
import { showMessageModal } from '../../services/utils';
import { useActiveOrders } from './useActiveOrders';
import { Money } from '../../utils/moneyMath';
import { validateFefoSelectionBeforeCheckout } from '../../services/sales/fefoSaleValidation';
import {
    isCloudSalesCashierEnabled,
    isCloudSalesCreditEnabled
} from '../../services/sync/syncConstants';

const CLOUD_TURN_REQUIRED_PAYMENT_METHODS = new Set(['cash', 'card', 'transfer', 'credit', 'mixed']);

const CHECKOUT_INTEGRITY_OPTIONS = {
    reason: 'sale_checkout',
    transactionMode: true,
    refreshProfile: false,
    forceRemote: false,
    allowLocalOnly: true
};

const shouldRequireOpenCashSessionForCloudSale = (licenseDetails) => Boolean(
    licenseDetails?.valid &&
    (
        isCloudSalesCashierEnabled(licenseDetails) ||
        isCloudSalesCreditEnabled(licenseDetails)
    )
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
    return JSON.parse(JSON.stringify(value));
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
    const checkoutSnapshotRef = useRef(null);

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
        const pendingInventoryCount = activeOrdersState.pendingInventoryResolutions?.get(pos.activeOrderId) || 0;

        if (pendingInventoryCount > 0) {
            showMessageModal(
                'Espera a que termine la asignación de inventario antes de cobrar.',
                null,
                { type: 'warning' }
            );
            return;
        }

        const itemsToProcess = pos.order.filter((item) => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }

        mobileCart.closeCart();

        const lockResult = await useActiveOrders.getState().lockOrderForCheckout(pos.activeOrderId);
        if (!lockResult.success) {
            showMessageModal(`⚠️ No se puede iniciar el cobro: ${lockResult.reason}`, null, { type: 'warning' });
            return;
        }

        const lockedState = useActiveOrders.getState();
        const lockedOrder = lockedState.activeOrders.get(pos.activeOrderId);
        const pendingAfterLock = lockedState.pendingInventoryResolutions?.get(pos.activeOrderId) || 0;

        if (pendingAfterLock > 0 || !lockedOrder) {
            await lockedState.unlockOrder(pos.activeOrderId);
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
            await lockedState.unlockOrder(pos.activeOrderId);
            showMessageModal('El pedido está vacío.');
            return;
        }

        const fefoValidation = await validateFefoSelectionBeforeCheckout(
            lockedItemsToProcess,
            posSearch.menuVisual
        );

        if (fefoValidation.blocked) {
            await lockedState.unlockOrder(pos.activeOrderId);
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
            orderId: pos.activeOrderId,
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

        if (requiresOpenCashSession && (!pos.cajaActual || pos.cajaActual.estado !== 'abierta')) {
            modal.closeModal('payment');
            modal.openModal('quickCaja');
            return;
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

                try {
                    await useActiveOrders.getState().removeOrder(snapshot.orderId);
                } catch (closeErr) {
                    console.error('[usePosCheckout] Error eliminando orden en activeOrders:', closeErr);
                }

                prescription.setTempPrescriptionData(null);
                mobileCart.closeCart();

                showMessageModal('✅ ¡Venta registrada correctamente!');
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
            modal.closeModal('quickCaja');
            modal.openModal('payment');
        }
        return success;
    }, [abrirCaja, modal]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handlePaymentModalClose,
        handleQuickCajaClose,
        handleQuickCajaSubmit
    };
}
