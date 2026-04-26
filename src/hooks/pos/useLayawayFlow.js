// src/hooks/useLayawayFlow.js
import { useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { useAppStore } from '../../store/useAppStore';
import { layawayRepo } from '../../services/db';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';

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
    showToast
}) {
    const features = useAppStore((state) => state.features);

    const {
        order,
        customer,
        clearOrder,
        getTotalPrice
    } = useOrderStore();

    const total = getTotalPrice();

    // ── Iniciar apartado ───────────────────────────────────────────
    const handleInitiateLayaway = useCallback(() => {
        if (order.length === 0) {
            showToast?.('⚠️ El carrito está vacío');
            return;
        }
        if (!features?.hasLayaway) return;
        openModal('layaway');
    }, [order.length, features?.hasLayaway, openModal, showToast]);

    // ── Confirmar apartado ─────────────────────────────────────────
    const handleConfirmLayaway = useCallback(async ({ initialPayment, deadline, customer: customerFromModal }) => {
        try {
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

            const result = await layawayRepo.create(layawayData, initialPayment);

            if (result.success) {
                clearOrder();
                closeModal('layaway');
                showMessageModal('✅ Apartado guardado correctamente');
            } else {
                showMessageModal('❌ Error al guardar apartado: ' + result.message);
            }
        } catch (error) {
            Logger.error('Layaway Error', error);
            showMessageModal('Error inesperado al crear apartado.');
        }
    }, [order, customer, total, clearOrder, closeModal, openModal]);

    return {
        handleInitiateLayaway,
        handleConfirmLayaway
    };
}
