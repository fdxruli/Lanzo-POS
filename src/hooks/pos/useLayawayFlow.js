// src/hooks/useLayawayFlow.js
import { useCallback, useRef } from 'react';

import { useFeatureConfig } from '../useFeatureConfig';
import { layawayFinancialService } from '../../services/layawayFinancialService';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import { selectCurrentOrder, useActiveOrders } from './useActiveOrders';
import {
    ECOMMERCE_POS_CHECKOUT_MESSAGE,
    getEcommercePosBlockedResult,
    isEcommercePosEffectBlocked
} from '../../services/ecommerce/ecommercePosDraftGuards';

/**
 * Hook para manejar los apartados (layaway) del POS.
 * Encapsula la lógica de iniciar y confirmar un apartado.
 * 
 * @param {Object} deps - Dependencias externas
 * @param {function} deps.openModal - Función para abrir modales
 * @param {function} deps.closeModal - Función para cerrar modales
 * @param {function} deps.showToast - Función para mostrar toast
 * @returns {{
 *   handleInitiateLayaway: () => void,
 *   handleConfirmLayaway: (data: Object) => Promise<void>
 * }}
 */
export function useLayawayFlow({
    openModal,
    closeModal,
    showToast,
    order,
    customer,
    total,
    clearOrder
}) {
    const submittingRef = useRef(false);
    // Obtener flags de features derivados del rubro/empresa
    const features = useFeatureConfig();

    const blockEcommerceLayaway = useCallback(() => {
        const activeOrder = selectCurrentOrder(useActiveOrders.getState());
        if (!isEcommercePosEffectBlocked(activeOrder)) return null;

        showMessageModal(ECOMMERCE_POS_CHECKOUT_MESSAGE, null, { type: 'warning' });
        return getEcommercePosBlockedResult();
    }, []);

    // ── Iniciar apartado ───────────────────────────────────────────
    const handleInitiateLayaway = useCallback(() => {
        const blocked = blockEcommerceLayaway();
        if (blocked) return blocked;

        if (order.length === 0) {
            showToast?.('⚠️ El carrito está vacío');
            return;
        }
        if (!features?.hasLayaway) return;
        openModal('layaway');
    }, [blockEcommerceLayaway, order.length, features?.hasLayaway, openModal, showToast]);

    // ── Confirmar apartado ─────────────────────────────────────────
    const handleConfirmLayaway = useCallback(async ({ initialPayment, deadline, customer: customerFromModal, cajaId }) => {
        const blocked = blockEcommerceLayaway();
        if (blocked) return blocked;

        try {
            if (submittingRef.current) return { success: false, duplicate: true };
            submittingRef.current = true;
            const targetCustomer = customerFromModal || customer;
            if (!targetCustomer) {
                throw new Error('No se ha identificado al cliente para el apartado.');
            }

            const layawayData = {
                id: crypto.randomUUID(),
                customerId: targetCustomer.id,
                customerName: targetCustomer.name,
                items: order,
                totalAmount: total,
                deadline: deadline,
            };

            const result = await layawayFinancialService.create({
                layawayData,
                initialPayment,
                paymentId: crypto.randomUUID(),
                paymentType: 'initial_deposit',
                cajaId
            });

            if (result.success) {
                clearOrder();
                closeModal('layaway');
                showMessageModal('✅ Apartado guardado correctamente');
            } else {
                showMessageModal('❌ Error al guardar apartado: ' + result.message);
            }
            return result;
        } catch (error) {
            Logger.error('Layaway Error', error);
            showMessageModal('Error inesperado al crear apartado.');
            return { success: false, message: error?.message || 'No se pudo crear el apartado.' };
        } finally {
            submittingRef.current = false;
        }
    }, [blockEcommerceLayaway, order, customer, total, clearOrder, closeModal]);

    return {
        handleInitiateLayaway,
        handleConfirmLayaway
    };
}
