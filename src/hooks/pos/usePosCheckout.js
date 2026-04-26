// src/hooks/usePosCheckout.js
import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';

/**
 * Hook para manejar el flujo completo de checkout del POS.
 * Encapsula la lógica de inicio de pago, procesamiento de orden y caja rápida.
 *
 * @param {Object} deps - Dependencias externas
 * @param {Object} deps.pos - Estado y acciones de usePosPage
 * @param {Object} deps.posSearch - Estado y acciones de usePosSearch
 * @param {Object} deps.modal - Funciones de openModal/closeModal
 * @param {Object} deps.mobileCart - Funciones de openCart/closeCart
 * @param {Object} deps.prescription - Estado de prescripciones
 * @param {Object} deps.features - Feature flags
 * @param {function} deps.fetchActiveTablesCount - Actualiza conteo de mesas
 * @returns {{
 *   handleInitiateCheckout: () => void,
 *   handleProcessOrder: (paymentData: Object, forceSale?: boolean) => Promise<void>,
 *   handleQuickCajaSubmit: (monto: string) => Promise<void>
 * }}
 */
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

    // ── Iniciar checkout ───────────────────────────────────────────
    const handleInitiateCheckout = useCallback(() => {
        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return;
        }

        const itemsToProcess = pos.order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }

        mobileCart.closeCart();

        const itemsRequiring = features?.hasLabFields
            ? itemsToProcess.filter(item =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        if (itemsRequiring.length > 0) {
            prescription.setPrescriptionItems(itemsRequiring);
            prescription.setTempPrescriptionData(null);
            modal.openModal('prescription');
        } else {
            prescription.setTempPrescriptionData(null);
            modal.openModal('payment');
        }
    }, [
        pos.order,
        features?.hasLabFields,
        mobileCart,
        modal,
        prescription
    ]);

    // ── Procesar orden ─────────────────────────────────────────────
    const handleProcessOrder = useCallback(async (paymentData, forceSale = false) => {
        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        if (paymentData.paymentMethod === 'efectivo' && (!pos.cajaActual || pos.cajaActual.estado !== 'abierta')) {
            modal.closeModal('payment');
            modal.openModal('quickCaja');
            return;
        }

        try {
            modal.closeModal('payment');

            const { processSale } = await import('../../services/salesService');
            const result = await processSale({
                order: pos.order,
                paymentData,
                total: pos.total,
                allProducts: posSearch.menuVisual,
                features,
                companyName: useAppStore.getState().companyProfile?.name || 'Tu Negocio',
                tempPrescriptionData: prescription.tempPrescriptionData,
                ignoreStock: forceSale,
                activeOrderId: pos.activeOrderId,
            });

            if (result.success) {
                pos.clearSession();
                prescription.setTempPrescriptionData(null);
                mobileCart.closeCart();
                showMessageModal('✅ ¡Venta registrada correctamente!');
                await posSearch.refreshOutOfStock();
                await fetchActiveTablesCount();
            } else {
                if (result.errorType === 'RACE_CONDITION') {
                    showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                    await posSearch.refreshOutOfStock();
                } else if (result.errorType === 'STOCK_WARNING') {
                    showMessageModal(
                        result.message,
                        () => handleProcessOrder(paymentData, true),
                        {
                            confirmButtonText: 'Sí, Vender Igual',
                            type: 'warning',
                        }
                    );
                } else {
                    showMessageModal(`Error: ${result.message}`, null, { type: 'error' });
                }
            }
        } catch (error) {
            console.error('Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
        }
    }, [
        verifySessionIntegrity,
        pos.cajaActual,
        pos.order,
        pos.total,
        pos.activeOrderId,
        posSearch.menuVisual,
        features,
        prescription.tempPrescriptionData,
        modal,
        mobileCart,
        pos,
        posSearch,
        fetchActiveTablesCount
    ]);

    // ── Caja rápida ────────────────────────────────────────────────
    const handleQuickCajaSubmit = useCallback(async (monto) => {
        const success = await pos.abrirCaja(monto);
        if (success) {
            modal.closeModal('quickCaja');
            modal.openModal('payment');
        } else {
            modal.closeModal('quickCaja');
        }
    }, [pos.abrirCaja, modal]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handleQuickCajaSubmit
    };
}
