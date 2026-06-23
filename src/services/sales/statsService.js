import {
    loadData,
    STORES,
    initDB
} from '../database';
import { roundCurrency } from '../utils';
import { isFinanciallyClosedSale } from './financialStats';
import { getFinancialQuality, getLineRevenue, isMissingUnitCost, normalizeFinancialNumber } from './financialPolicy';

export const updateDailyStats = async (sale) => {
    if (!isFinanciallyClosedSale(sale)) return;

    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];
    const db = await initDB();
    const saleTotal = normalizeFinancialNumber(sale.total || 0);

    let saleProfit = 0;
    let validRevenue = 0;
    let unconfirmedRevenue = 0;
    let unreliableProfitDueToMissingCosts = 0;
    let hasMissingCosts = false;

    sale.items.forEach(item => {
        const itemRevenue = Number(getLineRevenue(item).round(2).toString());

        if (isMissingUnitCost(item.cost)) {
            hasMissingCosts = true;
            unconfirmedRevenue += itemRevenue;
            unreliableProfitDueToMissingCosts += itemRevenue;
            return;
        }

        validRevenue += itemRevenue;
        const itemCost = roundCurrency(normalizeFinancialNumber(item.cost) * normalizeFinancialNumber(item.quantity || 0));
        const profitUnitario = roundCurrency(itemRevenue - itemCost);
        saleProfit += profitUnitario;
    });

    const itemsCount = sale.items.reduce((acc, i) => acc + i.quantity, 0);

    await db.transaction('rw', STORES.DAILY_STATS, async () => {
        const existing = await db.table(STORES.DAILY_STATS).get(dateKey);

        if (existing) {
            await db.table(STORES.DAILY_STATS).where('id').equals(dateKey).modify(stat => {
                stat.revenue = roundCurrency(stat.revenue + saleTotal);
                stat.profit = roundCurrency(stat.profit + saleProfit);
                stat.validRevenue = roundCurrency((stat.validRevenue || 0) + validRevenue);
                stat.unconfirmedRevenue = roundCurrency((stat.unconfirmedRevenue || 0) + unconfirmedRevenue);
                stat.unreliableProfitDueToMissingCosts = roundCurrency(
                    (stat.unreliableProfitDueToMissingCosts || 0) + unreliableProfitDueToMissingCosts
                );
                stat.orders += 1;
                stat.itemsSold += itemsCount;
                if (hasMissingCosts) stat.hasMissingCosts = true;
                Object.assign(stat, getFinancialQuality(stat.validRevenue || 0, stat.unconfirmedRevenue || 0));
            });
        } else {
            await db.table(STORES.DAILY_STATS).add({
                id: dateKey,
                date: dateKey,
                revenue: saleTotal,
                validRevenue,
                unconfirmedRevenue,
                unreliableProfitDueToMissingCosts,
                profit: saleProfit,
                orders: 1,
                itemsSold: itemsCount,
                hasMissingCosts,
                ...getFinancialQuality(validRevenue, unconfirmedRevenue)
            });
        }
    });
};

export const getFastDashboardStats = async () => {
    const allDays = await loadData(STORES.DAILY_STATS);

    return allDays.reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + day.revenue,
        totalNetProfit: acc.totalNetProfit + day.profit,
        totalValidRevenue: acc.totalValidRevenue + (day.validRevenue !== undefined ? day.validRevenue : day.revenue),
        totalUnconfirmedRevenue: acc.totalUnconfirmedRevenue + (day.unconfirmedRevenue || 0),
        totalUnreliableProfitDueToMissingCosts:
            acc.totalUnreliableProfitDueToMissingCosts + (day.unreliableProfitDueToMissingCosts || 0),
        totalOrders: acc.totalOrders + day.orders,
        totalItemsSold: acc.totalItemsSold + day.itemsSold,
        hasMissingCosts: acc.hasMissingCosts || day.hasMissingCosts
    }), {
        totalRevenue: 0,
        totalNetProfit: 0,
        totalValidRevenue: 0,
        totalUnconfirmedRevenue: 0,
        totalUnreliableProfitDueToMissingCosts: 0,
        totalOrders: 0,
        totalItemsSold: 0,
        hasMissingCosts: false
    });
};
