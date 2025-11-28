import { loadData, saveData, STORES } from './database';

export const updateDailyStats = async (sale) => {
    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0]; // "2023-10-27"

    // 1. Obtener registro del día (o crear nuevo)
    let dailyStat = await loadData(STORES.DAILY_STATS, dateKey);

    if (!dailyStat) {
        dailyStat = {
            date: dateKey,
            revenue: 0,
            profit: 0,
            orders: 0,
            itemsSold: 0
        };
    }

    // 2. Calcular utilidad de esta venta específica
    let saleProfit = 0;
    sale.items.forEach(item => {
        const cost = item.cost || 0;
        saleProfit += (item.price - cost) * item.quantity;
    });

    // 3. Actualizar acumuladores (Incremental)
    dailyStat.revenue += sale.total;
    dailyStat.profit += saleProfit;
    dailyStat.orders += 1;
    dailyStat.itemsSold += sale.items.reduce((acc, i) => acc + i.quantity, 0);

    // 4. Guardar
    await saveData(STORES.DAILY_STATS, dailyStat);
};

export const getFastDashboardStats = async () => {
    // Carga solo los resúmenes diarios, mucho más rápido que cargar todas las ventas
    const allDays = await loadData(STORES.DAILY_STATS);

    return allDays.reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + day.revenue,
        totalNetProfit: acc.totalNetProfit + day.profit,
        totalOrders: acc.totalOrders + day.orders,
        totalItemsSold: acc.totalItemsSold + day.itemsSold
    }), { totalRevenue: 0, totalNetProfit: 0, totalOrders: 0, totalItemsSold: 0 });
};