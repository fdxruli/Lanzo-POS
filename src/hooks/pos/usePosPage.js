// src/hooks/usePosPage.js
import { useState, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useOrderStore } from '../../store/useOrderStore';
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
    const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
    const features = useAppStore((state) => state.features);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');

    const { cajaActual, abrirCaja } = useCaja();
    const { scanProductFast } = useInventoryMovement();

    const {
        order,
        customer,
        activeOrderId,
        clearOrder,
        clearSession,
        getTotalPrice,
        saveOrderAsOpen,
        loadOpenOrder
    } = useOrderStore();

    // ── Estado local ───────────────────────────────────────────────
    const [toastMsg, setToastMsg] = useState(null);

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
            await useOrderStore.getState().addSmartItem(product);

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
        cajaActual,
        features,
        companyName,
        total,
        totalItemsCount,
        toastMsg,
        verifySessionIntegrity,

        // Actions
        abrirCaja,
        saveOrderAsOpen,
        loadOpenOrder,
        clearSession,
        clearCurrentOrder,
        processBarcode,
        showToast
    };
}
