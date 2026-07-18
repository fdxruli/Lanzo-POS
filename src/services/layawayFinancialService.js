import { layawayRepository } from './db/layaways';
import { cashRepository } from './cash/cashRepository';

const OPEN_CASH_MESSAGE = 'Debes abrir Caja antes de registrar un pago de apartado.';

const paymentReference = (layawayId, paymentId) => `layaway:${layawayId}:payment:${paymentId}`;
const refundReference = (layawayId, refundId) => `layaway:${layawayId}:refund:${refundId}`;

const getMovementId = (response) => (
    response?.movement?.id
    || response?.response?.movement?.id
    || response?.response?.cash_movement?.id
    || null
);

const requireOpenCashSession = async () => {
    const mode = cashRepository.getMode();
    const result = await cashRepository.getCurrentCashSession({ force: mode.cloudEnabled });
    const session = result?.cashSession;
    if (!session || session.estado !== 'abierta' || (mode.cloudEnabled && (result.readOnly || !mode.online))) {
        throw new Error(OPEN_CASH_MESSAGE);
    }
    return session;
};

const cashMetadata = ({ layawayId, paymentId, paymentType, customerId, idempotencyKey }) => ({
    source: 'layaway_payment',
    referenceType: 'layaway',
    referenceId: layawayId,
    layawayId,
    paymentId,
    paymentType,
    customerId,
    idempotencyKey
});

const refundMetadata = ({ layawayId, refundId, customerId, idempotencyKey }) => ({
    source: 'layaway_refund',
    referenceType: 'layaway',
    referenceId: layawayId,
    layawayId,
    refundId,
    customerId,
    idempotencyKey
});

const stablePayment = ({ layawayId, amount, paymentId, paymentType, customerId }) => {
    const id = paymentId || crypto.randomUUID();
    const idempotencyKey = paymentReference(layawayId, id);
    return {
        id,
        paymentId: id,
        amount: Number(amount),
        date: new Date().toISOString(),
        type: paymentType,
        paymentType,
        status: 'pending',
        idempotencyKey,
        layawayId,
        customerId
    };
};

