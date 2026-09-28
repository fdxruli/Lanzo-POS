import { generateID } from '../utils';
import { Money } from '../../utils/moneyMath';
import { normalizeStock } from '../db/utils';
import { SALE_STATUS } from './financialStats';
import { buildProcessedItemsAndDeductions } from './inventoryFlow';
import { runPostSaleEffects, runPostSaleEffectsForCloudCommittedSale } from './postSaleEffects';
import { salesCloudShadowService } from '../salesCloud/salesCloudShadowService';
import { salesCloudCashierService } from '../salesCloud/salesCloudCashierService';
import { restaurantOrdersRepository } from '../restaurant/restaurantOrdersRepository';
import { preflightCloudRestaurantOrderSplit } from '../restaurant/restaurantSplitCloudPreflight';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import {
    calculateByItemsTicketFinancials,
    normalizeRestaurantSplitIntent,
    RESTAURANT_SPLIT_INTENTS,
    roundSplitAmountToCents
} from './splitOrderContract';

const TABLE_ORDER_TYPE = 'table';
const OPEN_STATUS = SALE_STATUS.OPEN;
const DERIVED_SPLIT_ITEM_AMOUNT_FIELDS = new Set([
    'exactTotal',
    'lineSubtotal',
    'lineTotal',
    'line_subtotal',
    'line_total',
    'subtotal',
    'total',
    'discountAmount',
    'discount_amount',
    'discountTotal',
    'discount_total',
    'splitBasePrice',
    'split_base_price',
    'splitRoundingAdjustment',
    'split_rounding_adjustment'
]);

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeQuantity = (value) => normalizeStock(toFiniteNumber(value, 0));

const normalizeModifier = (modifier = {}) => ({
    ingredientId: modifier.ingredientId || null,
    name: modifier.name || '',
    quantity: normalizeQuantity(modifier.quantity || 0)
});

const normalizeReservation = (reservation = null) => {
    if (!reservation || reservation.source !== 'table') return null;

    const committedBatches = Array.isArray(reservation.committedBatches)
        ? reservation.committedBatches.map((batch) => ({
            batchId: batch.batchId,
            ingredientId: batch.ingredientId,
            quantity: normalizeQuantity(batch.quantity),
            cost: toFiniteNumber(batch.cost, 0)
        })).sort((left, right) => {
            const leftKey = `${left.batchId}:${left.ingredientId}`;
            const rightKey = `${right.batchId}:${right.ingredientId}`;
            return leftKey.localeCompare(rightKey);
        })
        : [];

    return {
        source: 'table',
        committedQuantity: normalizeQuantity(reservation.committedQuantity || 0),
        committedBatches
    };
};

const normalizeOrderSnapshotItems = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map((item, index) => ({
            lineIndex: index,
            id: item.id || null,
            parentId: item.parentId || null,
            batchId: item.batchId || null,
            saleType: item.saleType || null,
            quantity: normalizeQuantity(item.quantity || 0),
            price: Money.toExactString(item.price || 0),
            notes: item.notes || '',
            selectedModifiers: Array.isArray(item.selectedModifiers)
                ? item.selectedModifiers.map(normalizeModifier).sort((left, right) => {
                    const leftKey = `${left.ingredientId}:${left.name}:${left.quantity}`;
                    const rightKey = `${right.ingredientId}:${right.name}:${right.quantity}`;
                    return leftKey.localeCompare(rightKey);
                })
                : [],
            inventoryReservation: normalizeReservation(item.inventoryReservation)
        }))
);

const buildSnapshotSignature = (items = []) => JSON.stringify(normalizeOrderSnapshotItems(items));

const splitStockByRatio = (totalQuantity, partQuantity, wholeQuantity) => {
    const total = normalizeQuantity(totalQuantity);
    const part = normalizeQuantity(partQuantity);
    const whole = normalizeQuantity(wholeQuantity);

    if (total <= 0 || part <= 0 || whole <= 0) {
        return normalizeQuantity(0);
    }

    const ratioValue = Money.init(total).times(Money.init(part)).div(Money.init(whole));
    return normalizeQuantity(ratioValue.toString());
};

/**
 * Split inventory reservation into N parts based on quantities per ticket.
 * @param {Object} params
 * @param {Object} params.reservation - The parent reservation
 * @param {number[]} params.quantitiesPerTicket - Array of quantities for each ticket
 * @param {number} params.totalQuantity - Total quantity to distribute
 * @returns {Array<Object|null>} Array of reservations (one per ticket), or null if no reservation
 */
