import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { selectCurrentOrder, selectCurrentOrderCustomer, selectCurrentOrderItems, selectCurrentOrderTableData, useActiveOrders } from './useActiveOrders';
import { usePosCatalogStore } from '../../store/usePosCatalogStore';
import { useCaja } from '../useCaja';
import { useInventoryMovement } from '../useInventoryMovement';
import { orderTotals } from '../../services/sales/orderTotals';
import { showMessageModal } from '../../services/utils';
import { playBeep, playBulkProductBeep, playErrorBeep } from '../../utils/audio';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';

export function usePosPage() {
    const verifySessionIntegrityStore = useAppStore((state) => state.verifySessionIntegrity);
    const licenseDetails = useAppStore((state) => state.licenseDetails);
    const companyProfile = useAppStore((state) => state.companyProfile);
    const companyName = companyProfile?.name || 'Tu Negocio';
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

    const catalogSessionIdentity = useMemo(() => {
        const rawBusinessTypes = companyProfile?.business_type;
        const businessTypes = (Array.isArray(rawBusinessTypes)
            ? rawBusinessTypes
            : String(rawBusinessTypes || '').split(','))
            .map((value) => String(value).trim().toLowerCase())
            .filter(Boolean)
            .sort();
        return JSON.stringify({
            license: getLicenseKeyFromDetails(licenseDetails) || 'local',
            plan: licenseDetails?.plan || licenseDetails?.plan_type || licenseDetails?.details?.plan || 'local',
            licenseVersion: licenseDetails?.updated_at || licenseDetails?.updatedAt || null,
            business: companyProfile?.id || companyProfile?.business_id || companyProfile?.name || 'unknown',
            profileVersion: companyProfile?.updated_at || companyProfile?.updatedAt || null,
            businessTypes
        });
    }, [companyProfile, licenseDetails]);

    useEffect(() => {
        const catalogStore = usePosCatalogStore.getState();
        catalogStore.setSessionIdentity(catalogSessionIdentity);
        const cleanup = catalogStore.initialize();
        return cleanup;
    }, [catalogSessionIdentity]);

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
