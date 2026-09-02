import { layawayRepository } from './db/layaways';
import { cashRepository } from './cash/cashRepository';
import { areCashStationsEquivalent, getCashStationIdentity } from './cash/cashStation';
import {
    CASH_FINANCIAL_CODES,
    captureCashActorContext
} from './cash/cashFinancialGate';
import { runRefundsActorOperation } from './auth/refundsActorAuthorization';
import { Money } from '../utils/moneyMath';
import { salesCloudCashierService } from './salesCloud/salesCloudCashierService';
import { salesCloudRepository } from './salesCloud/salesCloudRepository';
import { getLicenseKeyFromDetails, isCloudLayawaysEnabled } from './sync/syncConstants';

const OPEN_CASH_MESSAGE = 'Debes abrir Caja antes de registrar un pago de apartado.';
const CLOUD_LAYAWAYS_DISABLED_MESSAGE =
    'Los apartados cloud aún no están activos para esta licencia.';

const assertCloudLayawaysEnabled = (mode) => {
    if (!mode?.cloudEnabled || isCloudLayawaysEnabled(mode.licenseDetails)) return;
    const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
    error.code = 'CLOUD_LAYAWAYS_DISABLED';
    throw error;
};

const paymentReference = (layawayId, paymentId) => `layaway:${layawayId}:payment:${paymentId}`;
const refundReference = (layawayId, refundId) => `layaway:${layawayId}:refund:${refundId}`;

const CASH_SESSION_CHANGED_MESSAGE =
    'La caja cambió mientras confirmabas el apartado. Vuelve a abrir la ventana y reintenta.';

const getSessionActorKey = (session) => session?.actorKey || session?.actor_key || null;
const getSessionStationId = (session) => (
    session?.cashStationId
    || session?.cash_station_id
    || session?.metadata?.cashStationId
    || session?.metadata?.cash_station_id
    || null
);
const isOpenCashSession = (session) => session?.estado === 'abierta' || session?.status === 'open';

const layawayCashError = (code, message, details = {}) => {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
};

const hasExpectedCashSessionId = (value) => (
    value !== null
    && value !== undefined
    && String(value).trim() !== ''
);

/**
 * Resolves the financial session from the current cash repository scope.
 * `expectedCashSessionId` is only a stale-modal guard; it is never used to
 * select or transfer the session used by a cash mutation.
 */