const splitInventoryReservationByQuantity = ({ reservation, quantitiesPerTicket, totalQuantity }) => {
    if (!reservation || reservation.source !== 'table') {
        return quantitiesPerTicket.map(() => null);
    }

    const committedQuantity = normalizeQuantity(reservation.committedQuantity || 0);
    const committedBatches = Array.isArray(reservation.committedBatches)
        ? reservation.committedBatches
        : [];

    const total = normalizeQuantity(totalQuantity);

    // Split committedQuantity proportionally
    const splitCommittedQuantities = quantitiesPerTicket.map((qty) =>
        splitStockByRatio(committedQuantity, qty, total)
    );

    // Adjust for rounding errors: ensure sum equals original
    const sumSplit = splitCommittedQuantities.reduce((a, b) => a + b, 0);
    const remainder = normalizeQuantity(committedQuantity - sumSplit);
    if (remainder !== 0 && splitCommittedQuantities.length > 0) {
        // Add remainder to first non-zero ticket
        const firstNonZeroIdx = splitCommittedQuantities.findIndex((q) => q > 0);
        if (firstNonZeroIdx !== -1) {
            splitCommittedQuantities[firstNonZeroIdx] = normalizeQuantity(
                splitCommittedQuantities[firstNonZeroIdx] + remainder
            );
        }
    }

    // Split batches for each ticket
    const splitBatchesPerTicket = quantitiesPerTicket.map(() => []);

    committedBatches.forEach((batchUsage) => {
        const batchTotal = normalizeQuantity(batchUsage.quantity || 0);

        // Split batch across tickets proportionally
        const batchSplits = quantitiesPerTicket.map((qty) =>
            splitStockByRatio(batchTotal, qty, total)
        );

        // Adjust batch remainder
        const sumBatchSplits = batchSplits.reduce((a, b) => a + b, 0);
        const batchRemainder = normalizeQuantity(batchTotal - sumBatchSplits);
        if (batchRemainder !== 0 && batchSplits.length > 0) {
            const firstNonZeroIdx = batchSplits.findIndex((q) => q > 0);
            if (firstNonZeroIdx !== -1) {
                batchSplits[firstNonZeroIdx] = normalizeQuantity(
                    batchSplits[firstNonZeroIdx] + batchRemainder
                );
            }
        }

        // Assign splits to tickets
        batchSplits.forEach((splitQty, ticketIdx) => {
            if (splitQty > 0) {
                splitBatchesPerTicket[ticketIdx].push({
                    batchId: batchUsage.batchId,
                    ingredientId: batchUsage.ingredientId,
                    quantity: splitQty,
                    cost: toFiniteNumber(batchUsage.cost, 0)
                });
            }
        });
    });

    // Build reservation objects for each ticket
    return quantitiesPerTicket.map((_, idx) => ({
        source: 'table',
        committedQuantity: splitCommittedQuantities[idx],
        committedBatches: splitBatchesPerTicket[idx]
    }));
};

const stableHash = (value) => {
    let hash = 2166136261;
    for (const character of String(value || '')) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const buildStableSplitGroupId = ({ parentOrderId, parentSale, splitIntent, tickets, orderSnapshot }) => (
    `spl_${stableHash(JSON.stringify({
        parentOrderId,
        parentVersion: buildParentSnapshotVersion(parentSale),
        splitIntent,
        tickets: (Array.isArray(tickets) ? tickets : []).map((ticket) => ({
            label: toLabel(ticket?.label),
            lines: Array.isArray(ticket?.lines) ? ticket.lines : [],
            paymentData: ticket?.paymentData || {}
        })),
        orderSnapshot: normalizeOrderSnapshotItems(orderSnapshot || [])
    }))}`
);

const toLabel = (value) => String(value || '').trim();

const getTicketDefinitionByLabel = (tickets = [], label) =>
    (tickets || []).find((ticket) => toLabel(ticket?.label) === toLabel(label)) || null;

/**
 * Build allocation map for N tickets dynamically.
 * @param {Array} tickets - Array of ticket definitions
 * @param {number} itemCount - Number of line items
 * @returns {Map<string, Map<number, number>>} Map of label -> (lineIndex -> quantity)
 */
const buildAllocationMap = (tickets = [], itemCount = 0) => {
    const mapByLabel = new Map();

    (tickets || []).forEach((ticket) => {
        const label = toLabel(ticket?.label);
        if (!label) return;

        const lines = Array.isArray(ticket?.lines) ? ticket.lines : [];
        const ticketMap = new Map();

        lines.forEach((line) => {
            const lineIndex = Number(line?.lineIndex);
            const quantity = normalizeQuantity(line?.quantity);

            if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= itemCount) {
                throw new Error(`Línea inválida para ticket ${label}.`);
            }

            if (quantity < 0) {
                throw new Error(`Cantidad negativa en ticket ${label}, línea ${lineIndex}.`);
            }

            const current = ticketMap.get(lineIndex) || 0;
            ticketMap.set(lineIndex, normalizeQuantity(current + quantity));
        });

        mapByLabel.set(label, ticketMap);
    });

    return mapByLabel;
};

