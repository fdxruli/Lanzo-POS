import { generateID } from '../utils';
import { Money } from '../../utils/moneyMath';
import { normalizeStock } from '../db/utils';
import { SALE_STATUS } from './financialStats';
import { buildProcessedItemsAndDeductions } from './inventoryFlow';
import { runPostSaleEffects } from './postSaleEffects';

const TABLE_ORDER_TYPE = 'table';
const OPEN_STATUS = SALE_STATUS.OPEN;

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

const splitInventoryReservationByQuantity = ({ reservation, quantityA, totalQuantity }) => {
    if (!reservation || reservation.source !== 'table') {
        return { reservationA: null, reservationB: null };
    }

    const committedQuantity = normalizeQuantity(reservation.committedQuantity || 0);
    const committedBatches = Array.isArray(reservation.committedBatches)
        ? reservation.committedBatches
        : [];

    const committedQuantityA = splitStockByRatio(committedQuantity, quantityA, totalQuantity);
    const committedQuantityB = normalizeQuantity(committedQuantity - committedQuantityA);

    const batchesA = [];
    const batchesB = [];

    committedBatches.forEach((batchUsage) => {
        const batchTotal = normalizeQuantity(batchUsage.quantity || 0);
        const batchA = splitStockByRatio(batchTotal, quantityA, totalQuantity);
        const batchB = normalizeQuantity(batchTotal - batchA);

        if (batchA > 0) {
            batchesA.push({
                batchId: batchUsage.batchId,
                ingredientId: batchUsage.ingredientId,
                quantity: batchA,
                cost: toFiniteNumber(batchUsage.cost, 0)
            });
        }

        if (batchB > 0) {
            batchesB.push({
                batchId: batchUsage.batchId,
                ingredientId: batchUsage.ingredientId,
                quantity: batchB,
                cost: toFiniteNumber(batchUsage.cost, 0)
            });
        }
    });

    return {
        reservationA: {
            source: 'table',
            committedQuantity: committedQuantityA,
            committedBatches: batchesA
        },
        reservationB: {
            source: 'table',
            committedQuantity: committedQuantityB,
            committedBatches: batchesB
        }
    };
};

const toLabel = (value) => String(value || '').trim().toUpperCase();

const getTicketDefinitionByLabel = (tickets = [], label) =>
    (tickets || []).find((ticket) => toLabel(ticket?.label) === label) || null;

const buildAllocationMap = (tickets = [], itemCount = 0) => {
    const mapByLabel = {
        A: new Map(),
        B: new Map()
    };

    (tickets || []).forEach((ticket) => {
        const label = toLabel(ticket?.label);
        if (!mapByLabel[label]) return;

        const lines = Array.isArray(ticket?.lines) ? ticket.lines : [];

        lines.forEach((line) => {
            const lineIndex = Number(line?.lineIndex);
            const quantity = normalizeQuantity(line?.quantity);

            if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= itemCount) {
                throw new Error(`Línea inválida para ticket ${label}.`);
            }

            if (quantity < 0) {
                throw new Error(`Cantidad negativa en ticket ${label}, línea ${lineIndex}.`);
            }

            const current = mapByLabel[label].get(lineIndex) || 0;
            mapByLabel[label].set(lineIndex, normalizeQuantity(current + quantity));
        });
    });

    return mapByLabel;
};

const buildChildItemsFromAllocation = ({ parentItems, allocationMap }) => {
    const childItems = {
        A: [],
        B: []
    };

    parentItems.forEach((item, lineIndex) => {
        const totalQuantity = normalizeQuantity(item.quantity || 0);
        const quantityA = normalizeQuantity(allocationMap.A.get(lineIndex) || 0);
        const quantityB = normalizeQuantity(allocationMap.B.get(lineIndex) || 0);

        const distributed = normalizeQuantity(quantityA + quantityB);
        if (distributed !== totalQuantity) {
            throw new Error(`La línea ${lineIndex + 1} no está balanceada entre A y B.`);
        }

        const reservation = normalizeReservation(item.inventoryReservation);
        if (!reservation) {
            throw new Error(`La línea ${lineIndex + 1} no tiene reserva comprometida válida.`);
        }

        const { reservationA, reservationB } = splitInventoryReservationByQuantity({
            reservation,
            quantityA,
            totalQuantity
        });

        if (quantityA > 0) {
            childItems.A.push({
                ...structuredClone(item),
                quantity: quantityA,
                inventoryReservation: reservationA
            });
        }

        if (quantityB > 0) {
            childItems.B.push({
                ...structuredClone(item),
                quantity: quantityB,
                inventoryReservation: reservationB
            });
        }
    });

    return childItems;
};

const calculateItemsTotalCents = (items = []) => {
    const totalBig = (items || []).reduce((acc, item) => {
        const lineTotal = Money.multiply(item.price || 0, item.quantity || 0);
        return Money.add(acc, lineTotal);
    }, Money.init(0));

    return Money.toCents(totalBig);
};

