import {
    loadData,
    saveData,
    STORES
} from '../database';
import { roundCurrency } from '../utils';

export const updateDailyStats = async (sale) => {
    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];
    const db = getDbInstance(); // Asumo que tienes acceso a la instancia de Dexie

    // Calculamos los deltas
    let saleProfit = 0;
    sale.items.forEach(item => {
        const cost = item.cost || 0;
        const profitUnitario = roundCurrency(item.price - cost);
        saleProfit += roundCurrency(profitUnitario * item.quantity);
    });

    const itemsCount = sale.items.reduce((acc, i) => acc + i.quantity, 0);

    // OPERACIÓN ATÓMICA: Si existe modifica, si no añade.
    await db.transaction('rw', STORES.DAILY_STATS, async () => {
        const existing = await db.table(STORES.DAILY_STATS).get(dateKey);

        if (existing) {
            // Modificación atómica dentro de transacción RW
            await db.table(STORES.DAILY_STATS).where('id').equals(dateKey).modify(stat => {
                stat.revenue = roundCurrency(stat.revenue + sale.total);
                stat.profit = roundCurrency(stat.profit + saleProfit);
                stat.orders += 1;
                stat.itemsSold += itemsCount;
            });
        } else {
            // Creación inicial
            await db.table(STORES.DAILY_STATS).add({
                id: dateKey,
                date: dateKey,
                revenue: sale.total,
                profit: saleProfit,
                orders: 1,
                itemsSold: itemsCount
            });
        }
    });
};

export const getFastDashboardStats = async () => {
    const allDays = await loadData(STORES.DAILY_STATS);

    return allDays.reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + day.revenue,
        totalNetProfit: acc.totalNetProfit + day.profit,
        totalOrders: acc.totalOrders + day.orders,
        totalItemsSold: acc.totalItemsSold + day.itemsSold
    }), { totalRevenue: 0, totalNetProfit: 0, totalOrders: 0, totalItemsSold: 0 });
};