/**
 * Build child items from allocation map for N tickets.
 * @param {Object} params
 * @param {Array} params.parentItems - Parent order items
 * @param {Map} params.allocationMap - Map of label -> (lineIndex -> quantity)
 * @param {Array} params.ticketLabels - Array of ticket labels in order
 * @returns {Map<string, Array>} Map of label -> items array
 */
const buildChildItemsFromAllocation = ({ parentItems, allocationMap, ticketLabels }) => {
    const childItems = new Map();
    const childSourceLineIndices = new Map();

    // Initialize empty arrays for each ticket
    ticketLabels.forEach((label) => {
        childItems.set(label, []);
        childSourceLineIndices.set(label, []);
    });

    parentItems.forEach((item, lineIndex) => {
        const totalQuantity = normalizeQuantity(item.quantity || 0);

        // Collect quantities for each ticket
        const quantitiesPerTicket = ticketLabels.map((label) => {
            const ticketMap = allocationMap.get(label);
            return ticketMap ? normalizeQuantity(ticketMap.get(lineIndex) || 0) : 0;
        });

        const distributed = normalizeQuantity(quantitiesPerTicket.reduce((a, b) => a + b, 0));
        if (distributed !== totalQuantity) {
            throw new Error(`La línea ${lineIndex + 1} no está balanceada. Suma: ${distributed}, Esperado: ${totalQuantity}`);
        }

        const reservation = normalizeReservation(item.inventoryReservation);

        // Split reservation for all tickets
        const splitReservations = reservation
            ? splitInventoryReservationByQuantity({
                reservation,
                quantitiesPerTicket,
                totalQuantity
            })
            : quantitiesPerTicket.map(() => null);

        // Assign items to each ticket
        ticketLabels.forEach((label, idx) => {
            const quantity = quantitiesPerTicket[idx];
            if (quantity > 0) {
                const childItemData = Object.fromEntries(
                    Object.entries(item).filter(([key]) => !DERIVED_SPLIT_ITEM_AMOUNT_FIELDS.has(key))
                );
                const childItem = {
                    ...childItemData,
                    selectedModifiers: Array.isArray(item.selectedModifiers) ? [...item.selectedModifiers] : [],
                    quantity,
                    inventoryReservation: splitReservations[idx]
                };
                childItems.get(label).push(childItem);
                childSourceLineIndices.get(label).push(lineIndex);
            }
        });
    });

    return { childItems, childSourceLineIndices };
};

const centsToMoneyString = (cents) => Money.toExactString(Money.fromCents(cents));

const applySplitLineFinancials = (item, financialLine) => {
    const grossSubtotal = centsToMoneyString(financialLine.grossSubtotalCents);
    const lineTotal = centsToMoneyString(financialLine.lineTotalCents);
    const discountAmount = centsToMoneyString(financialLine.discountCents);
    const discount = financialLine.discount;

    return {
        ...item,
        exactTotal: grossSubtotal,
        lineSubtotal: grossSubtotal,
        line_subtotal: grossSubtotal,
        lineTotal,
        line_total: lineTotal,
        discount: discount || null,
        discountAmount,
        discount_amount: discountAmount,
        discountReason: discount?.reason ?? item.discountReason ?? item.discount_reason ?? null,
        discount_reason: discount?.reason ?? item.discount_reason ?? item.discountReason ?? null,
        discountAppliedAt: discount?.appliedAt ?? item.discountAppliedAt ?? item.discount_applied_at ?? null,
        discount_applied_at: discount?.applied_at ?? item.discount_applied_at ?? item.discountAppliedAt ?? null,
        discountAppliedByRole: discount?.appliedByRole ?? item.discountAppliedByRole ?? item.discount_applied_by_role ?? null,
        discount_applied_by_role: discount?.applied_by_role ?? item.discount_applied_by_role ?? item.discountAppliedByRole ?? null,
        discountAppliedByStaffUserId: discount?.appliedByStaffUserId ?? item.discountAppliedByStaffUserId ?? item.discount_applied_by_staff_user_id ?? null,
        discount_applied_by_staff_user_id: discount?.applied_by_staff_user_id ?? item.discount_applied_by_staff_user_id ?? item.discountAppliedByStaffUserId ?? null,
        discountAppliedByDeviceId: discount?.appliedByDeviceId ?? item.discountAppliedByDeviceId ?? item.discount_applied_by_device_id ?? null,
        discount_applied_by_device_id: discount?.applied_by_device_id ?? item.discount_applied_by_device_id ?? item.discountAppliedByDeviceId ?? null
    };
};

