// src/hooks/usePos.js
import { useFeatureConfig } from '../useFeatureConfig';
import { usePosModals, useMobileCartModal } from './usePosModals';
import { usePosSearch } from './usePosSearch';
import { useTableManagement } from './useTableManagement';
import { useLayawayFlow } from './useLayawayFlow';
import { usePrescriptionFlow } from './usePrescriptionFlow';
import { useActiveTablesCount } from './useActiveTablesCount';
import { usePosPage } from './usePosPage';
import { usePosCheckout } from './usePosCheckout';
import { useEcommercePosCheckoutGate } from './useEcommercePosCheckoutGate';

export function usePos() {
    const features = useFeatureConfig();
    const pos = usePosPage();
    const modals = usePosModals();
    const mobileCart = useMobileCartModal();
    const search = usePosSearch({ debounceMs: 300 });
    const tablesCount = useActiveTablesCount(features.hasTables);
    const prescription = usePrescriptionFlow(modals);

    const canonicalCheckout = usePosCheckout({
        pos,
        posSearch: search,
        modal: modals,
        mobileCart,
        prescription,
        features,
        fetchActiveTablesCount: tablesCount.fetchActiveTablesCount
    });
    const checkout = useEcommercePosCheckoutGate({ checkout: canonicalCheckout });

    const tables = useTableManagement({
        ...modals,
        refreshData: search.refreshOutOfStock,
        checkHasOutOfStockProducts: () => {},
        fetchActiveTablesCount: tablesCount.fetchActiveTablesCount,
        features,
        handleInitiateCheckout: checkout.handleInitiateCheckout,
        cajaActual: pos.cajaActual,
        asegurarCajaAbierta: pos.asegurarCajaAbierta
    });

    const layaway = useLayawayFlow({
        ...modals,
        showToast: pos.showToast,
        order: pos.order,
        customer: pos.customer,
        total: pos.total,
        clearOrder: pos.clearCurrentOrder
    });

    return {
        features: {
            hasTables: features.hasTables,
            hasLabFields: features.hasLabFields,
            hasLayaway: features.hasLayaway
        },

        data: {
            order: pos.order,
            customer: pos.customer,
            activeOrderId: pos.activeOrderId,
            cajaActual: pos.cajaActual,
            aperturaPendiente: pos.aperturaPendiente,
            cashActor: pos.cashActor,
            isCloudCash: pos.isCloudCash,
            isCloudCashReadOnly: pos.isCloudCashReadOnly,
            total: pos.total,
            totalItemsCount: pos.totalItemsCount,
            menuVisual: search.menuVisual,
            categories: search.categories,
            activeCategoryId: search.activeCategoryId,
            searchTerm: search.searchTerm,
            hasOutOfStockItems: search.hasOutOfStockItems,
            hasExpiredItems: search.hasExpiredItems,
            activeTablesCount: tablesCount.activeTablesCount,
            kitchenRejectedOpenCount: tablesCount.kitchenRejectedOpenCount,
            toastMsg: pos.toastMsg,
            prescriptionItems: prescription.prescriptionItems,
            tempPrescriptionData: prescription.tempPrescriptionData
        },

        ui: {
            activeModal: modals.activeModal,
            isMobileCartOpen: mobileCart.isOpen,
            openModal: modals.openModal,
            closeModal: modals.closeModal,
            openMobileCart: mobileCart.openCart,
            closeMobileCart: mobileCart.closeCart,
            setSearchTerm: search.setSearchTerm,
            handleSelectCategory: search.handleSelectCategory
        },

        actions: {
            handleInitiateCheckout: checkout.handleInitiateCheckout,
            handleProcessOrder: checkout.handleProcessOrder,
            handlePaymentModalClose: checkout.handlePaymentModalClose,
            handleQuickCajaSubmit: checkout.handleQuickCajaSubmit,
            handleQuickCajaClose: checkout.handleQuickCajaClose,

            handleSaveAsOpen: tables.handleSaveAsOpen,
            handleLoadOpenOrder: tables.handleLoadOpenOrder,
            handleQuickTableAction: tables.handleQuickTableAction,
            handleOpenSplitBill: tables.handleOpenSplitBill,
            handleConfirmSplitBill: tables.handleConfirmSplitBill,
            fetchActiveTablesCount: tablesCount.fetchActiveTablesCount,
            handleAnnulKitchenRejectedOrder: tables.handleAnnulKitchenRejectedOrder,

            handleInitiateLayaway: layaway.handleInitiateLayaway,
            handleConfirmLayaway: layaway.handleConfirmLayaway,

            handlePrescriptionConfirm: prescription.handlePrescriptionConfirm,
            setPrescriptionItems: prescription.setPrescriptionItems,
            setTempPrescriptionData: prescription.setTempPrescriptionData
        }
    };
}
