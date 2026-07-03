// src/components/pos/PosPageContent.jsx
import PropTypes from 'prop-types';
import ProductMenu from './ProductMenu';
import OrderSummary from './OrderSummary';
import OrderDiscountPanel from './OrderDiscountPanel';
import MobilePosCart from './MobilePosCart';
import PosModals from './PosModals';
import PosToast from './PosToast';
import PosFloatingBar from './PosFloatingBar';
import OrderTabs from './OrderTabs';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import './RestaurantCloudStatus.css';

const ActiveOrderControls = () => {
    const activeOrders = useActiveOrders((state) => state.activeOrders);
    const currentOrderId = useActiveOrders((state) => state.currentOrderId);
    const createOrder = useActiveOrders((state) => state.createOrder);
    const switchOrder = useActiveOrders((state) => state.switchOrder);
    const cancelOrder = useActiveOrders((state) => state.cancelOrder);
    const enableMultipleOrders = useAppStore((state) => state.enableMultipleOrders);
    const [isPausing, setIsPausing] = useState(false);

    const handleCreateOrder = (name) => createOrder(null, name || null);
    const handleDeleteOrder = async (id) => {
        try {
            setIsPausing(true);
            await cancelOrder(id);
        } catch (error) {
            console.error('Error eliminando orden:', error);
            showMessageModal(error.message || 'Error al eliminar la orden', null, { type: 'error' });
        } finally {
            setIsPausing(false);
        }
    };

    return (
        <>
            {activeOrders.size === 0 && (
                <div style={{ padding: '12px', background: '#fff3cd', color: '#856404', textAlign: 'center' }}>
                    <span>No hay órdenes activas.</span>
                    <button onClick={() => handleCreateOrder()} style={{ marginLeft: '12px', padding: '4px 12px', background: 'var(--primary-color, #2e7d32)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        + Crear Orden
                    </button>
                </div>
            )}

            {activeOrders.size >= 1 && enableMultipleOrders && (
                <OrderTabs
                    activeOrders={activeOrders}
                    currentOrderId={currentOrderId}
                    isPausing={isPausing}
                    onSwitchOrder={switchOrder}
                    onCreateOrder={handleCreateOrder}
                    onDeleteOrder={handleDeleteOrder}
                />
            )}
        </>
    );
};

const PosPageContent = ({ data, ui, actions, features }) => {
    const createOrder = useActiveOrders((state) => state.createOrder);
    const loadOrdersFromDB = useActiveOrders((state) => state.loadOrdersFromDB);
    const [isInitializing, setIsInitializing] = useState(true);

    useEffect(() => {
        const initializeOrders = async () => {
            try {
                setIsInitializing(true);
                await loadOrdersFromDB();
            } catch (error) {
                console.error('Error en inicialización de órdenes:', error);
                createOrder();
            } finally {
                setIsInitializing(false);
            }
        };

        initializeOrders();
    }, [createOrder, loadOrdersFromDB]);

    if (isInitializing) {
        return (
            <div style={{ padding: '24px', textAlign: 'center', color: '#999' }}>
                <p>Cargando órdenes...</p>
            </div>
        );
    }

    const openTablesShortcutTotal = data.activeTablesCount + data.kitchenRejectedOpenCount;
    const hasMobileFloatingBar = (features.hasTables && openTablesShortcutTotal > 0) || data.totalItemsCount > 0;

    return (
        <>
            {!features.hasTables && <ActiveOrderControls />}

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
                        showExpiredCategory={data.hasExpiredItems}
                    />
                    <div className="pos-summary-stack">
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
                        <OrderDiscountPanel />
                    </div>
                </div>
            </div>

            <PosFloatingBar
                hasTables={features.hasTables}
                activeTablesCount={data.activeTablesCount}
                kitchenRejectedOpenCount={data.kitchenRejectedOpenCount}
                totalItemsCount={data.totalItemsCount}
                total={data.total}
                onOpenTables={() => ui.openModal('tables')}
                onOpenCart={ui.openMobileCart}
            />

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

            <PosToast message={data.toastMsg} />
            <PosModals
                activeModal={ui.activeModal}
                onClose={ui.closeModal}
                handlers={{
                    handleProcessOrder: actions.handleProcessOrder,
                    handlePaymentModalClose: actions.handlePaymentModalClose,
                    handleConfirmSplitBill: actions.handleConfirmSplitBill,
                    handleQuickCajaSubmit: actions.handleQuickCajaSubmit,
                    handleQuickCajaClose: actions.handleQuickCajaClose,
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
                    aperturaPendiente: data.aperturaPendiente,
                    cashActor: data.cashActor,
                    isCloudCash: data.isCloudCash,
                    isCloudCashReadOnly: data.isCloudCashReadOnly,
                    activeOrderId: data.activeOrderId,
                    features
                }}
            />
        </>
    );
};

PosPageContent.displayName = 'PosPageContent';
PosPageContent.propTypes = {
    data: PropTypes.object.isRequired,
    ui: PropTypes.object.isRequired,
    actions: PropTypes.object.isRequired,
    features: PropTypes.object.isRequired
};

export default PosPageContent;
