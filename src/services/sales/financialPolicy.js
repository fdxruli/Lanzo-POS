import { Money } from '../../utils/moneyMath';

const normalizeFinancialNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;

    try {
        return Money.toNumber(value);
    } catch {
        const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : fallback;
    }
};

export const SALE_STATUS = Object.freeze({
    OPEN: 'open',
    CLOSED: 'closed',
    CANCELLED: 'cancelled'
});

export const PAYMENT_METHODS = Object.freeze({
    CASH: 'efectivo',
    CREDIT: 'fiado',
    CARD: 'tarjeta',
    TRANSFER: 'transferencia'
});

const isClosedSale = (sale = {}) => sale.status === SALE_STATUS.CLOSED || sale.status === 'completed';
const isCancelledSale = (sale = {}) => sale.status === SALE_STATUS.CANCELLED;

const getLineSubtotal = (item = {}) => {
    if (item.exactTotal !== undefined) return normalizeFinancialNumber(item.exactTotal);
    if (item.lineSubtotal !== undefined) return normalizeFinancialNumber(item.lineSubtotal);
    if (item.subtotal !== undefined) return normalizeFinancialNumber(item.subtotal);
    return normalizeFinancialNumber(item.price) * normalizeFinancialNumber(item.quantity);
};

const getLineDiscount = (item = {}) => {
    const discount = item.discount && typeof item.discount === 'object' ? item.discount.amount : item.discount;
    return normalizeFinancialNumber(item.discountAmount ?? item.discount_amount ?? discount, 0);
};

const getLineRevenue = (item = {}) => {
    if (item.lineTotal !== undefined) return normalizeFinancialNumber(item.lineTotal);
    if (item.line_total !== undefined) return normalizeFinancialNumber(item.line_total);
    return Math.max(getLineSubtotal(item) - getLineDiscount(item), 0);
};

const getLineCost = (item = {}) => {
    const quantity = normalizeFinancialNumber(item.quantity, 0);
    const unitCost = normalizeFinancialNumber(item.cost ?? item.unitCost, 0);
    return Money.toNumber(Money.multiply(unitCost, quantity));
};

const getSaleDiscount = (sale = {}) => normalizeFinancialNumber(
    sale.discountTotal ?? sale.discount_total ?? sale.discount,
    0
);

export const summarizeFinancialSales = (sales = []) => {
    return sales.reduce((summary, sale) => {
        if (!isClosedSale(sale) || isCancelledSale(sale)) {
            return summary;
        }

        const items = Array.isArray(sale.items) ? sale.items : [];
        const grossRevenue = normalizeFinancialNumber(
            sale.subtotal,
            items.reduce((sum, item) => Money.toNumber(Money.add(sum, getLineSubtotal(item))), 0)
        );
        const lineRevenue = items.reduce((sum, item) => Money.toNumber(Money.add(sum, getLineRevenue(item))), 0);
        const totalRevenue = normalizeFinancialNumber(sale.total, lineRevenue);
        const totalCost = items.reduce((sum, item) => Money.toNumber(Money.add(sum, getLineCost(item))), 0);
        const discountTotal = getSaleDiscount(sale);

        return {
            totalSales: summary.totalSales + 1,
            totalRevenue: Money.toNumber(Money.add(summary.totalRevenue, totalRevenue)),
            grossRevenue: Money.toNumber(Money.add(summary.grossRevenue, grossRevenue)),
            totalDiscounts: Money.toNumber(Money.add(summary.totalDiscounts, discountTotal)),
            totalCost: Money.toNumber(Money.add(summary.totalCost, totalCost)),
            grossProfit: Money.toNumber(Money.add(summary.grossProfit, Money.subtract(totalRevenue, totalCost)))
        };
    }, {
        totalSales: 0,
        totalRevenue: 0,
        grossRevenue: 0,
        totalDiscounts: 0,
        totalCost: 0,
        grossProfit: 0
    });
};

export default {
    SALE_STATUS,
    PAYMENT_METHODS,
    summarizeFinancialSales
};