const toMoneySafe = (value, fallback = '0') => {
    try {
        return Money.init(value ?? fallback);
    } catch {
        return Money.init(fallback);
    }
};

const normalizeTicketPayment = async ({
    label,
    paymentData,
    ticketTotalCents,
    customerMap,
    customerDebtAccumulator
}) => {
    const paymentMethod = String(paymentData?.paymentMethod || '').trim().toLowerCase();
    if (paymentMethod !== 'efectivo' && paymentMethod !== 'fiado') {
        throw new Error(`Método de pago inválido para ticket ${label}.`);
    }

    const ticketTotal = Money.fromCents(ticketTotalCents);
    const rawPaid = toMoneySafe(paymentData?.amountPaid, '0');

    if (rawPaid.lt(0)) {
        throw new Error(`El monto pagado no puede ser negativo en ticket ${label}.`);
    }

    if (paymentMethod === 'efectivo') {
        if (rawPaid.lt(ticketTotal)) {
            throw new Error(`El ticket ${label} en efectivo requiere monto completo.`);
        }

        const appliedPaid = rawPaid.gt(ticketTotal) ? ticketTotal : rawPaid;

        return {
            paymentMethod,
            customerId: paymentData?.customerId || null,
            amountPaid: Money.toExactString(appliedPaid),
            saldoPendiente: '0',
            sendReceipt: Boolean(paymentData?.sendReceipt)
        };
    }

    const customerId = paymentData?.customerId;
    if (!customerId) {
        throw new Error(`El ticket ${label} a fiado requiere cliente.`);
    }

    if (rawPaid.gt(ticketTotal)) {
        throw new Error(`El abono del ticket ${label} no puede exceder su total.`);
    }

    const saldoPendiente = Money.subtract(ticketTotal, rawPaid);
    const customer = customerMap.get(customerId);
    if (!customer) {
        throw new Error(`Cliente no encontrado para ticket ${label}.`);
    }

    const creditLimit = toMoneySafe(customer.creditLimit, '0');
    const currentDebt = toMoneySafe(customer.debt, '0');
    const pendingAccum = customerDebtAccumulator.get(customerId) || Money.init(0);
    const projectedDebt = Money.add(Money.add(currentDebt, pendingAccum), saldoPendiente);

    if (creditLimit.eq(0) || projectedDebt.gt(creditLimit)) {
        throw new Error(`El ticket ${label} excede el límite de crédito del cliente.`);
    }

    customerDebtAccumulator.set(customerId, Money.add(pendingAccum, saldoPendiente));

    return {
        paymentMethod,
        customerId,
        amountPaid: Money.toExactString(rawPaid),
        saldoPendiente: Money.toExactString(saldoPendiente),
        sendReceipt: Boolean(paymentData?.sendReceipt)
    };
};

const ensureValidSplitRequest = ({ parentSale, splitIntent, tickets }) => {
    if (!parentSale) {
        throw new Error('La orden padre no existe.');
    }

    if (parentSale.status !== OPEN_STATUS) {
        throw new Error('La orden padre ya no está abierta.');
    }

    if (parentSale.orderType !== TABLE_ORDER_TYPE) {
        throw new Error('Solo se pueden dividir órdenes de mesa.');
    }

    if (splitIntent !== RESTAURANT_SPLIT_INTENTS.BY_ITEMS) {
        throw new Error('La división debe asignar productos a cada ticket.');
    }

    if (!Array.isArray(tickets) || tickets.length < 2) {
        throw new Error('Se requieren al menos dos tickets para dividir.');
    }

    // Validate unique labels
    const labels = tickets.map((t) => toLabel(t?.label));
    const uniqueLabels = new Set(labels);
    if (uniqueLabels.size !== labels.length) {
        throw new Error('Los tickets deben tener etiquetas únicas.');
    }

    // Validate each ticket has a label
    if (labels.some((l) => !l)) {
        throw new Error('Todos los tickets deben tener una etiqueta válida.');
    }
};