export const resolveLayawayCashSession = async ({
    expectedCashSessionId = null,
    operation = 'layaway cash operation'
} = {}) => {
    const mode = cashRepository.getMode();
    const result = await cashRepository.getCurrentCashSession({ force: mode.cloudEnabled });

    if (!result || result.success === false) {
        throw layawayCashError(
            result?.code || CASH_FINANCIAL_CODES.SESSION_REQUIRED,
            result?.message || OPEN_CASH_MESSAGE,
            { operation, result }
        );
    }

    if (mode.cloudEnabled && (!mode.online || mode.readOnly || result.readOnly)) {
        throw layawayCashError(
            !mode.online ? 'CLOUD_CASH_OFFLINE' : 'CLOUD_CASH_READ_ONLY',
            !mode.online
                ? 'Caja cloud requiere conexión para proteger el dinero y evitar descuadres. Revisa tu conexión e intenta de nuevo.'
                : 'La Caja cloud está en modo de solo lectura. Espera la sincronización y reintenta.',
            { operation, result }
        );
    }

    const session = result.cashSession || result.cash_session || null;
    if (!session?.id || !isOpenCashSession(session)) {
        throw layawayCashError(
            CASH_FINANCIAL_CODES.SESSION_REQUIRED,
            OPEN_CASH_MESSAGE,
            { operation, result }
        );
    }

    const financialState = result.financialState || {};
    const financialCode = result.financialCode || financialState.code || null;
    const stationId = result.cashStationId
        || result.cash_station_id
        || getSessionStationId(session);
    if (!stationId || financialCode === CASH_FINANCIAL_CODES.STATION_UNRESOLVED) {
        throw layawayCashError(
            CASH_FINANCIAL_CODES.STATION_UNRESOLVED,
            'No se pudo resolver la estación financiera actual. Abre Caja desde este dispositivo y reintenta.',
            { operation, result }
        );
    }

    if (financialState.status === 'HANDOFF_REQUIRED' || financialState.status === 'BLOCKED') {
        throw layawayCashError(
            financialCode || CASH_FINANCIAL_CODES.SESSION_REQUIRED,
            `La operación financiera está bloqueada: ${financialCode || 'estado no disponible'}.`,
            { operation, result }
        );
    }

    const actorKey = mode.actor?.actorKey || null;
    const sessionActorKey = getSessionActorKey(session);
    if (!actorKey || !sessionActorKey || sessionActorKey !== actorKey) {
        throw layawayCashError(
            CASH_FINANCIAL_CODES.HANDOFF_REQUIRED,
            'La sesión de Caja pertenece a otro actor o no tiene una identidad válida. Vuelve a abrir Caja y reintenta.',
            { operation, actorKey, sessionActorKey, sessionId: session.id }
        );
    }

    const sessionStationId = getSessionStationId(session);
    if (!sessionStationId || !areCashStationsEquivalent(sessionStationId, stationId)) {
        throw layawayCashError(
            CASH_FINANCIAL_CODES.STATION_MISMATCH,
            'La sesión de Caja no pertenece a la estación financiera actual. Vuelve a abrir Caja y reintenta.',
            { operation, sessionStationId, cashStationId: stationId, sessionId: session.id }
        );
    }

    if (hasExpectedCashSessionId(expectedCashSessionId)
        && String(session.id) !== String(expectedCashSessionId).trim()) {
        throw layawayCashError(
            'CASH_SESSION_CHANGED',
            CASH_SESSION_CHANGED_MESSAGE,
            {
                operation,
                expectedCashSessionId: String(expectedCashSessionId).trim(),
                currentCashSessionId: session.id
            }
        );
    }

    return { mode, result, session, cashStationId: stationId };
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

const getLayawayLineDiscountAmount = (item = {}, lineSubtotal) => {
    const explicitAmount = item.discountAmount ?? item.discount_amount;
    if (explicitAmount !== null && explicitAmount !== undefined && explicitAmount !== '') {
        return Math.max(0, Money.toNumber(explicitAmount));
    }
    const discount = item.discount;
    if (!discount || typeof discount !== 'object' || Array.isArray(discount)) return 0;
    const value = Number(discount.value ?? discount.amount ?? discount.percent ?? discount.percentage ?? 0);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const type = String(discount.type ?? discount.discountType ?? discount.discount_type ?? 'amount').toLowerCase();
    return Math.min(
        lineSubtotal,
        Money.toNumber(type === 'percent' || type === 'percentage' || type === 'porcentaje' || type === '%'
            ? Money.divide(Money.multiply(lineSubtotal, value), 100)
            : value)
    );
};

const buildCloudLayawayCompletionRequest = (layaway = {}) => {
    const saleId = layaway.conversionSaleId || layaway.conversion_sale_id || `layaway_sale_${layaway.id}`;
    const timestamp = layaway.status === 'completed' && layaway.deliveredAt
        ? layaway.deliveredAt
        : new Date().toISOString();
    const total = Money.toExactString(Money.init(layaway.totalAmount ?? layaway.total_amount ?? 0));
    const items = (Array.isArray(layaway.items) ? layaway.items : []).map((item, index) => {
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.price ?? item.unitPrice ?? item.unit_price ?? 0);
        const lineSubtotal = Money.toNumber(Money.multiply(unitPrice, quantity));
        const discountAmount = getLayawayLineDiscountAmount(item, lineSubtotal);
        const lineTotal = Money.toNumber(Money.subtract(lineSubtotal, discountAmount));
        return {
            id: item.id || `${saleId}:item:${index + 1}`,
            product_id: item.productId || item.product_id || item.parentId || item.id || null,
            product_name: item.name || item.productName || item.product_name || 'Producto',
            product_sku: item.sku || item.productSku || item.product_sku || null,
            barcode: item.barcode || item.barCode || null,
            category_id: item.categoryId || item.category_id || null,
            category_name: item.categoryName || item.category_name || item.rubro || item.category || null,
            rubro: item.rubro || item.category || item.categoryName || null,
            quantity,
            unit_price: unitPrice,
            unit_cost: item.cost ?? item.unitCost ?? item.unit_cost ?? null,
            line_subtotal: lineSubtotal,
            line_total: lineTotal,
            batch_id: item.batchId || item.batch_id || null,
            batch_sku: item.batchSku || item.batch_sku || null,
            batch_expiry_date: item.batchExpiryDate || item.batch_expiry_date || item.expiryDate || null,
            variant_id: item.variantId || item.variant_id || null,
            size: item.size || item.talla || null,
            color: item.color || item.colorName || null,
            attributes: item.attributes || null,
            variant_attributes: item.variantAttributes || item.variant_attributes || null,
            discount_amount: discountAmount,
            tax_amount: item.taxAmount ?? item.tax_amount ?? 0,
            metadata: {
                layawayId: layaway.id,
                snapshotOnly: true
            }
        };
    });

    const payment = {
        id: `${saleId}:payment:completion`,
        method: 'layaway_completed',
        amount: total,
        received_amount: total,
        change_amount: '0',
        metadata: {
            source: 'layaway_completion',
            layawayId: layaway.id,
            cashAlreadyRecorded: true
        }
    };

    return {
        layaway_id: layaway.id,
        sale: {
            id: saleId,
            local_sale_id: saleId,
            timestamp,
            sold_at: timestamp,
            created_at: timestamp,
            status: 'closed',
            fulfillment_status: 'fulfilled',
            payment_method: 'layaway_completed',
            payment_status: 'paid',
            customer_id: layaway.customerId || layaway.customer_id || null,
            customer_name: layaway.customerName || layaway.customer_name || null,
            customer_phone: layaway.customerPhone || layaway.customer_phone || null,
            subtotal: total,
            discount_total: '0',
            tax_total: '0',
            total,
            amount_paid: total,
            change_amount: '0',
            balance_due: '0',
            currency: layaway.currency || 'MXN',
            metadata: {
                origin: 'layaway_completion',
                layawayId: layaway.id,
                sourceMode: 'cloud_committed',
                cloudInventoryEffects: false,
                noCloudCashEffects: true,
                noCloudCreditEffects: true
            }
        },
        items,
        payments: [payment],
        local_items: Array.isArray(layaway.items) ? layaway.items : []
    };
};

