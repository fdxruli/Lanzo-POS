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
import { resolveWithCacheResult } from '../../services/barcodeCache';
import { playBeep, playErrorBeep } from '../../services/audioBeep';
import { useCallback, useRef, useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { showMessageModal } from '../../services/utils';
import { clearRestaurantSplitDraft } from '../../services/sales/restaurantSplitDraft';
import { isRestaurantCloudTableShadow } from '../../services/restaurant/restaurantCloudTableGuards';
import './RestaurantCloudStatus.css';
import './EcommercePosConversionPanel.css';

// Includes catalog-owned dialogs and the global message dialog, whose state
// does not live in ui.activeModal. These layers are mounted only while open.
const hasBlockingScannerDialog = () => Boolean(
    document.querySelector('[role="dialog"], [aria-modal="true"], .ui-modal, .modal')
);
const isPosSearchCaptureTarget = (target) => target?.dataset?.posPhysicalCapture === 'true';

const ActiveOrderControls = () => {
    const activeOrders = useActiveOrders((state) => state.activeOrders);
    const currentOrderId = useActiveOrders((state) => state.currentOrderId);
    const createOrder = useActiveOrders((state) => state.createOrder);
    const switchOrder = useActiveOrders((state) => state.switchOrder);
    const inventoryConflictNotice = useActiveOrders((state) => state.inventoryConflictNotice);
    const dismissInventoryConflictNotice = useActiveOrders((state) => state.dismissInventoryConflictNotice);
    const openInventoryConflictSource = useActiveOrders((state) => state.openInventoryConflictSource);
    const cancelOrder = useActiveOrders((state) => state.cancelOrder);
    const enableMultipleOrders = useAppStore((state) => state.enableMultipleOrders);
    const [isPausing, setIsPausing] = useState(false);
    const shouldShowOrderTabs = activeOrders.size > 1 || (activeOrders.size >= 1 && enableMultipleOrders);

    const handleCreateOrder = (name) => createOrder(null, name || null);
    const handleDeleteOrder = async (id) => {
        try {
            setIsPausing(true);
            const result = await cancelOrder(id);
            if (result?.success) clearRestaurantSplitDraft(id);
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
                    inventoryConflictNotice={inventoryConflictNotice?.orderId === currentOrderId
                        ? inventoryConflictNotice : null}
                    onDismissInventoryNotice={dismissInventoryConflictNotice}
                    onOpenInventorySource={openInventoryConflictSource}
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
    const isRemoteTableReview = isRestaurantCloudTableShadow(currentOrder);
    const physicalScannerEnabled = Boolean(
        !isInitializing
        && currentOrder
        && !isRemoteTableReview
        && !isCurrentOrderLocked
        && !currentOrder.isLockedForCheckout
        && !ui.activeModal
        && !ui.isMobileCartOpen
    );
    const physicalScannerEnabledRef = useRef(false);
    const activeOrderIdRef = useRef(null);
    const scannerContextRef = useRef(0);
    physicalScannerEnabledRef.current = physicalScannerEnabled;
    activeOrderIdRef.current = currentOrder?.id || null;

    useEffect(() => {
        physicalScannerEnabledRef.current = physicalScannerEnabled;
        return () => {
            physicalScannerEnabledRef.current = false;
            scannerContextRef.current += 1;
        };
    }, [physicalScannerEnabled, currentOrder?.id]);

    const handlePhysicalScan = useCallback(async (scanEvent) => {
        if (!physicalScannerEnabledRef.current) return;
        const orderIdAtScan = activeOrderIdRef.current;
        const contextAtScan = scannerContextRef.current;
        const isScanCurrent = () => {
            const state = useActiveOrders.getState();
            const order = state.activeOrders.get(orderIdAtScan);
            return physicalScannerEnabledRef.current
                && scannerContextRef.current === contextAtScan
                && state.currentOrderId === orderIdAtScan
                && order && !state.isCurrentOrderLocked && !order.isLockedForCheckout
                && !isRestaurantCloudTableShadow(order)
                && !hasBlockingScannerDialog();
        };
        if (!isScanCurrent()) return;

        let resolution;
        try {
            resolution = await resolveWithCacheResult(scanEvent.code);
        } catch {
            if (!isScanCurrent()) return;
            void playErrorBeep();
            showMessageModal('No se pudo consultar el catálogo.', null, { type: 'error', duration: 1500 });
            return;
        }

        if (!isScanCurrent()) return;

        if (resolution.status !== 'RESOLVED') {
            const names = resolution.matches?.map((match) => match.name).filter(Boolean).join(', ');
            const productName = resolution.product?.name || scanEvent.code;
            const messages = {
                NOT_FOUND: `Producto no registrado: ${scanEvent.code}`,
                DUPLICATE: `Este código pertenece a varios productos: ${scanEvent.code}. ${names || ''} Corrige el código en Productos.`,
                INACTIVE: `Producto registrado, pero desactivado: ${productName}`,
                NO_SELLABLE_BATCH: `Producto registrado, sin lote disponible: ${productName}`,
            };
            void playErrorBeep();
            showMessageModal(
                messages[resolution.status] || 'No se pudo consultar el catálogo.',
                null,
                { type: resolution.status === 'DUPLICATE' ? 'warning' : 'error', duration: 2500 }
            );
            return;
        }

        const product = resolution.product;
        let result;
        try {
            result = await addMultipleScannedProducts?.([product], orderIdAtScan);
        } catch {
            if (!isScanCurrent()) return;
            void playErrorBeep();
            return;
        }
        if (!isScanCurrent()) return;
        if (!result?.success) {
            void playErrorBeep();
            if (!String(result?.code || '').startsWith('LOCAL_')) {
                showMessageModal('No se pudo agregar el producto escaneado.', null, { type: 'error', duration: 1500 });
            }
            return;
        }

        void playBeep(1000, 'sine');
    }, [addMultipleScannedProducts]);

    const { reset: resetPhysicalScanner } = usePhysicalBarcodeScanner({
        enabled: physicalScannerEnabled,
        onScan: (scanEvent) => {
            // Printable characters remain native input. Clear the search only
            // after a complete high-confidence scan, leaving manual typing intact.
            if (isPosSearchCaptureTarget(document.activeElement)) ui.setSearchTerm('');
            void handlePhysicalScan(scanEvent);
        },
        isExplicitCaptureTarget: isPosSearchCaptureTarget,
        isBlocked: hasBlockingScannerDialog
    });

    useEffect(() => {
        resetPhysicalScanner();
    }, [currentOrder?.id, resetPhysicalScanner]);

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
                        readOnly={isRemoteTableReview}
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
                    saleDiscount: data.saleDiscount,
                    customer: data.customer,
                    prescriptionItems: data.prescriptionItems,
                    cajaActual: data.cajaActual,
                    aperturaPendiente: data.aperturaPendiente,
                    cashActor: data.cashActor,
                    isCloudCash: data.isCloudCash,
                    isCloudCashReadOnly: data.isCloudCashReadOnly,
                    activeOrderId: data.activeOrderId,
                    tableName: currentOrder?.tableData || '',
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
