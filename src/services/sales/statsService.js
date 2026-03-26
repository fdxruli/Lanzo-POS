import {
    loadData,
    STORES,
    initDB
} from '../database';
import { roundCurrency } from '../utils';
import { isFinanciallyClosedSale } from './financialStats';

export const updateDailyStats = async (sale) => {
    if (!isFinanciallyClosedSale(sale)) return;

    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];
    const db = await initDB();

    let saleProfit = 0;
    let validRevenue = 0;
    let hasMissingCosts = false;

    sale.items.forEach(item => {
        const itemRevenue = roundCurrency(item.price * item.quantity);
        // Validar costo vacío o cero
        if (item.cost === null || item.cost === undefined || item.cost === '' || Number(item.cost) === 0) {
            hasMissingCosts = true;
        } else {
            validRevenue += itemRevenue;
            const profitUnitario = roundCurrency(item.price - item.cost);
            saleProfit += roundCurrency(profitUnitario * item.quantity);
        }
    });

    const itemsCount = sale.items.reduce((acc, i) => acc + i.quantity, 0);

    await db.transaction('rw', STORES.DAILY_STATS, async () => {
        const existing = await db.table(STORES.DAILY_STATS).get(dateKey);

        if (existing) {
            await db.table(STORES.DAILY_STATS).where('id').equals(dateKey).modify(stat => {
                stat.revenue = roundCurrency(stat.revenue + sale.total);
                stat.profit = roundCurrency(stat.profit + saleProfit);
                stat.validRevenue = roundCurrency((stat.validRevenue || 0) + validRevenue);
                stat.orders += 1;
                stat.itemsSold += itemsCount;
                if (hasMissingCosts) stat.hasMissingCosts = true;
            });
        } else {
            await db.table(STORES.DAILY_STATS).add({
                id: dateKey,
                date: dateKey,
                revenue: sale.total,
                validRevenue: validRevenue,
                profit: saleProfit,
                orders: 1,
                itemsSold: itemsCount,
                hasMissingCosts: hasMissingCosts
            });
        }
    });
};

export const getFastDashboardStats = async () => {
    const allDays = await loadData(STORES.DAILY_STATS);

    return allDays.reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + day.revenue,
        totalNetProfit: acc.totalNetProfit + day.profit,
        totalValidRevenue: acc.totalValidRevenue + (day.validRevenue !== undefined ? day.validRevenue : day.revenue), // Fallback
        totalOrders: acc.totalOrders + day.orders,
        totalItemsSold: acc.totalItemsSold + day.itemsSold,
        hasMissingCosts: acc.hasMissingCosts || day.hasMissingCosts
    }), { totalRevenue: 0, totalNetProfit: 0, totalValidRevenue: 0, totalOrders: 0, totalItemsSold: 0, hasMissingCosts: false });
};