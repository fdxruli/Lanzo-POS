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

/**
 * Hook maestro que combina TODOS los hooks del POS en una sola interfaz.
 * Este es el Ãºnico hook que el componente PosPage necesita consumir.
 *
 * @returns {Object} Toda la data y handlers necesarios para el POS
 *
 * @example
 * const pos = usePos();
 * // pos.ui.* - Todo lo relacionado con UI/modales
 * // pos.data.* - Todos los datos (orden, productos, etc.)
 * // pos.actions.* - Todas las acciones (checkout, mesas, etc.)
 * // pos.features.* - Feature flags
 */
export function usePos() {
    // â”€â”€ Feature flags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const features = useFeatureConfig();

    // â”€â”€ Estado y acciones bÃ¡sicas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pos = usePosPage();

    // â”€â”€ UI: Modales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const modals = usePosModals();
    const mobileCart = useMobileCartModal();

    // â”€â”€ UI: BÃºsqueda â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const search = usePosSearch({ debounceMs: 300 });

    // â”€â”€ Estado derivado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const tablesCount = useActiveTablesCount(features.hasTables);

    // â”€â”€ Estados especializados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const prescription = usePrescriptionFlow(modals);

    // ── Checkout ──────────────────────────────────────────────────────────────────────────
    // IMPORTANTE: checkout debe instanciarse ANTES que tables para poder
    // pasar handleInitiateCheckout como dependencia de useTableManagement.
    const checkout = usePosCheckout({
        pos,
        posSearch: search,
        modal: modals,
        mobileCart,
        prescription,
        features,
        fetchActiveTablesCount: tablesCount.fetchActiveTablesCount
    });

    // ── Lógica de negocio ──────────────────────────────────────────────────────────────────
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

    // â”€â”€ Interfaz unificada â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return {
        // Feature flags
        features: {
            hasTables: features.hasTables,
            hasLabFields: features.hasLabFields,
            hasLayaway: features.hasLayaway
        },

        // Datos principales
        data: {
            order: pos.order,
            customer: pos.customer,
            activeOrderId: pos.activeOrderId,
            cajaActual: pos.cajaActual,
            aperturaPendiente: pos.aperturaPendiente,
            total: pos.total,
            totalItemsCount: pos.totalItemsCount,
            menuVisual: search.menuVisual,
            categories: search.categories,
            activeCategoryId: search.activeCategoryId,
            searchTerm: search.searchTerm,
            hasOutOfStockItems: search.hasOutOfStockItems,
            activeTablesCount: tablesCount.activeTablesCount,
            kitchenRejectedOpenCount: tablesCount.kitchenRejectedOpenCount,
            toastMsg: pos.toastMsg,
            prescriptionItems: prescription.prescriptionItems,
            tempPrescriptionData: prescription.tempPrescriptionData
        },

        // UI
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

        // Acciones
        actions: {
            // Checkout
            handleInitiateCheckout: checkout.handleInitiateCheckout,
            handleProcessOrder: checkout.handleProcessOrder,
            handlePaymentModalClose: checkout.handlePaymentModalClose,
            handleQuickCajaSubmit: checkout.handleQuickCajaSubmit,
            handleQuickCajaClose: checkout.handleQuickCajaClose,

            // Mesas
            handleSaveAsOpen: tables.handleSaveAsOpen,
            handleLoadOpenOrder: tables.handleLoadOpenOrder,
            handleQuickTableAction: tables.handleQuickTableAction,
            handleOpenSplitBill: tables.handleOpenSplitBill,
            handleConfirmSplitBill: tables.handleConfirmSplitBill,
            fetchActiveTablesCount: tablesCount.fetchActiveTablesCount,
            handleAnnulKitchenRejectedOrder: tables.handleAnnulKitchenRejectedOrder,

            // Apartados
            handleInitiateLayaway: layaway.handleInitiateLayaway,
            handleConfirmLayaway: layaway.handleConfirmLayaway,

            // PrescripciÃ³n
            handlePrescriptionConfirm: prescription.handlePrescriptionConfirm,
            setPrescriptionItems: prescription.setPrescriptionItems,
            setTempPrescriptionData: prescription.setTempPrescriptionData
        }
    };
}
