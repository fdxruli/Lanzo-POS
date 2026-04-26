// src/hooks/usePos.js
import { useFeatureConfig } from '../useFeatureConfig';
import { usePosModals, useMobileCartModal } from './usePosModals';
import { useBarcodeScanner } from './useBarcodeScanner';
import { usePosSearch } from './usePosSearch';
import { useTableManagement } from './useTableManagement';
import { useLayawayFlow } from './useLayawayFlow';
import { usePrescriptionFlow } from './usePrescriptionFlow';
import { useActiveTablesCount } from './useActiveTablesCount';
import { usePosPage } from './usePosPage';
import { usePosCheckout } from './usePosCheckout';

/**
 * Hook maestro que combina TODOS los hooks del POS en una sola interfaz.
 * Este es el único hook que el componente PosPage necesita consumir.
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
    // ── Feature flags ──────────────────────────────────────────────
    const features = useFeatureConfig();

    // ── Estado y acciones básicas ──────────────────────────────────
    const pos = usePosPage();

    // ── UI: Modales ────────────────────────────────────────────────
    const modals = usePosModals();
    const mobileCart = useMobileCartModal();

    // ── UI: Búsqueda ───────────────────────────────────────────────
    const search = usePosSearch({ debounceMs: 300 });

    // ── Estado derivado ────────────────────────────────────────────
    const tablesCount = useActiveTablesCount(features.hasTables);

    // ── Estados especializados ─────────────────────────────────────
    const prescription = usePrescriptionFlow(modals);

    // ── Scanner ────────────────────────────────────────────────────
    useBarcodeScanner(pos.processBarcode);

    // ── Lógica de negocio ──────────────────────────────────────────
    const tables = useTableManagement({
        ...modals,
        refreshData: search.refreshOutOfStock,
        checkHasOutOfStockProducts: () => {},
        fetchActiveTablesCount: tablesCount.fetchActiveTablesCount
    });

    const layaway = useLayawayFlow({
        ...modals,
        showToast: pos.showToast
    });

    // ── Checkout ───────────────────────────────────────────────────
    const checkout = usePosCheckout({
        pos,
        posSearch: search,
        modal: modals,
        mobileCart,
        prescription,
        features,
        fetchActiveTablesCount: tablesCount.fetchActiveTablesCount
    });

    // ── Interfaz unificada ─────────────────────────────────────────
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
            total: pos.total,
            totalItemsCount: pos.totalItemsCount,
            menuVisual: search.menuVisual,
            categories: search.categories,
            activeCategoryId: search.activeCategoryId,
            searchTerm: search.searchTerm,
            hasOutOfStockItems: search.hasOutOfStockItems,
            activeTablesCount: tablesCount.activeTablesCount,
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
            handleQuickCajaSubmit: checkout.handleQuickCajaSubmit,

            // Mesas
            handleSaveAsOpen: tables.handleSaveAsOpen,
            handleLoadOpenOrder: tables.handleLoadOpenOrder,
            handleQuickTableAction: tables.handleQuickTableAction,
            handleOpenSplitBill: tables.handleOpenSplitBill,
            handleConfirmSplitBill: tables.handleConfirmSplitBill,

            // Apartados
            handleInitiateLayaway: layaway.handleInitiateLayaway,
            handleConfirmLayaway: layaway.handleConfirmLayaway,

            // Prescripción
            handlePrescriptionConfirm: prescription.handlePrescriptionConfirm,
            setPrescriptionItems: prescription.setPrescriptionItems,
            setTempPrescriptionData: prescription.setTempPrescriptionData
        }
    };
}
