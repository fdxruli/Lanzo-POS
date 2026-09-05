// src/hooks/useLayawayFlow.js
import { useCallback, useRef } from 'react';

import { useFeatureConfig } from '../useFeatureConfig';
import { layawayFinancialService } from '../../services/layawayFinancialService';
import { runTrackedActorOperationIfGranted } from '../../services/auth/actorOperationalHandoff';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import { selectCurrentOrder, useActiveOrders } from './useActiveOrders';
import {
    ECOMMERCE_POS_CHECKOUT_MESSAGE,
    getEcommercePosBlockedResult,
    isEcommercePosEffectBlocked
} from '../../services/ecommerce/ecommercePosDraftGuards';

const LAYAWAY_PRODUCT_FIELDS = ['product_id', 'productId', 'parentId'];
const LAYAWAY_PRODUCT_REQUIRED_MESSAGE =
    'Uno de los artículos del apartado no tiene un producto válido. Revisa el carrito y corrige o elimina esa línea antes de confirmar.';

const hasValidLayawayProductReference = (item = {}) => LAYAWAY_PRODUCT_FIELDS.some((field) => {
    const value = item?.[field];
    if (typeof value === 'string') return value.trim() !== '';
    return typeof value === 'number' && Number.isFinite(value);
});

const findInvalidLayawayItemIndex = (items = []) => (
    items.findIndex((item) => !hasValidLayawayProductReference(item))
);

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
    const handleConfirmLayaway = useCallback(async ({
        initialPayment,
        deadline,
        customer: customerFromModal,
        expectedCashSessionId
    }) => (
        runTrackedActorOperationIfGranted('pos.layaway.confirm', async () => {
            const blocked = blockEcommerceLayaway();
            if (blocked) return blocked;

            try {
                if (submittingRef.current) return { success: false, duplicate: true };
                submittingRef.current = true;
                const targetCustomer = customerFromModal || customer;
                if (!targetCustomer) {
                    throw new Error('No se ha identificado al cliente para el apartado.');
                }

                const invalidItemIndex = findInvalidLayawayItemIndex(order);
                if (invalidItemIndex !== -1) {
                    showMessageModal(LAYAWAY_PRODUCT_REQUIRED_MESSAGE, null, { type: 'warning' });
                    return {
                        success: false,
                        code: 'LAYAWAY_PRODUCT_REQUIRED',
                        message: LAYAWAY_PRODUCT_REQUIRED_MESSAGE,
                        itemIndex: invalidItemIndex
                    };
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
                    expectedCashSessionId
                });

                if (result.success) {
                    // clearOrder is actor-sensitive. Keeping it inside the tracked
                    // operation prevents a late A completion from clearing B's cart.
                    clearOrder();
                    closeModal('layaway');
                    showMessageModal('✅ Apartado guardado correctamente');
                } else {
                    showMessageModal('❌ Error al guardar apartado: ' + result.message);
                }
                return result;
            } catch (error) {
                Logger.error('Layaway Error', error);
                showMessageModal(`Error al crear apartado: ${error?.message || 'No se pudo crear el apartado.'}`);
                return { success: false, message: error?.message || 'No se pudo crear el apartado.' };
            } finally {
                submittingRef.current = false;
            }
        })
    ), [blockEcommerceLayaway, order, customer, total, clearOrder, closeModal]);

    return {
        handleInitiateLayaway,
        handleConfirmLayaway
    };
}
