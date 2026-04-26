// src/components/pos/PosModals.jsx
import PropTypes from 'prop-types';
import TablesView from './TablesView';
import SplitBillModal from './SplitBillModal';
import ScannerModal from '../common/ScannerModal';
import PaymentModal from '../common/PaymentModal';
import QuickCajaModal from '../common/QuickCajaModal';
import PrescriptionModal from './PrescriptionModal';
import LayawayModal from './LayawayModal';

/**
 * Componente contenedor para todos los modales del POS.
 * Usa un estado unificado de modal activo para controlar cuál se muestra.
 * 
 * @param {Object} props
 * @param {'scanner'|'payment'|'quickCaja'|'prescription'|'layaway'|'tables'|'split'|null} props.activeModal - Modal actualmente activo
 * @param {function} props.onClose - Función para cerrar el modal activo
 * @param {Object} props.handlers - Handlers de cada acción
 */
export default function PosModals({
    activeModal,
    onClose,
    handlers,
    data
}) {
    const {
        handleProcessOrder,
        handleConfirmSplitBill,
        handleQuickCajaSubmit,
        handlePrescriptionConfirm,
        handleConfirmLayaway,
        handleLoadOpenOrder,
        handleQuickTableAction
    } = handlers;

    const {
        order,
        total,
        customer,
        prescriptionItems,
        cajaActual,
        activeOrderId,
        features
    } = data;

    return (
        <>
            {/* Modal de Mesas */}
            {features?.hasTables && (
                <TablesView
                    show={activeModal === 'tables'}
                    onClose={() => onClose('tables')}
                    onSelectOrder={handleLoadOpenOrder}
                    onCheckoutOrder={(order) => handleQuickTableAction(order, 'checkout')}
                    onSplitOrder={(order) => handleQuickTableAction(order, 'split')}
                />
            )}

            {/* Modal de Scanner */}
            <ScannerModal
                show={activeModal === 'scanner'}
                onClose={() => onClose('scanner')}
            />

            {/* Modal de Pago */}
            <PaymentModal
                show={activeModal === 'payment'}
                onClose={() => onClose('payment')}
                onConfirm={handleProcessOrder}
                total={total}
            />

            {/* Modal de Split Bill */}
            <SplitBillModal
                show={activeModal === 'split'}
                onClose={() => onClose('split')}
                order={order}
                total={total}
                isCajaOpen={Boolean(cajaActual && cajaActual.estado === 'abierta')}
                onConfirm={handleConfirmSplitBill}
            />

            {/* Modal de Quick Caja */}
            <QuickCajaModal
                show={activeModal === 'quickCaja'}
                onClose={() => onClose('quickCaja')}
                onConfirm={handleQuickCajaSubmit}
            />

            {/* Modal de Prescripción */}
            <PrescriptionModal
                show={activeModal === 'prescription'}
                onClose={() => onClose('prescription')}
                onConfirm={handlePrescriptionConfirm}
                itemsRequiringPrescription={prescriptionItems}
            />

            {/* Modal de Apartado (Layaway) */}
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
        handleConfirmSplitBill: PropTypes.func.isRequired,
        handleQuickCajaSubmit: PropTypes.func.isRequired,
        handlePrescriptionConfirm: PropTypes.func.isRequired,
        handleConfirmLayaway: PropTypes.func.isRequired,
        handleLoadOpenOrder: PropTypes.func.isRequired,
        handleQuickTableAction: PropTypes.func.isRequired
    }).isRequired,
    data: PropTypes.shape({
        order: PropTypes.array.isRequired,
        total: PropTypes.number.isRequired,
        customer: PropTypes.object,
        prescriptionItems: PropTypes.array.isRequired,
        cajaActual: PropTypes.object,
        activeOrderId: PropTypes.string,
        features: PropTypes.object.isRequired
    }).isRequired
};
