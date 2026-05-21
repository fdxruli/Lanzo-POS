// src/hooks/useTableManagement.js
import { useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { useAppStore } from '../../store/useAppStore';
import { splitOpenTableOrder } from '../../services/salesService';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import { db, STORES } from '../../services/db/dexie';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { useActiveOrders } from './useActiveOrders';

/**
 * Hook para manejar la gestión de mesas (tables) del POS.
 * Encapsula la lógica de guardar orden abierta, cargar mesa, y split bill.
 * 
 * @param {Object} deps - Dependencias externas
 * @param {function} deps.openModal - Función para abrir modales
 * @param {function} deps.closeModal - Función para cerrar modales
 * @param {function} deps.refreshData - Función para recargar datos del store
 * @param {function} deps.checkHasOutOfStockProducts - Función para verificar productos agotados
 * @param {function} deps.fetchActiveTablesCount - Función para actualizar conteo de mesas
 * @returns {{
 *   handleSaveAsOpen: () => Promise<void>,
 *   handleLoadOpenOrder: (orderId: string) => void,
 *   handleQuickTableAction: (targetOrder: Object, actionType: 'checkout' | 'split') => Promise<void>,
 *   handleOpenSplitBill: () => void,
 *   handleConfirmSplitBill: (splitPayload: Object) => Promise<void>,
 *   handleAnnulKitchenRejectedOrder: (order: Object) => Promise<{ success: boolean, message?: string, cancelled?: boolean }>
 * }}
 */
export function useTableManagement({
    openModal,
    closeModal,
    refreshData,
    checkHasOutOfStockProducts,
    fetchActiveTablesCount,
    features,
    handleInitiateCheckout
}) {
    const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

    const {
        order,
        activeOrderId,
        clearSession,
        saveOrderAsOpen,
        loadOpenOrder,
        tableData
    } = useOrderStore.getState();

    // ── Guardar orden abierta ──────────────────────────────────────
    const handleSaveAsOpen = useCallback(async () => {
        if (!features?.hasTables) return;

        const currentTableData = useOrderStore.getState().tableData;
        const isUpdating = Boolean(useOrderStore.getState().isSavedOrder);

        if (!currentTableData || currentTableData.trim() === '') {
            const promptedName = window.prompt('Por favor, ingresa un identificador para la mesa (Ej: Mesa 2, Barra, Cliente):');

            if (!promptedName || promptedName.trim() === '') {
                return;
            }
            useOrderStore.setState({ tableData: promptedName.trim() });
        }

        const result = await saveOrderAsOpen();
        if (result.success) {
            // 🔧 FIX: Cambiar fulfillmentStatus a 'pending' para que NO se recargue como "en edición"
            // cuando se regrese del OrderPage al POS
            try {
                const orderId = useOrderStore.getState().activeOrderId || result.id;
                await db.table(STORES.SALES).update(orderId, {
                    fulfillmentStatus: 'pending',
                    updatedAt: new Date().toISOString()
                });
            } catch (err) {
                console.error("Error actualizando fulfillmentStatus a pending:", err);
                // Continuamos aunque falle, la orden ya está guardada
            }

            // Eliminar la orden de la sesión activa tras enviarla a la cocina (Mesas)
            try {
                const currentId = useOrderStore.getState().activeOrderId || result.id;
                // Si la función importada useActiveOrders está disponible
                const { useActiveOrders } = await import('./useActiveOrders.js');
                const state = useActiveOrders.getState();
                
                // Si hay más órdenes activas cambiamos a otra, si no cerramos
                const nextOrders = new Map(state.activeOrders);
                nextOrders.delete(currentId);
                useActiveOrders.setState({ activeOrders: nextOrders });
                
                if (nextOrders.size > 0) {
                    state.switchOrder(Array.from(nextOrders.keys())[0]);
                } else {
                    useActiveOrders.setState({ currentOrderId: null });
                    state.createOrder();
                }
            } catch (err) {
                console.error("No se pudo cerrar la pestaña activa:", err);
            }

            // Cerrar modal móvil si está abierto
            const modalState = document.querySelector('.modal[style*="z-index: 10005"]');
            if (modalState) {
                // El padre se encarga de cerrar el modal móvil
            }
            showMessageModal(isUpdating ? '✅ Mesa actualizada correctamente.' : '✅ Pedido guardado y enviado a cocina.');
            await fetchActiveTablesCount();
            return;
        }

        showMessageModal(result.message || 'No se pudo guardar la orden abierta.', null, { type: 'error' });
    }, [features?.hasTables, saveOrderAsOpen, fetchActiveTablesCount]);

    // ── Cargar orden abierta ───────────────────────────────────────
    const executeLoadOpenOrder = useCallback(async (orderId, silent = false) => {
        const result = await loadOpenOrder(orderId);
        if (result.success) {
            // CORRECCIÓN: Registrar la orden en useActiveOrders.
            // loadOpenOrder solo actualiza useOrderStore (order, activeOrderId, tableData).
            // Si la orden no está en el map de useActiveOrders, lockOrderForCheckout
            // la rechazará con "La orden no existe en sesión", bloqueando el checkout.
            //
            // Sincronizamos el estado del store con activeOrders usando la orden
            // ya hidratada desde la BD, garantizando consistencia entre ambos stores.
            try {
                const activeOrdersState = useActiveOrders.getState();
                const { order: loadedOrder, activeOrderId: loadedOrderId, tableData: loadedTableData } = useOrderStore.getState();

                if (loadedOrderId && !activeOrdersState.activeOrders.has(loadedOrderId)) {
                    const nextOrders = new Map(activeOrdersState.activeOrders);
                    nextOrders.set(loadedOrderId, {
                        id: loadedOrderId,
                        items: Array.isArray(loadedOrder) ? loadedOrder : [],
                        tableData: loadedTableData || null,
                        createdAt: new Date().toISOString(),
                        total: 0,
                        isSaved: true
                    });
                    useActiveOrders.setState({
                        activeOrders: nextOrders,
                        currentOrderId: loadedOrderId
                    });
                }
            } catch (syncErr) {
                console.error('[useTableManagement] Error sincronizando orden con activeOrders:', syncErr);
                // No es fatal: el checkout puede continuar si la orden ya está en activeOrders
            }

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

    const handleLoadOpenOrder = useCallback((orderId) => {
        if (!features?.hasTables) return;

        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);
        if (!hasCurrentOrder) {
            void executeLoadOpenOrder(orderId);
            return;
        }

        showMessageModal(
            'Hay un carrito activo. Deseas reemplazarlo por la mesa seleccionada?',
            () => {
                void executeLoadOpenOrder(orderId);
            },
            {
                title: 'Cambiar mesa activa',
                type: 'warning',
                confirmButtonText: 'Si, cargar mesa',
            }
        );
    }, [features?.hasTables, order, executeLoadOpenOrder]);

    // ── Acción rápida desde TablesView ─────────────────────────────
    const handleQuickTableAction = useCallback(async (targetOrder, actionType) => {
        const hasCurrentOrder = order.some((item) => Number(item?.quantity) > 0);

        if (hasCurrentOrder) {
            showMessageModal(
                'Tienes un carrito activo sin guardar. Límpialo o guárdalo antes de cobrar una mesa diferente.',
                () => { },
                {
                    title: 'Acción bloqueada',
                    type: 'error',
                    confirmButtonText: 'Entendido'
                }
            );
            return;
        }

        try {
            const result = await executeLoadOpenOrder(targetOrder.id, true);

            if (result && result.success) {
                closeModal('tables');

                if (actionType === 'checkout') {
                    // CORRECCIÓN: Delegar al flujo oficial de checkout.
                    // Llamar handleInitiateCheckout en lugar de openModal('payment') directamente
                    // garantiza que siempre se genere el snapshot inmutable y se adquiera
                    // el lock atómico sobre la orden antes de abrir el modal de pagos.
                    if (typeof handleInitiateCheckout === 'function') {
                        await handleInitiateCheckout();
                    } else {
                        // Fallback de seguridad: nunca debería llegar aquí
                        console.error('[useTableManagement] handleInitiateCheckout no está disponible.');
                        openModal('payment');
                    }
                } else if (actionType === 'split') {
                    openModal('split');
                }
            } else {
                showMessageModal(result?.message || 'Error al cargar la mesa para cobro.', null, { type: 'error' });
            }
        } catch (error) {
            console.error("Error al cargar la mesa para acción rápida:", error);
        }
    }, [order, executeLoadOpenOrder, closeModal, openModal, handleInitiateCheckout]);

    /**
     * Anula en sistema una venta abierta rechazada en cocina (sale del modal de mesas).
     */
    const handleAnnulKitchenRejectedOrder = useCallback(async (targetOrder) => {
        if (!features?.hasTables) {
            return { success: false, message: 'Mesas no disponibles.' };
        }
        if (!targetOrder?.id) {
            return { success: false, message: 'Orden inválida.' };
        }
        if (
            targetOrder.status !== SALE_STATUS.OPEN
            || targetOrder.fulfillmentStatus !== 'cancelled'
        ) {
            return {
                success: false,
                message: 'Solo se puede anular desde aquí una comanda abierta y rechazada en cocina.'
            };
        }

        const ok = window.confirm(
            '¿Anular esta venta en el sistema? Se liberará el stock comprometido y desaparecerá de mesas y cocina. No genera cobro.'
        );
        if (!ok) {
            return { success: false, cancelled: true };
        }

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
    }, [features?.hasTables, fetchActiveTablesCount]);

    // ── Split Bill ─────────────────────────────────────────────────
    const handleOpenSplitBill = useCallback(() => {
        if (!features?.hasTables) return;

        if (!activeOrderId) {
            showMessageModal('No hay una mesa activa cargada para dividir.');
            return;
        }

        const sellableItems = order.filter((item) => Number(item?.quantity) > 0);
        if (sellableItems.length === 0) {
            showMessageModal('No hay productos en la mesa activa para dividir.');
            return;
        }

        openModal('split');
    }, [features?.hasTables, activeOrderId, order, openModal]);

    const handleConfirmSplitBill = useCallback(async (splitPayload) => {
        // Verificar idempotencia (usamos un ref en el componente padre si es necesario)
        const isSessionValid = await verifySessionIntegrity();
        if (!isSessionValid) {
            showMessageModal('Sesion invalida o licencia expirada. El sistema se recargará.', () => {
                window.location.reload();
            });
            return;
        }

        const { cajaActual } = useOrderStore.getState();
        if (
            splitPayload?.tickets?.some((ticket) => ticket?.paymentData?.paymentMethod === 'efectivo') &&
            (!cajaActual || cajaActual.estado !== 'abierta')
        ) {
            showMessageModal('Necesitas abrir caja para cobrar tickets en efectivo.', null, { type: 'warning' });
            return;
        }

        try {
            const result = await splitOpenTableOrder({
                parentOrderId: activeOrderId,
                orderSnapshot: order,
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

            if (result.errorType === 'DIRTY_ORDER') {
                showMessageModal(result.message, null, { type: 'warning' });
                return;
            }

            if (result.errorType === 'RACE_CONDITION') {
                showMessageModal(result.message, null, { type: 'warning' });
                await refreshData();
                return;
            }

            showMessageModal(result.message || 'No se pudo dividir/cobrar la mesa.', null, { type: 'error' });
        } catch (error) {
            Logger.error('Error crítico en Split Bill:', error);
            showMessageModal(`Error inesperado: ${error.message}`, null, { type: 'error' });
        }
    }, [
        activeOrderId,
        order,
        features,
        companyName,
        verifySessionIntegrity,
        clearSession,
        closeModal,
        refreshData,
        fetchActiveTablesCount
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
