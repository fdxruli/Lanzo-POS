// src/hooks/usePosPage.js
import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
    selectCurrentOrderCustomer,
    selectCurrentOrderItems,
    selectCurrentOrderTableData,
    useActiveOrders
} from './useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import { useCaja } from '../useCaja';
import { useInventoryMovement } from '../useInventoryMovement';
import { showMessageModal } from '../../services/utils';
import { playBeep, playBulkProductBeep, playErrorBeep } from '../../utils/audio';

/**
 * Hook principal que orquesta toda la lógica del POS.
 * Combina todos los hooks secundarios y expone una interfaz unificada.
 * 
 * @returns {Object} Estado y handlers del POS
 */
export function usePosPage() {
    // ── Stores ─────────────────────────────────────────────────────
    const verifySessionIntegrityStore = useAppStore((state) => state.verifySessionIntegrity);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

    const verifySessionIntegrity = useCallback((options = {}) => verifySessionIntegrityStore({
        reason: 'sale_checkout',
        transactionMode: true,
        refreshProfile: false,
        forceRemote: false,
        allowLocalOnly: true,
        ...(options || {})
    }), [verifySessionIntegrityStore]);

    const {
        cajaActual,
        aperturaPendiente,
        abrirCaja,
        asegurarCajaAbierta,
        cashActor,
        isCloudCash,
        isCloudCashReadOnly
    } = useCaja();
    const { scanProductFast } = useInventoryMovement();

    // Suscripción reactiva: la barra flotante móvil y el checkout leen `order` / totales desde aquí.
    // Antes se usaba solo getState() en render, sin suscripción, y el padre no se re-renderizaba al agregar ítems.
    const clearOrder = useActiveOrders((state) => state.clearOrder);
    const getTotalPrice = useActiveOrders((state) => state.getTotalPrice);
    const saveOrderAsOpen = useActiveOrders((state) => state.saveOrderAsOpen);

    const activeOrderId = useActiveOrders((state) => state.currentOrderId);
    const order = useActiveOrders(selectCurrentOrderItems);
    const customer = useActiveOrders(selectCurrentOrderCustomer);
    const tableData = useActiveOrders(selectCurrentOrderTableData);

    // ── Estado local ───────────────────────────────────────────────
    const [toastMsg, setToastMsg] = useState(null);

    // ──────────────────────────────────────────────────────────────
    // REACTIVIDAD: Inicializar listeners reactivos del ProductStore
    // ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const cleanup = useProductStore.getState().initialize();
        return cleanup;
    }, []);

    // ── Helpers ────────────────────────────────────────────────────
    const showToast = useCallback((msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 2000);
    }, []);

    const total = getTotalPrice();
    const totalItemsCount = order.reduce(
        (acc, item) => acc + (item.saleType === 'bulk' ? 1 : item.quantity),
        0
    );

    // ── Scanner de código de barras ────────────────────────────────
    const processBarcode = useCallback(async (code) => {
        const product = await scanProductFast(code);

        if (product) {
            playBeep(1000, 'sine');
            useActiveOrders.getState().addSmartItem(product);

            if (product.saleType === 'bulk') {
                showMessageModal(
                    `⚖️ Producto a Granel: ${product.name}`,
                    null,
                    { type: 'warning', duration: 4000 }
                );
                playBulkProductBeep();
            } else {
                showToast(`✅ Agregado: ${product.name}`);
            }
        } else {
            playErrorBeep();
            showMessageModal(`⚠️ Producto no encontrado: ${code}`, null, { type: 'error', duration: 1500 });
        }
    }, [scanProductFast, showToast]);

    // ── Acciones de orden ──────────────────────────────────────────
    const clearCurrentOrder = useCallback(() => {
        clearOrder();
    }, [clearOrder]);

    return {
        // Estado
        order,
        customer,
        activeOrderId,
        tableData,
        cajaActual,
        aperturaPendiente,
        cashActor,
        isCloudCash,
        isCloudCashReadOnly,
        companyName,
        total,
        totalItemsCount,
        toastMsg,
        verifySessionIntegrity,

        // Actions
        abrirCaja,
        asegurarCajaAbierta,
        saveOrderAsOpen,
        clearCurrentOrder,
        processBarcode,
        showToast
    };
}