const getRelevantProducts = async ({ parentItems, loadMultipleData, STORES }) => {
    const productIds = Array.from(new Set(
        parentItems
            .map((item) => item?.parentId || item?.id)
            .filter(Boolean)
    ));

    const products = await loadMultipleData(STORES.MENU, productIds);
    return (products || []).filter(Boolean);
};

const buildParentSnapshotVersion = (parentSale) => parentSale?.updatedAt || parentSale?.timestamp || null;

const buildChildSaleRecord = ({
    label,
    parentSale,
    splitGroupId,
    splitIntent,
    ticketTotalCents,
    ticketAdjustmentCents,
    ticketFinancials,
    normalizedPayment,
    processedItems,
    currentIsoTime,
    saleId = null
}) => ({
    id: saleId || generateID('sal'),
    timestamp: currentIsoTime,
    items: processedItems,
    subtotal: centsToMoneyString(ticketFinancials.grossSubtotalCents),
    grossSubtotal: centsToMoneyString(ticketFinancials.grossSubtotalCents),
    subtotalAfterLineDiscounts: centsToMoneyString(ticketFinancials.subtotalAfterLineDiscountsCents),
    lineDiscountTotal: centsToMoneyString(ticketFinancials.lineDiscountCents),
    saleDiscount: ticketFinancials.saleDiscount,
    sale_discount: ticketFinancials.saleDiscount,
    saleDiscountAmount: centsToMoneyString(ticketFinancials.saleDiscountCents),
    discount: centsToMoneyString(ticketFinancials.discountTotalCents),
    discountTotal: centsToMoneyString(ticketFinancials.discountTotalCents),
    discount_total: centsToMoneyString(ticketFinancials.discountTotalCents),
    total: centsToMoneyString(ticketTotalCents),
    customerId: normalizedPayment.customerId,
    paymentMethod: normalizedPayment.paymentMethod,
    abono: normalizedPayment.amountPaid,
    saldoPendiente: normalizedPayment.saldoPendiente,
    status: SALE_STATUS.CLOSED,
    orderType: parentSale.orderType || TABLE_ORDER_TYPE,
    tableData: parentSale.tableData || null,
    fulfillmentStatus: 'completed',
    postEffectsCompleted: false,
    splitGroupId,
    splitParentId: parentSale.id,
    splitLabel: label,
    splitIntent,
    roundingAdjustment: centsToMoneyString(ticketAdjustmentCents),
    splitRoundingAdjustment: centsToMoneyString(ticketAdjustmentCents),
    sourceMode: 'shadow',
    syncStatus: 'PENDING',
    metadata: {
        source: 'split_bill_child',
        orderType: parentSale.orderType || TABLE_ORDER_TYPE,
        splitGroupId,
        splitParentId: parentSale.id,
        splitLabel: label,
        splitIntent,
        splitRoundingAdjustment: centsToMoneyString(ticketAdjustmentCents),
        saleDiscount: ticketFinancials.saleDiscount,
        discountTotal: centsToMoneyString(ticketFinancials.discountTotalCents),
        lineDiscountTotal: centsToMoneyString(ticketFinancials.lineDiscountCents),
        subtotalAfterLineDiscounts: centsToMoneyString(ticketFinancials.subtotalAfterLineDiscountsCents)
    }
});

const buildSplitPaymentSummary = ({ splitGroupId, parentOrderId, splitIntent, childDefinitions = [], totalChildrenCents, sourceMode = 'shadow/local_applied' }) => {
    const tickets = childDefinitions.map((child) => ({
        label: child.label,
        saleId: child.sale.id,
        paymentMethod: child.paymentData.paymentMethod,
        amountPaid: child.paymentData.amountPaid,
        saldoPendiente: child.paymentData.saldoPendiente,
        customerId: child.paymentData.customerId || null,
        total: child.sale.total
    }));

    const methodSet = new Set(tickets.map((ticket) => ticket.paymentMethod).filter(Boolean));
    const amountPaidTotal = tickets.reduce((acc, ticket) => Money.add(acc, ticket.amountPaid || 0), Money.init(0));
    const balanceDueTotal = tickets.reduce((acc, ticket) => Money.add(acc, ticket.saldoPendiente || 0), Money.init(0));

    return {
        source: 'split_bill',
        splitGroupId,
        parentOrderId,
        splitIntent,
        childSaleIds: childDefinitions.map((child) => child.sale.id),
        tickets,
        methods: Array.from(methodSet),
        amountPaidTotal: Money.toExactString(amountPaidTotal),
        balanceDueTotal: Money.toExactString(balanceDueTotal),
        total: centsToMoneyString(totalChildrenCents),
        sourceMode
    };
};

