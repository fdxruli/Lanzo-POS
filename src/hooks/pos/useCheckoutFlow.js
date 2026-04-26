// src/hooks/useCheckoutFlow.js
import { useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useOrderStore } from '../../store/useOrderStore';
import { processSale } from '../../services/salesService';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';

/**
 * Hook para manejar el flujo de checkout (pago) del POS.
 * Encapsula la lógica de inicio de pago, validación de sesión y procesamiento de venta.
 * 
 * @param {Object} deps - Dependencias externas
 * @param {function} deps.openModal - Función para abrir modales
 * @param {function} deps.closeModal - Función para cerrar modales
 * @param {function} deps.closeMobileCart - Función para cerrar el modal móvil
 * @param {function} deps.refreshData - Función para recargar datos del store
 * @param {function} deps.checkHasOutOfStockProducts - Función para verificar productos agotados
 * @param {function} deps.fetchActiveTablesCount - Función para actualizar conteo de mesas
 * @param {function} deps.setToastMsg - Función para mostrar toast (opcional)
 * @returns {{
 *   handleInitiateCheckout: () => void,
 *   handlePrescriptionConfirm: (data: Object) => void,
 *   handleProcessOrder: (paymentData: Object, forceSale?: boolean) => Promise<void>,
 *   handleQuickCajaSubmit: (monto: string) => Promise<void>,
 *   isSaleInProgress: boolean
 * }}
 */
export function useCheckoutFlow({
    openModal,
    closeModal,
    closeMobileCart,
    refreshData,
    checkHasOutOfStockProducts,
    fetchActiveTablesCount,
    setToastMsg
}) {
    const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
    const features = useAppStore((state) => state.features);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');
    
    const { cajaActual, abrirCaja } = useAppStore((state) => ({
        cajaActual: state.cajaActual,
        abrirCaja: state.abrirCaja
    }));

    const {
        order,
        customer,
        activeOrderId,
        clearSession,
        getTotalPrice,
        tableData,
        saveOrderAsOpen
    } = useOrderStore();

    const total = getTotalPrice();

    // Usamos ref para evitar condiciones de carrera en doble-click
    const isSaleInProgressRef = useRef(false);
    const { setOrder: setOrderState } = useOrderStore();

    // ── Flujo de pago ──────────────────────────────────────────────
    const handleInitiateCheckout = useCallback(() => {
        const licenseDetails = useAppStore.getState().licenseDetails;
        if (!licenseDetails || !licenseDetails.valid) {
            showMessageModal('⚠️ Error de Seguridad: Licencia no válida.');
            return;
        }

        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }

        closeMobileCart?.();

        const itemsRequiring = features?.hasLabFields
            ? itemsToProcess.filter(item =>
                item.requiresPrescription ||
                (item.prescriptionType && item.prescriptionType !== 'otc')
            )
            : [];

        if (itemsRequiring.length > 0) {
            // Nota: necesitamos pasar los items al modal de prescripción
            // Esto se maneja en el componente padre
            openModal('prescription');
        } else {
            openModal('payment');
        }
    }, [order, features, closeMobileCart, openModal]);

    const handleProcessOrder = useCallback(async (paymentData, forceSale = false) => {
        // Idempotencia: verificar con ref atómico
        if (isSaleInProgressRef.current) {
            console.warn('🚫 Intento de venta duplicada bloqueado por idempotencia UI.');
            return;
        }

        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        isSaleInProgressRef.current = true;

        if (paymentData.paymentMethod === 'efectivo' && (!cajaActual || cajaActual.estado !== 'abierta')) {
            closeModal('payment');
            openModal('quickCaja');
            isSaleInProgressRef.current = false;
            return;
        }

        try {
            closeModal('payment');

            const result = await processSale({
                order,
                paymentData,
                total,
                allProducts: useOrderStore.getState().menu || [],
                features,
                companyName,
                tempPrescriptionData: null, // Se pasa desde el componente padre
                ignoreStock: forceSale,
                activeOrderId,
            });

            if (result.success) {
                clearSession();
                closeMobileCart?.();
                showMessageModal('✅ ¡Venta registrada correctamente!');

                // Recargamos catálogo y re-chequeamos agotados tras cada venta
                await refreshData();
                await fetchActiveTablesCount();
            } else {
                if (result.errorType === 'RACE_CONDITION') {
                    showMessageModal('⚠️ El sistema está muy ocupado. Por favor intenta cobrar de nuevo.');
                    await refreshData();
                } else if (result.errorType === 'STOCK_WARNING') {
                    showMessageModal(
                        result.message,
                        () => {
                            isSaleInProgressRef.current = false;
                            handleProcessOrder(paymentData, true);
                        },
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
            Logger.error('Error crítico en UI:', error);
            showMessageModal(`Error inesperado: ${error.message}`);
        } finally {
            isSaleInProgressRef.current = false;
        }
    }, [
        order,
        total,
        features,
        companyName,
        activeOrderId,
        cajaActual,
        verifySessionIntegrity,
        clearSession,
        closeMobileCart,
        closeModal,
        openModal,
        refreshData,
        fetchActiveTablesCount
    ]);

    const handleQuickCajaSubmit = useCallback(async (monto) => {
        const success = await abrirCaja(monto);
        if (success) {
            closeModal('quickCaja');
            openModal('payment');
        } else {
            closeModal('quickCaja');
        }
    }, [abrirCaja, closeModal, openModal]);

    return {
        handleInitiateCheckout,
        handleProcessOrder,
        handleQuickCajaSubmit,
        isSaleInProgress: isSaleInProgressRef.current
    };
}
