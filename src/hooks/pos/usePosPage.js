import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { selectCurrentOrder, selectCurrentOrderCustomer, selectCurrentOrderItems, selectCurrentOrderTableData, useActiveOrders } from './useActiveOrders';
import { useProductStore } from '../../store/useProductStore';
import { useCaja } from '../useCaja';
import { useInventoryMovement } from '../useInventoryMovement';
import { orderTotals } from '../../services/sales/orderTotals';
import { showMessageModal } from '../../services/utils';
import { playBeep, playBulkProductBeep, playErrorBeep } from '../../utils/audio';

export function usePosPage() {
    const verifySessionIntegrityStore = useAppStore((state) => state.verifySessionIntegrity);
    const companyName = useAppStore((state) => state.companyProfile?.name || 'Tu Negocio');
    const verifySessionIntegrity = useCallback((options = {}) => verifySessionIntegrityStore({ reason: 'sale_checkout', transactionMode: true, refreshProfile: false, forceRemote: false, allowLocalOnly: true, ...(options || {}) }), [verifySessionIntegrityStore]);
    const { cajaActual, aperturaPendiente, abrirCaja, asegurarCajaAbierta, cashActor, isCloudCash, isCloudCashReadOnly } = useCaja();
    const { scanProductFast } = useInventoryMovement();
    const clearOrder = useActiveOrders((state) => state.clearOrder);
    const saveOrderAsOpen = useActiveOrders((state) => state.saveOrderAsOpen);
    const activeOrder = useActiveOrders(selectCurrentOrder);
    const activeOrderId = useActiveOrders((state) => state.currentOrderId);
    const order = useActiveOrders(selectCurrentOrderItems);
    const customer = useActiveOrders(selectCurrentOrderCustomer);
    const tableData = useActiveOrders(selectCurrentOrderTableData);
    const [toastMsg, setToastMsg] = useState(null);

    useEffect(() => {
        const cleanup = useProductStore.getState().initialize();
        return cleanup;
    }, []);

    const showToast = useCallback((msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(null), 2000);
    }, []);

    const ecommerceExpectedTotal = Number(activeOrder?.expectedTotal);
    const total = activeOrder?.origin === 'ecommerce' && Number.isFinite(ecommerceExpectedTotal)
        ? ecommerceExpectedTotal
        : orderTotals(activeOrder || { items: order }).total;
    const totalItemsCount = order.reduce((acc, item) => acc + (item.saleType === 'bulk' ? 1 : item.quantity), 0);

    const processBarcode = useCallback(async (code) => {
        const product = await scanProductFast(code);
        if (product) {
            playBeep(1000, 'sine');
            useActiveOrders.getState().addSmartItem(product);
            if (product.saleType === 'bulk') {
                showMessageModal(`Producto a Granel: ${product.name}`, null, { type: 'warning', duration: 4000 });
                playBulkProductBeep();
            } else {
                showToast(`Agregado: ${product.name}`);
            }
        } else {
            playErrorBeep();
            showMessageModal(`Producto no encontrado: ${code}`, null, { type: 'error', duration: 1500 });
        }
    }, [scanProductFast, showToast]);

    const clearCurrentOrder = useCallback(() => {
        clearOrder();
    }, [clearOrder]);

    return { order, customer, activeOrderId, tableData, cajaActual, aperturaPendiente, cashActor, isCloudCash, isCloudCashReadOnly, companyName, total, totalItemsCount, toastMsg, verifySessionIntegrity, abrirCaja, asegurarCajaAbierta, saveOrderAsOpen, clearCurrentOrder, processBarcode, showToast };
}
