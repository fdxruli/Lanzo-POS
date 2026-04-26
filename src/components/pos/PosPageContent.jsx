// src/components/pos/PosPageContent.jsx
import PropTypes from 'prop-types';
import ProductMenu from './ProductMenu';
import OrderSummary from './OrderSummary';
import MobilePosCart from './MobilePosCart';
import PosModals from './PosModals';
import PosToast from './PosToast';
import PosFloatingBar from './PosFloatingBar';

/**
 * Contenido principal de la página POS.
 * Componente "tonto" que recibe todas las props y renderiza.
 * Separamos esto del wrapper para facilitar testing y memoización.
 */
const PosPageContent = ({ data, ui, actions, features }) => (
    <>
        {/* Layout principal */}
        <div className="pos-page-layout">
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
                />
            </div>
        </div>

        {/* Barra flotante móvil */}
        <PosFloatingBar
            hasTables={features.hasTables}
            activeTablesCount={data.activeTablesCount}
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
        />

        {/* Toast notifications */}
        <PosToast message={data.toastMsg} />

        {/* Contenedor de modales */}
        <PosModals
            activeModal={ui.activeModal}
            onClose={ui.closeModal}
            handlers={{
                handleProcessOrder: actions.handleProcessOrder,
                handleConfirmSplitBill: actions.handleConfirmSplitBill,
                handleQuickCajaSubmit: actions.handleQuickCajaSubmit,
                handlePrescriptionConfirm: actions.handlePrescriptionConfirm,
                handleConfirmLayaway: actions.handleConfirmLayaway,
                handleLoadOpenOrder: actions.handleLoadOpenOrder,
                handleQuickTableAction: actions.handleQuickTableAction
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

PosPageContent.displayName = 'PosPageContent';

PosPageContent.propTypes = {
    data: PropTypes.shape({
        menuVisual: PropTypes.array.isRequired,
        categories: PropTypes.array.isRequired,
        activeCategoryId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        searchTerm: PropTypes.string.isRequired,
        hasOutOfStockItems: PropTypes.bool.isRequired,
        activeTablesCount: PropTypes.number.isRequired,
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
        handleConfirmSplitBill: PropTypes.func.isRequired,
        handleQuickCajaSubmit: PropTypes.func.isRequired,
        handlePrescriptionConfirm: PropTypes.func.isRequired,
        handleConfirmLayaway: PropTypes.func.isRequired,
        handleLoadOpenOrder: PropTypes.func.isRequired,
        handleQuickTableAction: PropTypes.func.isRequired
    }).isRequired,
    features: PropTypes.shape({
        hasTables: PropTypes.bool.isRequired,
        hasLabFields: PropTypes.bool.isRequired,
        hasLayaway: PropTypes.bool.isRequired
    }).isRequired
};

export default PosPageContent;
