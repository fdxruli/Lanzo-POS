// src/components/pos/PosPageContent.jsx
import PropTypes from 'prop-types';
import ProductMenu from './ProductMenu';
import OrderSummary from './OrderSummary';
import MobilePosCart from './MobilePosCart';
import PosModals from './PosModals';
import PosToast from './PosToast';
import PosFloatingBar from './PosFloatingBar';
import OrderTabs from './OrderTabs';
import EcommercePosConversionPanel from './EcommercePosConversionPanel';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { usePhysicalBarcodeScanner } from '../../hooks/scanner/usePhysicalBarcodeScanner';
import { resolveWithCache } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import { useCallback, useRef, useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import './RestaurantCloudStatus.css';
import './EcommercePosConversionPanel.css';

const ActiveOrderControls = () => {
    const activeOrders = useActiveOrders((state) => state.activeOrders);
    const currentOrderId = useActiveOrders((state) => state.currentOrderId);
    const createOrder = useActiveOrders((state) => state.createOrder);
    const switchOrder = useActiveOrders((state) => state.switchOrder);
    const cancelOrder = useActiveOrders((state) => state.cancelOrder);
    const enableMultipleOrders = useAppStore((state) => state.enableMultipleOrders);
    const [isPausing, setIsPausing] = useState(false);
    const shouldShowOrderTabs = activeOrders.size > 1 || (activeOrders.size >= 1 && enableMultipleOrders);

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
                    <button type="button" onClick={() => handleCreateOrder()} style={{ marginLeft: '12px', padding: '4px 12px', background: 'var(--primary-color, #2e7d32)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        + Crear Orden
                    </button>
                </div>
            )}

            {shouldShowOrderTabs && (
                <OrderTabs
                    activeOrders={activeOrders}
                    currentOrderId={currentOrderId}
                    isPausing={isPausing}
                    canCreateOrder={enableMultipleOrders}
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
    const addMultipleScannedProducts = useActiveOrders((state) => state.addMultipleScannedProducts);
    const isCurrentOrderLocked = useActiveOrders((state) => Boolean(state.isCurrentOrderLocked));
    const currentOrder = useActiveOrders((state) => (
        state.currentOrderId
            ? state.activeOrders.get(state.currentOrderId) || null
            : null
    ));
    const [isInitializing, setIsInitializing] = useState(true);
    const isEcommerceDraft = currentOrder?.origin === 'ecommerce';
    const physicalScannerEnabled = Boolean(
        !isInitializing
        && currentOrder
        && !isCurrentOrderLocked
        && !currentOrder.isLockedForCheckout
        && !ui.activeModal
        && !ui.isMobileCartOpen
    );
    const physicalScannerEnabledRef = useRef(false);
    const activeOrderIdRef = useRef(null);
    physicalScannerEnabledRef.current = physicalScannerEnabled;
    activeOrderIdRef.current = currentOrder?.id || null;

    const handlePhysicalScan = useCallback(async (scanEvent) => {
        if (!physicalScannerEnabledRef.current) return;
        const orderIdAtScan = activeOrderIdRef.current;

        let product;
        try {
            product = await resolveWithCache(scanEvent.code);
        } catch {
            if (!physicalScannerEnabledRef.current || activeOrderIdRef.current !== orderIdAtScan) return;
            void playErrorBeep();
            showMessageModal('No se pudo resolver el código escaneado.', null, { type: 'error', duration: 1500 });
            return;
        }

        if (!physicalScannerEnabledRef.current || activeOrderIdRef.current !== orderIdAtScan) return;

        if (!product) {
            void playErrorBeep();
            showMessageModal(`⚠️ Producto no encontrado: ${scanEvent.code}`, null, { type: 'error', duration: 1500 });
            return;
        }

        const result = addMultipleScannedProducts?.([product]);
        if (!result?.success) {
            void playErrorBeep();
            showMessageModal('No se pudo agregar el producto escaneado.', null, { type: 'error', duration: 1500 });
            return;
        }

        void playBeep(1000, 'sine');
    }, [addMultipleScannedProducts]);

    usePhysicalBarcodeScanner({
        enabled: physicalScannerEnabled,
        onScan: handlePhysicalScan
    });

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
    const blockUnsupportedEcommerceAction = () => showMessageModal(
        'Este pedido online solo permite resolver inventario y cobrar.',
        null,
        { type: 'warning' }
    );

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
                        hasMore={data.hasMoreCatalogProducts}
                        isLoadingInitial={data.isLoadingInitialCatalog}
                        isLoadingNextPage={data.isLoadingNextCatalogPage}
                        onLoadNextPage={ui.loadNextCatalogPage}
                        activeViewKey={data.activeCatalogViewKey}
                        savedScrollPosition={data.catalogScrollPosition}
                        onScrollPositionChange={ui.saveCatalogScrollPosition}
                    />
                    <div className={`pos-summary-stack${features.hasTables ? ' pos-summary-stack--restaurant' : ''}${isEcommerceDraft ? ' pos-summary-stack--ecommerce' : ''}`}>
                        <OrderSummary
                            onOpenPayment={actions.handleInitiateCheckout}
                            onOpenSplit={isEcommerceDraft ? blockUnsupportedEcommerceAction : actions.handleOpenSplitBill}
                            onOpenLayaway={isEcommerceDraft ? blockUnsupportedEcommerceAction : actions.handleInitiateLayaway}
                            showRestaurantActions={features.hasTables && !isEcommerceDraft}
                            canSplitOrder={!isEcommerceDraft && features.hasTables && !!data.activeOrderId}
                            onSaveOpenOrder={features.hasTables && !isEcommerceDraft ? actions.handleSaveAsOpen : undefined}
                            onOpenTables={() => ui.openModal('tables')}
                            activeTablesCount={data.activeTablesCount}
                            kitchenRejectedOpenCount={data.kitchenRejectedOpenCount}
                        />
                        {isEcommerceDraft && (
                            <EcommercePosConversionPanel
                                order={currentOrder}
                                onCheckout={actions.handleInitiateCheckout}
                            />
                        )}
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
                onOpenSplit={isEcommerceDraft ? blockUnsupportedEcommerceAction : actions.handleOpenSplitBill}
                onOpenLayaway={isEcommerceDraft ? blockUnsupportedEcommerceAction : actions.handleInitiateLayaway}
                onSaveOpenOrder={features.hasTables && !isEcommerceDraft ? actions.handleSaveAsOpen : undefined}
                onOpenTables={() => ui.openModal('tables')}
                showRestaurantActions={features.hasTables && !isEcommerceDraft}
                canSplitOrder={!isEcommerceDraft && features.hasTables && !!data.activeOrderId}
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