const getLocalCashMutationContext = async (mode = cashRepository.getMode()) => {
    const actor = mode?.actor || null;
    if (!actor?.actorKey) return {};
    const station = await getCashStationIdentity();
    const actorContext = captureCashActorContext();
    return {
        actorKey: actor.actorKey,
        cashStationId: station.cashStationId,
        originActorGeneration: actorContext.generation ?? null,
        actorContext
    };
};

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
    async create({
        layawayData,
        initialPayment = 0,
        paymentId = null,
        paymentType = 'initial_deposit',
        expectedCashSessionId = null
    }) {
        const mode = cashRepository.getMode();
        const amount = Number(initialPayment) || 0;

        if (mode.cloudEnabled) {
            assertCloudLayawaysEnabled(mode);
            let cashSessionId = null;
            if (amount > 0) {
                const resolvedCash = await resolveLayawayCashSession({
                    expectedCashSessionId,
                    operation: 'layaway.create.initial_payment'
                });
                assertCloudLayawaysEnabled(resolvedCash.mode);
                if (!resolvedCash.mode.cloudEnabled) {
                    const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
                    error.code = 'CLOUD_LAYAWAYS_DISABLED';
                    throw error;
                }
                cashSessionId = resolvedCash.session.id;
            }
            const payment = amount > 0
                ? stablePayment({
                    layawayId: layawayData.id,
                    amount,
                    paymentId,
                    paymentType,
                    customerId: layawayData.customerId
                })
                : null;
            return salesCloudCashierService.processCloudLayawayCreate({
                layawayData,
                initialPayment: payment,
                cashSessionId,
                paymentId,
                paymentType,
                licenseDetails: mode.licenseDetails
            });
        }

        if (amount <= 0) return layawayRepository.create(layawayData, 0, null);

        const resolvedCash = await resolveLayawayCashSession({
            expectedCashSessionId,
            operation: 'layaway.create.initial_payment'
        });
        const currentMode = resolvedCash.mode;
        const session = resolvedCash.session;
        const payment = stablePayment({
            layawayId: layawayData.id,
            amount,
            paymentId,
            paymentType,
            customerId: layawayData.customerId
        });
        if (currentMode.cloudEnabled) {
            assertCloudLayawaysEnabled(currentMode);
            return salesCloudCashierService.processCloudLayawayCreate({
                layawayData,
                initialPayment: payment,
                cashSessionId: session.id,
                paymentId,
                paymentType,
                licenseDetails: currentMode.licenseDetails
            });
        }

        const cashContext = await getLocalCashMutationContext(currentMode);
        return layawayRepository.create(layawayData, amount, session.id, {
            payment,
            cashMovement: {
                cashSessionId: session.id,
                idempotencyKey: payment.idempotencyKey,
                metadata: cashMetadata({ ...payment, layawayId: layawayData.id }),
                ...cashContext,
                createdAt: payment.date
            }
        });
    },

    async addPayment({
        layawayId,
        amount,
        paymentId = null,
        customerId = null,
        expectedCashSessionId = null
    }) {
        const mode = cashRepository.getMode();
        if (mode.cloudEnabled) {
            assertCloudLayawaysEnabled(mode);
            const resolvedCash = await resolveLayawayCashSession({
                expectedCashSessionId,
                operation: 'layaway.add_payment'
            });
            assertCloudLayawaysEnabled(resolvedCash.mode);
            if (!resolvedCash.mode.cloudEnabled) {
                const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
                error.code = 'CLOUD_LAYAWAYS_DISABLED';
                throw error;
            }
            const payment = stablePayment({
                layawayId,
                amount,
                paymentId,
                paymentType: 'installment',
                customerId
            });
            return salesCloudCashierService.processCloudLayawayPayment({
                layawayId,
                payment,
                cashSessionId: resolvedCash.session.id,
                licenseDetails: mode.licenseDetails
            });
        }

        const layaway = await layawayRepository.getById(layawayId);
        if (!layaway) throw new Error('Apartado no encontrado');
        const resolvedCash = await resolveLayawayCashSession({
            expectedCashSessionId,
            operation: 'layaway.add_payment'
        });
        const currentMode = resolvedCash.mode;
        const session = resolvedCash.session;
        const pending = (layaway.payments || []).find((payment) => payment.status === 'pending' && Number(payment.amount) === Number(amount));
        const payment = pending || stablePayment({
            layawayId,
            amount,
            paymentId,
            paymentType: 'installment',
            customerId: customerId || layaway.customerId
        });

        if (currentMode.cloudEnabled) {
            assertCloudLayawaysEnabled(currentMode);
            return salesCloudCashierService.processCloudLayawayPayment({
                layawayId,
                payment,
                cashSessionId: session.id,
                licenseDetails: currentMode.licenseDetails
            });
        }

        const cashContext = await getLocalCashMutationContext(currentMode);
        return layawayRepository.addPaymentWithCash(layawayId, payment, session.id, {
            cashSessionId: session.id,
            idempotencyKey: payment.idempotencyKey,
            metadata: cashMetadata({ ...payment, layawayId }),
            ...cashContext,
            createdAt: payment.date
        });
    },

    async complete({ layawayId, cashierId = 'system' }) {
        const mode = cashRepository.getMode();
        if (mode.cloudEnabled) {
            assertCloudLayawaysEnabled(mode);
            if (!mode.online) throw new Error('OFFLINE');

            const useCloud = await salesCloudCashierService.canUseCloudLayawayCompletion(mode.licenseDetails);
            if (!useCloud) {
                const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
                error.code = 'CLOUD_LAYAWAYS_DISABLED';
                throw error;
            }

            const licenseKey = getLicenseKeyFromDetails(mode.licenseDetails);
            const snapshot = await salesCloudRepository.getLayaway({
                licenseKey,
                layawayId,
                force: true
            });
            const layaway = snapshot?.layaway || null;
            if (!layaway) throw new Error('Apartado no encontrado');
            if (layaway.status === 'cancelled') {
                throw new Error('No se puede entregar un apartado cancelado.');
            }
            if (!['active', 'ready', 'completed'].includes(layaway.status)) {
                throw new Error('Solo se puede entregar un apartado activo o listo.');
            }
            if (Number(layaway.total_amount ?? layaway.totalAmount ?? 0)
                - Number(layaway.paid_amount ?? layaway.paidAmount ?? 0) > 0.01) {
                throw new Error('El apartado debe estar liquidado para entregar.');
            }

            const request = buildCloudLayawayCompletionRequest(layaway);
            return salesCloudCashierService.processCloudLayawayCompletion({
                request,
                licenseDetails: mode.licenseDetails
            });
        }

        const layaway = await layawayRepository.getById(layawayId);
        if (!layaway) throw new Error('Apartado no encontrado');
        if (layaway.status === 'cancelled') {
            throw new Error('No se puede entregar un apartado cancelado.');
        }
        if (!['active', 'ready', 'completed'].includes(layaway.status)) {
            throw new Error('Solo se puede entregar un apartado activo o listo.');
        }
        if (Number(layaway.totalAmount || 0) - Number(layaway.paidAmount || 0) > 0.01) {
            throw new Error('El apartado debe estar liquidado para entregar.');
        }
        return layawayRepository.convertToSale(layawayId, cashierId);
    },

    async cancel({
        layawayId,
        reason,
        retainMoney = false,
        refundId = null,
        actorHandle = null,
        expectedCashSessionId = null
    }) {
      return runRefundsActorOperation({
        actorHandle,
        label: 'layaway.cancelOrRefund',
        operation: async ({ assertCurrent, handle }) => {
        const mode = cashRepository.getMode();
        if (mode.cloudEnabled) {
          assertCloudLayawaysEnabled(mode);
          const licenseKey = getLicenseKeyFromDetails(mode.licenseDetails);
          const snapshot = await salesCloudRepository.getLayaway({
            licenseKey,
            layawayId,
            force: true
          });
          assertCurrent();
          const layaway = snapshot?.layaway || null;
          if (!layaway) throw new Error('Apartado no encontrado');
          const paidAmount = Number(layaway.paid_amount ?? layaway.paidAmount ?? 0);
          let cashSessionId = null;
          if (!retainMoney && paidAmount > 0) {
            const resolvedCash = await resolveLayawayCashSession({
              expectedCashSessionId,
              operation: 'layaway.cancel.refund'
            });
            assertCurrent();
            cashSessionId = resolvedCash.session.id;
          }
          const result = await salesCloudCashierService.processCloudLayawayCancel({
            layawayId,
            reason,
            retainMoney,
            refundId,
            cashSessionId,
            licenseDetails: mode.licenseDetails,
            actorHandle: handle
          });
          assertCurrent();
          return result;
        }

        const layaway = await layawayRepository.getById(layawayId);
        assertCurrent();
        const currentMode = cashRepository.getMode();
        if (currentMode.cloudEnabled) {
          assertCloudLayawaysEnabled(currentMode);
          const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
          error.code = 'CLOUD_LAYAWAYS_DISABLED';
          throw error;
        }
        if (!layaway) throw new Error('Apartado no encontrado');
        if (retainMoney || Number(layaway.paidAmount || 0) <= 0) {
          return layawayRepository.cancel(layawayId, reason, retainMoney, null, {
            assertActorCurrent: assertCurrent
          });
        }

        const resolvedCash = await resolveLayawayCashSession({
            expectedCashSessionId,
            operation: 'layaway.cancel.refund'
        });
        const { mode: resolvedMode, session } = resolvedCash;
        if (resolvedMode.cloudEnabled) {
            const error = new Error(CLOUD_LAYAWAYS_DISABLED_MESSAGE);
            error.code = 'CLOUD_LAYAWAYS_DISABLED';
            throw error;
        }
        const id = refundId || layaway.pendingRefund?.refundId || crypto.randomUUID();
        const idempotencyKey = refundReference(layawayId, id);
        const pendingResult = await layawayRepository.beginRefund(layawayId, {
            refundId: id,
            idempotencyKey,
            amount: layaway.paidAmount,
            customerId: layaway.customerId
        }, { assertActorCurrent: assertCurrent });
        assertCurrent();
        if (pendingResult.duplicate && pendingResult.layaway?.status === 'cancelled') return pendingResult;
        const pendingRefund = pendingResult.pending || layaway.pendingRefund;

        const cashContext = await getLocalCashMutationContext(resolvedMode);
        return layawayRepository.cancel(layawayId, reason, false, session.id, {
          assertActorCurrent: assertCurrent,
          cashMovement: {
            cashSessionId: session.id,
            idempotencyKey: pendingRefund.idempotencyKey,
            metadata: refundMetadata({ layawayId, ...pendingRefund }),
            ...cashContext,
            createdAt: pendingRefund.createdAt
          }
        });
        }
      });
    }
};

export {
    OPEN_CASH_MESSAGE,
    paymentReference,
    refundReference,
    buildCloudLayawayCompletionRequest,
    CASH_SESSION_CHANGED_MESSAGE
};
