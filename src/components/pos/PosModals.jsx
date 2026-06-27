// src/components/pos/PosModals.jsx
import PropTypes from 'prop-types';
import TablesView from './TablesView';
import SplitBillModal from './SplitBillModal';
import ScannerModal from '../scanner/ScannerModal';
import PaymentModal from '../common/PaymentModal';
import QuickCajaModal from '../common/QuickCajaModal';
import PrescriptionModal from './PrescriptionModal';
import LayawayModal from './LayawayModal';

export default function PosModals({
    activeModal,
    onClose,
    handlers,
    data
}) {
    const {
        handleProcessOrder,
        handlePaymentModalClose,
        handleConfirmSplitBill,
        handleQuickCajaSubmit,
        handleQuickCajaClose,
        handlePrescriptionConfirm,
        handleConfirmLayaway,
        handleLoadOpenOrder,
        handleQuickTableAction,
        fetchActiveTablesCount,
        handleAnnulKitchenRejectedOrder
    } = handlers;

    const {
        order,
        total,
        customer,
        prescriptionItems,
        cajaActual,
        aperturaPendiente,
        cashActor,
        isCloudCashReadOnly,
        features
    } = data;

    const quickCajaResponsibleName = cashActor?.responsibleName || cashActor?.displayName || '';
    const lockQuickCajaResponsible = Boolean(cashActor?.isStaff && quickCajaResponsibleName);

    return (
        <>
            {features?.hasTables && (
                <TablesView
                    show={activeModal === 'tables'}
                    onClose={() => onClose('tables')}
                    onSelectOrder={handleLoadOpenOrder}
                    onCheckoutOrder={(order) => handleQuickTableAction(order, 'checkout')}
                    onSplitOrder={(order) => handleQuickTableAction(order, 'split')}
                    onAfterTablesLoad={fetchActiveTablesCount}
                    onAnnulKitchenRejectedOrder={handleAnnulKitchenRejectedOrder}
                />
            )}

            <ScannerModal
                show={activeModal === 'scanner'}
                onClose={() => onClose('scanner')}
            />

            <PaymentModal
                show={activeModal === 'payment'}
                onClose={handlePaymentModalClose}
                onConfirm={handleProcessOrder}
                total={total}
            />

            <SplitBillModal
                show={activeModal === 'split'}
                onClose={() => onClose('split')}
                order={order}
                total={total}
                isCajaOpen={Boolean(cajaActual && cajaActual.estado === 'abierta')}
                onConfirm={handleConfirmSplitBill}
            />

            <QuickCajaModal
                show={activeModal === 'quickCaja'}
                onClose={handleQuickCajaClose}
                onConfirm={handleQuickCajaSubmit}
                suggestedAmount={aperturaPendiente?.montoSugerido || '0'}
                responsibleName={quickCajaResponsibleName}
                lockResponsible={lockQuickCajaResponsible}
                readOnly={Boolean(aperturaPendiente?.readOnly || isCloudCashReadOnly)}
            />

            <PrescriptionModal
                show={activeModal === 'prescription'}
                onClose={() => onClose('prescription')}
                onConfirm={handlePrescriptionConfirm}
                itemsRequiringPrescription={prescriptionItems}
            />

            <LayawayModal
                show={activeModal === 'layaway'}
                onClose={() => onClose('layaway')}
                onConfirm={handleConfirmLayaway}
                total={total}
                customer={customer}
            />
        </>
    );
}

PosModals.propTypes = {
    activeModal: PropTypes.oneOf(['scanner', 'payment', 'quickCaja', 'prescription', 'layaway', 'tables', 'split', null]),
    onClose: PropTypes.func.isRequired,
    handlers: PropTypes.shape({
        handleProcessOrder: PropTypes.func.isRequired,
        handlePaymentModalClose: PropTypes.func.isRequired,
        handleConfirmSplitBill: PropTypes.func.isRequired,
        handleQuickCajaSubmit: PropTypes.func.isRequired,
        handleQuickCajaClose: PropTypes.func.isRequired,
        handlePrescriptionConfirm: PropTypes.func.isRequired,
        handleConfirmLayaway: PropTypes.func.isRequired,
        handleLoadOpenOrder: PropTypes.func.isRequired,
        handleQuickTableAction: PropTypes.func.isRequired,
        fetchActiveTablesCount: PropTypes.func,
        handleAnnulKitchenRejectedOrder: PropTypes.func
    }).isRequired,
    data: PropTypes.shape({
        order: PropTypes.array.isRequired,
        total: PropTypes.number.isRequired,
        customer: PropTypes.object,
        prescriptionItems: PropTypes.array.isRequired,
        cajaActual: PropTypes.object,
        aperturaPendiente: PropTypes.shape({
            montoSugerido: PropTypes.string,
            readOnly: PropTypes.bool
        }),
        cashActor: PropTypes.object,
        isCloudCashReadOnly: PropTypes.bool,
        activeOrderId: PropTypes.string,
        features: PropTypes.object.isRequired
    }).isRequired
};