const centsToMoneyString = (cents) => Money.toExactString(Money.fromCents(cents));

const buildTicketAdjustments = ({ mode, parentTotalCents, baseA, baseB }) => {
    if (mode === 'equal') {
        const targetA = Math.ceil(parentTotalCents / 2);
        const targetB = Math.floor(parentTotalCents / 2);
        return {
            A: targetA - baseA,
            B: targetB - baseB
        };
    }

    const remainder = parentTotalCents - (baseA + baseB);
    return {
        A: remainder,
        B: 0
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
    loadData,
    STORES,
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
    const customer = await loadData(STORES.CUSTOMERS, customerId);
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

const ensureValidSplitRequest = ({ parentSale, mode, tickets }) => {
    if (!parentSale) {
        throw new Error('La orden padre no existe.');
    }

    if (parentSale.status !== OPEN_STATUS) {
        throw new Error('La orden padre ya no está abierta.');
    }

    if (parentSale.orderType !== TABLE_ORDER_TYPE) {
        throw new Error('Solo se pueden dividir órdenes de mesa.');
    }

    if (mode !== 'manual' && mode !== 'equal') {
        throw new Error('Modo de división inválido.');
    }

    if (!Array.isArray(tickets) || tickets.length !== 2) {
        throw new Error('Se requieren exactamente dos tickets (A y B).');
    }

    const ticketLabels = new Set(tickets.map((ticket) => toLabel(ticket?.label)));
    if (!(ticketLabels.has('A') && ticketLabels.has('B'))) {
        throw new Error('Los tickets deben etiquetarse como A y B.');
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
    ticketTotalCents,
    ticketAdjustmentCents,
    normalizedPayment,
    processedItems,
    currentIsoTime
}) => ({
    id: generateID('sal'),
    timestamp: currentIsoTime,
    items: processedItems,
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
    roundingAdjustment: centsToMoneyString(ticketAdjustmentCents)
});

export const splitOpenTableOrderCore = async ({
    parentOrderId,
    orderSnapshot,
    mode,
    tickets,
    features,
    companyName
}, {
    loadData,
    loadMultipleData,
    STORES,
    executeSplitOpenTableOrderTransactionSafe,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    Logger
}) => {
    Logger.time('Service:SplitOpenTableOrder');

    try {
        if (!parentOrderId) {
            throw new Error('Se requiere la orden padre para dividir.');
        }

        const parentSale = await loadData(STORES.SALES, parentOrderId);
        ensureValidSplitRequest({ parentSale, mode, tickets });

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

        const allocationMap = buildAllocationMap(tickets, parentItems.length);
        const childItems = buildChildItemsFromAllocation({
            parentItems,
            allocationMap
        });

        if (childItems.A.length === 0 || childItems.B.length === 0) {
            throw new Error('Cada ticket debe contener al menos un producto.');
        }

        const allProducts = await getRelevantProducts({ parentItems, loadMultipleData, STORES });

        const baseCentsByLabel = {
            A: calculateItemsTotalCents(childItems.A),
            B: calculateItemsTotalCents(childItems.B)
        };

        const parentTotalCents = Money.toCents(parentSale.total || 0);
        const adjustments = buildTicketAdjustments({
            mode,
            parentTotalCents,
            baseA: baseCentsByLabel.A,
            baseB: baseCentsByLabel.B
        });

        const childDefinitions = [];
        const customerDebtAccumulator = new Map();
        const splitGroupId = generateID('spl');
        const currentIsoTime = new Date().toISOString();

        for (const label of ['A', 'B']) {
            const ticketDefinition = getTicketDefinitionByLabel(tickets, label);
            const ticketItems = childItems[label];
            const baseTicketCents = baseCentsByLabel[label];
            const ticketAdjustmentCents = adjustments[label];
            const ticketTotalCents = baseTicketCents + ticketAdjustmentCents;

            if (ticketTotalCents < 0) {
                throw new Error(`El total del ticket ${label} no puede ser negativo.`);
            }

            const normalizedPayment = await normalizeTicketPayment({
                label,
                paymentData: ticketDefinition?.paymentData || {},
                ticketTotalCents,
                loadData,
                STORES,
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
                ticketTotalCents,
                ticketAdjustmentCents,
                normalizedPayment,
                processedItems,
                currentIsoTime
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

        for (const child of childDefinitions) {
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
        }

        Logger.timeEnd('Service:SplitOpenTableOrder');

        return {
            success: true,
            splitGroupId,
            parentOrderId,
            childSaleIds: childDefinitions.map((child) => child.sale.id)
        };
    } catch (error) {
        Logger.error('SplitOrder Service Error:', error);
        return {
            success: false,
            message: error?.message || 'No se pudo dividir/cobrar la cuenta.'
        };
    }
};

