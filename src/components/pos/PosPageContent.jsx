// src/components/pos/PosPageContent.jsx
import PropTypes from 'prop-types';
import ProductMenu from './ProductMenu';
import OrderSummary from './OrderSummary';
import MobilePosCart from './MobilePosCart';
import PosModals from './PosModals';
import PosToast from './PosToast';
import PosFloatingBar from './PosFloatingBar';
import OrderTabs from './OrderTabs';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useState, useEffect } from 'react';
import { db, STORES } from '../../services/db/dexie';
import { SALE_STATUS } from '../../services/sales/financialStats';
import { useOrderStore } from '../../store/useOrderStore';

/**
 * Contenido principal de la página POS.
 * Componente "tonto" que recibe todas las props y renderiza.
 * Separamos esto del wrapper para facilitar testing y memoización.
 */
const PosPageContent = ({ data, ui, actions, features }) => {
    const activeOrdersState = useActiveOrders();
    const { activeOrders, currentOrderId, createOrder, switchOrder, cancelOrder, loadOrdersFromDB } = activeOrdersState;
    const [isPausing, setIsPausing] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    // EFECTO 1: Inicializar órdenes desde BD al montar
    useEffect(() => {
        const initializeOrders = async () => {
            try {
                setIsInitializing(true);

                // 1. Linkear stores PRIMERO para sincronización bidireccional
                //    (esto es CRÍTICO: debe ocurrir antes de loadOrdersFromDB)
                useOrderStore.getState().linkWithActiveOrders(useActiveOrders);

                // 2. Cargar órdenes abiertas de BD y localStorage
                await loadOrdersFromDB();

            } catch (error) {
                console.error('Error en inicialización de órdenes:', error);
                // Crear orden por defecto si falla
                createOrder();
            } finally {
                setIsInitializing(false);
            }
        };

        initializeOrders();
    }, []); // Solo al montar

    // EFECTO 2: Mantener sincronización del carrito
    useEffect(() => {
        const unsubscribe = useActiveOrders.subscribe((state) => {
            // Esto fuerza re-render cuando cambia activeOrders
        });

        return unsubscribe;
    }, []);

    const handleSwitchOrder = (id) => {
        switchOrder(id);
    };

    const handleCreateOrder = (name) => {
        createOrder(null, name || null);
    };

    const handleDeleteOrder = async (id) => {
        try {
            setIsPausing(true);
            await cancelOrder(id);
        } catch (error) {
            console.error('Error eliminando orden:', error);
            alert(error.message || 'Error al eliminar la orden');
        } finally {
            setIsPausing(false);
        }
    };

    // Mostrar cargando mientras se inicializa
    if (isInitializing) {
        return (
            <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>
                <p>Cargando órdenes...</p>
            </div>
        );
    }

    const ordersCount = activeOrders.size;
    const singleOrder = ordersCount === 1 ? Array.from(activeOrders.values())[0] : null;
    const openTablesShortcutTotal = data.activeTablesCount + data.kitchenRejectedOpenCount;
    const hasMobileFloatingBar = (features.hasTables && openTablesShortcutTotal > 0) || data.totalItemsCount > 0;

    return (
        <>
            {!features.hasTables && ordersCount === 0 && (
                <div style={{ padding: '12px', background: '#fff3cd', color: '#856404', textAlign: 'center' }}>
                    <span>No hay órdenes activas.</span>
                    <button
                        onClick={() => handleCreateOrder()}
                        style={{ marginLeft: '12px', padding: '4px 12px', background: 'var(--primary-color, #2e7d32)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                        + Crear Orden
                    </button>
                </div>
            )}

            {!features.hasTables && ordersCount >= 1 && (
                <OrderTabs
                    activeOrders={activeOrders}
                    currentOrderId={currentOrderId}
                    isPausing={isPausing}
                    onSwitchOrder={handleSwitchOrder}
                    onCreateOrder={handleCreateOrder}
                    onDeleteOrder={handleDeleteOrder}
                />
            )}

            {/* Layout principal */}
            <div className={`pos-page-layout${hasMobileFloatingBar ? ' pos-page-layout--with-floating-bar' : ''}`}>
                <div className="pos-grid">
                    <ProductMenu
                        products={data.menuVisual}
                        categories={data.categories}
                        selectedCategoryId={data.activeCategoryId}
                        onSelectCategory={ui.handleSelectCategory}
                        searchTerm={data.searchTerm}
                        onSearchChange={ui.setSearchTerm}
                        onOpenScanner={() => ui.openModal('scanner')}
                        showOutofStockCategory={data.hasOutOfStockItems}
                    />
                    <OrderSummary
                        onOpenPayment={actions.handleInitiateCheckout}
                        onOpenSplit={actions.handleOpenSplitBill}
                        onOpenLayaway={actions.handleInitiateLayaway}
                        showRestaurantActions={features.hasTables}
                        canSplitOrder={features.hasTables && !!data.activeOrderId}
                        onSaveOpenOrder={features.hasTables ? actions.handleSaveAsOpen : undefined}
                        onOpenTables={() => ui.openModal('tables')}
                        activeTablesCount={data.activeTablesCount}
                        kitchenRejectedOpenCount={data.kitchenRejectedOpenCount}
                    />
                </div>
            </div>

            {/* Barra flotante móvil */}
            <PosFloatingBar
                hasTables={features.hasTables}
                activeTablesCount={data.activeTablesCount}
                kitchenRejectedOpenCount={data.kitchenRejectedOpenCount}
                totalItemsCount={data.totalItemsCount}
                total={data.total}
                onOpenTables={() => ui.openModal('tables')}
                onOpenCart={ui.openMobileCart}
            />

            {/* Modal móvil del carrito */}
            <MobilePosCart
                isOpen={ui.isMobileCartOpen}
                onClose={ui.closeMobileCart}
                onOpenPayment={actions.handleInitiateCheckout}
                onOpenSplit={actions.handleOpenSplitBill}
                onOpenLayaway={actions.handleInitiateLayaway}
                onSaveOpenOrder={features.hasTables ? actions.handleSaveAsOpen : undefined}
                onOpenTables={() => ui.openModal('tables')}
                showRestaurantActions={features.hasTables}
                canSplitOrder={features.hasTables && !!data.activeOrderId}
                activeTablesCount={data.activeTablesCount}
                kitchenRejectedOpenCount={data.kitchenRejectedOpenCount}
            />

            {/* Toast notifications */}
            <PosToast message={data.toastMsg} />

            {/* Contenedor de modales */}
            <PosModals
                activeModal={ui.activeModal}
                onClose={ui.closeModal}
                handlers={{
                    handleProcessOrder: actions.handleProcessOrder,
                    handlePaymentModalClose: actions.handlePaymentModalClose,
                    handleConfirmSplitBill: actions.handleConfirmSplitBill,
                    handleQuickCajaSubmit: actions.handleQuickCajaSubmit,
                    handlePrescriptionConfirm: actions.handlePrescriptionConfirm,
                    handleConfirmLayaway: actions.handleConfirmLayaway,
                    handleLoadOpenOrder: actions.handleLoadOpenOrder,
                    handleQuickTableAction: actions.handleQuickTableAction,
                    fetchActiveTablesCount: actions.fetchActiveTablesCount,
                    handleAnnulKitchenRejectedOrder: actions.handleAnnulKitchenRejectedOrder
                }}
                data={{
                    order: data.order,
                    total: data.total,
                    customer: data.customer,
                    prescriptionItems: data.prescriptionItems,
                    cajaActual: data.cajaActual,
                    activeOrderId: data.activeOrderId,
                    features
                }}
            />
        </>
    );
};

PosPageContent.displayName = 'PosPageContent';

PosPageContent.propTypes = {
    data: PropTypes.shape({
        menuVisual: PropTypes.array.isRequired,
        categories: PropTypes.array.isRequired,
        activeCategoryId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        searchTerm: PropTypes.string.isRequired,
        hasOutOfStockItems: PropTypes.bool.isRequired,
        activeTablesCount: PropTypes.number.isRequired,
        kitchenRejectedOpenCount: PropTypes.number.isRequired,
        totalItemsCount: PropTypes.number.isRequired,
        total: PropTypes.number.isRequired,
        toastMsg: PropTypes.string,
        order: PropTypes.array.isRequired,
        customer: PropTypes.object,
        prescriptionItems: PropTypes.array.isRequired,
        cajaActual: PropTypes.object,
        activeOrderId: PropTypes.string
    }).isRequired,
    ui: PropTypes.shape({
        handleSelectCategory: PropTypes.func.isRequired,
        setSearchTerm: PropTypes.func.isRequired,
        openModal: PropTypes.func.isRequired,
        closeModal: PropTypes.func.isRequired,
        openMobileCart: PropTypes.func.isRequired,
        closeMobileCart: PropTypes.func.isRequired,
        isMobileCartOpen: PropTypes.bool.isRequired,
        activeModal: PropTypes.oneOf(['scanner', 'payment', 'quickCaja', 'prescription', 'layaway', 'tables', 'split', null])
    }).isRequired,
    actions: PropTypes.shape({
        handleInitiateCheckout: PropTypes.func.isRequired,
        handleOpenSplitBill: PropTypes.func.isRequired,
        handleInitiateLayaway: PropTypes.func.isRequired,
        handleSaveAsOpen: PropTypes.func.isRequired,
        handleProcessOrder: PropTypes.func.isRequired,
        handlePaymentModalClose: PropTypes.func.isRequired,
        handleConfirmSplitBill: PropTypes.func.isRequired,
        handleQuickCajaSubmit: PropTypes.func.isRequired,
        handlePrescriptionConfirm: PropTypes.func.isRequired,
        handleConfirmLayaway: PropTypes.func.isRequired,
        handleLoadOpenOrder: PropTypes.func.isRequired,
        handleQuickTableAction: PropTypes.func.isRequired,
        fetchActiveTablesCount: PropTypes.func,
        handleAnnulKitchenRejectedOrder: PropTypes.func
    }).isRequired,
    features: PropTypes.shape({
        hasTables: PropTypes.bool.isRequired,
        hasLabFields: PropTypes.bool.isRequired,
        hasLayaway: PropTypes.bool.isRequired
    }).isRequired
};

export default PosPageContent;