export const splitOpenTableOrderCore = async ({
    parentOrderId,
    orderSnapshot,
    splitIntent: rawSplitIntent,
    mode: legacyMode,
    tickets,
    features,
    companyName,
    cloudSpecialFlows = false,
    licenseDetails = null,
    cashSessionId = null
} = {}, {
    loadData,
    loadMultipleData,
    STORES,
    executeSplitOpenTableOrderTransactionSafe,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    Logger,
    restaurantOrdersRepository: restaurantOrdersRepositoryOverride = restaurantOrdersRepository
} = {}) => {
    Logger.time('Service:SplitOpenTableOrder');

    try {
        const splitIntentResolution = normalizeRestaurantSplitIntent({
            splitIntent: rawSplitIntent,
            mode: legacyMode
        });
        if (splitIntentResolution.status !== 'ready') {
            const message = splitIntentResolution.intent === RESTAURANT_SPLIT_INTENTS.EQUAL_PAYMENT
                ? 'La división del total en partes iguales no está disponible para cobro. Usa “Cada quien paga lo suyo”; los productos no se modificarán para igualar importes.'
                : 'La estrategia de división de la cuenta no es válida. Vuelve a abrir la división y asigna los productos a cada ticket.';
            return {
                success: false,
                errorType: splitIntentResolution.code,
                code: splitIntentResolution.code,
                splitIntent: splitIntentResolution.intent,
                message
            };
        }
        const splitIntent = splitIntentResolution.intent;

        if (!parentOrderId) {
            throw new Error('Se requiere la orden padre para dividir.');
        }

        const parentSale = await loadData(STORES.SALES, parentOrderId);
        ensureValidSplitRequest({ parentSale, splitIntent, tickets });

        const parentItems = (Array.isArray(parentSale.items) ? parentSale.items : [])
            .filter((item) => normalizeQuantity(item?.quantity) > 0);

        if (parentItems.length === 0) {
            throw new Error('La orden padre no contiene productos válidos para dividir.');
        }

        const snapshotSignature = buildSnapshotSignature(orderSnapshot || []);
        const parentSignature = buildSnapshotSignature(parentItems);
        if (snapshotSignature !== parentSignature) {
            return {
                success: false,
                errorType: 'DIRTY_ORDER',
                message: 'La mesa cambió y tiene ajustes sin guardar. Guarda/Envía a Cocina antes de dividir.'
            };
        }

        // Extract ticket labels in order
        const ticketLabels = tickets.map((t) => toLabel(t.label));

        const allocationMap = buildAllocationMap(tickets, parentItems.length);
        const { childItems, childSourceLineIndices } = buildChildItemsFromAllocation({
            parentItems,
            allocationMap,
            ticketLabels
        });

        // Validate each ticket has at least one item
        for (const label of ticketLabels) {
            if (childItems.get(label).length === 0) {
                throw new Error(`El ticket ${label} debe contener al menos un producto.`);
            }
        }

        const allProducts = await getRelevantProducts({ parentItems, loadMultipleData, STORES });

        const parentSaleDiscount = parentSale.saleDiscount
            || parentSale.sale_discount
            || parentSale.metadata?.discount
            || (parentSale.discount && typeof parentSale.discount === 'object' ? parentSale.discount : null);
        const splitFinancials = calculateByItemsTicketFinancials({
            items: parentItems,
            saleDiscount: parentSaleDiscount,
            tickets: ticketLabels.map((label) => ({
                label,
                lines: Array.from(allocationMap.get(label) || new Map(), ([lineIndex, quantity]) => ({ lineIndex, quantity }))
            })),
            parentTotal: parentSale.total
        });
        if (!splitFinancials.valid) {
            return {
                success: false,
                errorType: 'SPLIT_ROUNDING_INVALID',
                code: 'SPLIT_ROUNDING_INVALID',
                splitIntent,
                message: 'La diferencia entre los productos, descuentos y total de la cuenta supera el redondeo permitido. No se alteraron precios ni descuentos; revisa la cuenta antes de cobrar.'
            };
        }
        const parentTotalCents = splitFinancials.parentTotalCents;
        const ticketFinancialsByLabel = new Map(
            splitFinancials.tickets.map((financials) => [toLabel(financials.label), financials])
        );

        ticketLabels.forEach((label) => {
            const ticketFinancials = ticketFinancialsByLabel.get(label);
            const financialByLineIndex = new Map(ticketFinancials.lines.map((line) => [line.lineIndex, line]));
            const sourceLineIndices = childSourceLineIndices.get(label) || [];
            childItems.set(label, childItems.get(label).map((item, childIndex) => {
                const lineIndex = sourceLineIndices[childIndex];
                const lineFinancials = financialByLineIndex.get(lineIndex);
                if (!lineFinancials) throw new Error(`No se pudo calcular el descuento de la línea ${lineIndex + 1}.`);
                return applySplitLineFinancials(item, lineFinancials);
            }));
        });

        const childDefinitions = [];
        const customerDebtAccumulator = new Map();
        const splitGroupId = buildStableSplitGroupId({
            parentOrderId,
            parentSale,
            splitIntent,
            tickets,
            orderSnapshot
        });
        const currentIsoTime = parentSale.updatedAt || parentSale.timestamp || new Date().toISOString();

        // Precargar todos los clientes que usarán método de pago 'fiado' en paralelo
        const customerIdsToLoad = new Set();
        ticketLabels.forEach((label) => {
            const ticketDefinition = getTicketDefinitionByLabel(tickets, label);
            const method = String(ticketDefinition?.paymentData?.paymentMethod || '').toLowerCase();
            const cid = ticketDefinition?.paymentData?.customerId;
            if (method === 'fiado' && cid) customerIdsToLoad.add(cid);
        });

        const customerMap = new Map();
        if (customerIdsToLoad.size > 0) {
            const loadedCustomers = await loadMultipleData(STORES.CUSTOMERS, Array.from(customerIdsToLoad));
            loadedCustomers.filter(Boolean).forEach(c => customerMap.set(c.id, c));
        }

        // Process each ticket dynamically
        for (let i = 0; i < ticketLabels.length; i++) {
            const label = ticketLabels[i];
            const ticketDefinition = getTicketDefinitionByLabel(tickets, label);
            const ticketItems = childItems.get(label);
            const ticketFinancials = ticketFinancialsByLabel.get(label);
            const ticketAdjustmentCents = ticketFinancials.roundingAdjustmentCents;
            const ticketTotalCents = ticketFinancials.totalCents;

            if (ticketTotalCents < 0) {
                throw new Error(`El total del ticket ${label} no puede ser negativo.`);
            }

            if (ticketAdjustmentCents !== 0 && ticketItems.length > 0) {
                const itemToAdjust = ticketItems.find((item) => (
                    roundSplitAmountToCents(Money.multiply(item.price || 0, item.quantity || 0)) > 0
                ));
                if (!itemToAdjust) {
                    return {
                        success: false,
                        errorType: 'SPLIT_ROUNDING_INVALID',
                        code: 'SPLIT_ROUNDING_INVALID',
                        splitIntent,
                        message: 'No se puede aplicar el redondeo sin modificar el importe comercial de un producto.'
                    };
                }
                itemToAdjust.splitRoundingAdjustment = centsToMoneyString(ticketAdjustmentCents);
            }

            const normalizedPayment = await normalizeTicketPayment({
                label,
                paymentData: ticketDefinition?.paymentData || {},
                ticketTotalCents,
                customerMap,
                customerDebtAccumulator
            });

            const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
                itemsToProcess: ticketItems,
                allProducts,
                batchesMap: new Map(),
                roundCurrency
            });

            const saleRecord = buildChildSaleRecord({
                label,
                parentSale,
                splitGroupId,
                splitIntent,
                ticketTotalCents,
                ticketAdjustmentCents,
                ticketFinancials,
                normalizedPayment,
                processedItems,
                currentIsoTime,
                saleId: `sale_split_${stableHash(`${splitGroupId}:${label}`)}`
            });

            childDefinitions.push({
                label,
                sale: saleRecord,
                deductions: batchesToDeduct,
                processedItems,
                paymentData: normalizedPayment
            });
        }

        const totalChildrenCents = childDefinitions.reduce(
            (acc, child) => acc + Money.toCents(child.sale.total || 0),
            0
        );

        if (totalChildrenCents !== parentTotalCents) {
            throw new Error('La suma de tickets no cuadra con el total de la orden padre.');
        }

        if (cloudSpecialFlows) {
            const cloudPreflight = await preflightCloudRestaurantOrderSplit({
                licenseKey: getLicenseKeyFromDetails(licenseDetails),
                parentOrderId,
                parentSale,
                repository: restaurantOrdersRepositoryOverride
            });
            if (!cloudPreflight.success) return cloudPreflight;

            const cloudResult = await salesCloudCashierService.processCloudSplitTableSale({
                parentOrderId,
                parentExpectedVersion: cloudPreflight.parentExpectedVersion,
                splitGroupId,
                childDefinitions,
                total: centsToMoneyString(totalChildrenCents),
                licenseDetails,
                cashSessionId
            });

            if (!cloudResult?.success) return cloudResult;

            await Promise.all(childDefinitions.map(async (child, index) => {
                const projectedSale = cloudResult.childSales?.[index] || child.sale;
                await runPostSaleEffectsForCloudCommittedSale({
                    sale: projectedSale,
                    processedItems: child.processedItems,
                    paymentData: child.paymentData,
                    total: child.sale.total,
                    companyName,
                    features,
                    loadData,
                    saveData: async () => true,
                    STORES,
                    useStatsStore,
                    roundCurrency,
                    sendReceiptWhatsApp,
                    Logger
                });
            }));

            const paymentSummary = buildSplitPaymentSummary({
                splitGroupId,
                parentOrderId,
                splitIntent,
                childDefinitions,
                totalChildrenCents,
                sourceMode: 'cloud_committed'
            });

            return {
                ...cloudResult,
                paymentSummary,
                splitIntent,
                sourceMode: 'cloud_committed',
                cloudCommitted: true
            };
        }

        const transactionResult = await executeSplitOpenTableOrderTransactionSafe({
            parentOrderId,
            parentExpectedVersion: buildParentSnapshotVersion(parentSale),
            splitGroupId,
            childPayloads: childDefinitions.map((child) => ({
                sale: child.sale,
                deductions: child.deductions
            }))
        });

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return {
                    success: false,
                    errorType: 'RACE_CONDITION',
                    message: 'La mesa cambió mientras intentabas dividir/cobrar. Intenta de nuevo.'
                };
            }

            return {
                success: false,
                message: transactionResult?.message || 'No se pudo dividir la cuenta.'
            };
        }

        const postEffectsBySaleId = new Map();

        // Ejecución en paralelo de los efectos post-venta. La venta local ya está segura.
        await Promise.all(childDefinitions.map(async (child) => {
            try {
                await runPostSaleEffects({
                    sale: child.sale,
                    processedItems: child.processedItems,
                    paymentData: child.paymentData,
                    total: child.sale.total,
                    companyName,
                    features,
                    loadData,
                    saveData: async () => true,
                    STORES,
                    useStatsStore,
                    roundCurrency,
                    sendReceiptWhatsApp,
                    Logger
                });
                postEffectsBySaleId.set(child.sale.id, { postEffectsFailed: false, postEffectsError: null });
            } catch (postError) {
                const postEffectsError = {
                    message: postError.message || 'Error desconocido en efectos posteriores',
                    stack: postError.stack || null,
                    timestamp: new Date().toISOString()
                };
                postEffectsBySaleId.set(child.sale.id, { postEffectsFailed: true, postEffectsError });
                Logger.warn('Post-Sale Effects Failed in Split Bill (Non-Blocking):', postEffectsError);
            }
        }));

        const paymentSummary = buildSplitPaymentSummary({
            splitGroupId,
            parentOrderId,
            splitIntent,
            childDefinitions,
            totalChildrenCents
        });

        // REST.SPLIT.1 — Shadow sync post-commit. No bloquea ni revierte el split local.
        childDefinitions.forEach((child) => {
            const postEffects = postEffectsBySaleId.get(child.sale.id) || {};
            salesCloudShadowService.syncSaleShadowAfterLocalCommit(child.sale, {
                reason: 'split_bill_child',
                source: 'split_bill_child',
                splitGroupId,
                splitParentId: parentOrderId,
                splitLabel: child.label,
                paymentData: child.paymentData,
                processedItems: child.processedItems,
                paymentSummary,
                postEffectsFailed: Boolean(postEffects.postEffectsFailed),
                postEffectsError: postEffects.postEffectsError || null
            }).catch((cloudSyncError) => {
                Logger.warn('Sales Cloud Shadow Sync Failed for split child (Non-Blocking):', cloudSyncError);
            });
        });

        return {
            success: true,
            splitGroupId,
            parentOrderId,
            splitIntent,
            childSaleIds: childDefinitions.map((child) => child.sale.id),
            childSales: childDefinitions.map((child) => child.sale),
            total: centsToMoneyString(totalChildrenCents),
            paymentSummary
        };
    } catch (error) {
        Logger.error('SplitOrder Service Error:', error);
        return {
            success: false,
            message: error?.message || 'No se pudo dividir/cobrar la cuenta.'
        };
    } finally {
        Logger.timeEnd('Service:SplitOpenTableOrder');
    }
};