export const layawayFinancialService = {
    async create({ layawayData, initialPayment = 0, paymentId = null, paymentType = 'initial_deposit' }) {
        const amount = Number(initialPayment) || 0;
        if (amount <= 0) return layawayRepository.create(layawayData, 0, null);

        const session = await requireOpenCashSession();
        const payment = stablePayment({
            layawayId: layawayData.id,
            amount,
            paymentId,
            paymentType,
            customerId: layawayData.customerId
        });
        const mode = cashRepository.getMode();

        if (!mode.cloudEnabled) {
            return layawayRepository.create(layawayData, amount, session.id, {
                payment,
                cashMovement: {
                    idempotencyKey: payment.idempotencyKey,
                    metadata: cashMetadata({ ...payment, layawayId: layawayData.id }),
                    createdAt: payment.date
                }
            });
        }

        let layaway = await layawayRepository.getById(layawayData.id);
        if (!layaway) {
            const pendingResult = await layawayRepository.create(layawayData, 0, null, { pendingPayment: payment });
            layaway = pendingResult.layaway;
        }
        const currentPayment = (layaway.payments || []).find((item) => item.id === payment.id)
            || (layaway.payments || []).find((item) => item.status === 'pending' && Number(item.amount) === amount)
            || payment;
        const resolvedPayment = {
            ...payment,
            ...currentPayment,
            idempotencyKey: currentPayment.idempotencyKey || payment.idempotencyKey
        };

        if (resolvedPayment.status === 'confirmed' && resolvedPayment.cashMovementId) {
            return { success: true, duplicate: true, layaway };
        }

        const response = await cashRepository.registerMovement({
            cashSessionId: session.id,
            type: 'entrada',
            amount,
            concept: `Abono inicial Apartado - ${layawayData.customerName}`,
            idempotencyKey: resolvedPayment.idempotencyKey,
            referenceId: layawayData.id,
            metadata: cashMetadata({ ...resolvedPayment, layawayId: layawayData.id })
        });
        if (!response || response.success === false) throw new Error(response?.message || 'No se pudo registrar el movimiento de Caja.');

        const cashMovementId = getMovementId(response);
        if (!cashMovementId) throw new Error('Caja confirmo el movimiento, pero no devolvio su identificador.');
        return layawayRepository.confirmPayment(layawayData.id, resolvedPayment.id, cashMovementId, session.id);
    },

    async addPayment({ layawayId, amount, paymentId = null, customerId = null }) {
        const layaway = await layawayRepository.getById(layawayId);
        if (!layaway) throw new Error('Apartado no encontrado');
        const session = await requireOpenCashSession();
        const mode = cashRepository.getMode();
        const pending = (layaway.payments || []).find((payment) => payment.status === 'pending' && Number(payment.amount) === Number(amount));
        const payment = pending || stablePayment({
            layawayId,
            amount,
            paymentId,
            paymentType: 'installment',
            customerId: customerId || layaway.customerId
        });

        if (!mode.cloudEnabled) {
            return layawayRepository.addPaymentWithCash(layawayId, payment, session.id, {
                idempotencyKey: payment.idempotencyKey,
                metadata: cashMetadata({ ...payment, layawayId }),
                createdAt: payment.date
            });
        }

        if (payment.status !== 'pending') return { success: true, duplicate: true, payment };
        await layawayRepository.addPayment(layawayId, payment);
        const response = await cashRepository.registerMovement({
            cashSessionId: session.id,
            type: 'entrada',
            amount: payment.amount,
            concept: `Abono Apartado #${layawayId.slice(-4)} - ${layaway.customerName}`,
            idempotencyKey: payment.idempotencyKey,
            referenceId: layawayId,
            metadata: cashMetadata({ ...payment, layawayId })
        });
        if (!response || response.success === false) throw new Error(response?.message || 'No se pudo registrar el movimiento de Caja.');
        const cashMovementId = getMovementId(response);
        if (!cashMovementId) throw new Error('Caja confirmo el movimiento, pero no devolvio su identificador.');
        return layawayRepository.confirmPayment(layawayId, payment.id, cashMovementId, session.id);
    },

    async cancel({ layawayId, reason, retainMoney = false, refundId = null }) {
        const layaway = await layawayRepository.getById(layawayId);
        if (!layaway) throw new Error('Apartado no encontrado');
        if (retainMoney || Number(layaway.paidAmount || 0) <= 0) {
            return layawayRepository.cancel(layawayId, reason, retainMoney, null);
        }

        const session = await requireOpenCashSession();
        const mode = cashRepository.getMode();
        const id = refundId || layaway.pendingRefund?.refundId || crypto.randomUUID();
        const idempotencyKey = refundReference(layawayId, id);
        const pendingResult = await layawayRepository.beginRefund(layawayId, {
            refundId: id,
            idempotencyKey,
            amount: layaway.paidAmount,
            customerId: layaway.customerId
        });
        if (pendingResult.duplicate && pendingResult.layaway?.status === 'cancelled') return pendingResult;
        const pendingRefund = pendingResult.pending || layaway.pendingRefund;

        if (!mode.cloudEnabled) {
            return layawayRepository.cancel(layawayId, reason, false, session.id, {
                cashMovement: {
                    idempotencyKey: pendingRefund.idempotencyKey,
                    metadata: refundMetadata({ layawayId, ...pendingRefund }),
                    createdAt: pendingRefund.createdAt
                }
            });
        }

        const response = await cashRepository.registerMovement({
            cashSessionId: session.id,
            type: 'salida',
            amount: pendingRefund.amount,
            concept: `Reembolso cancelacion de Apartado #${layawayId.slice(-4)}`,
            idempotencyKey: pendingRefund.idempotencyKey,
            referenceId: layawayId,
            metadata: refundMetadata({ layawayId, ...pendingRefund })
        });
        if (!response || response.success === false) throw new Error(response?.message || 'No se pudo registrar el reembolso en Caja.');
        const cashMovementId = getMovementId(response);
        if (!cashMovementId) throw new Error('Caja confirmo el reembolso, pero no devolvio su identificador.');
        return layawayRepository.completeRefund(layawayId, reason, cashMovementId);
    }
};

export { OPEN_CASH_MESSAGE, paymentReference, refundReference };
