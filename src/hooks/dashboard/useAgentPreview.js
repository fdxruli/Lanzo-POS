import { useMemo } from 'react';
import { DATE_RANGES, getDateRangeBounds } from '../../utils/buildAgentPayload';

const EMPTY_ARRAY = [];
const EMPTY_METRICS = [];

/**
 * Filtra un array de objetos por rango de fechas
 * @param {Array} items - Array de items con campo date o timestamp
 * @param {Date} startDate - Fecha inicio
 * @param {Date} endDate - Fecha fin
 * @returns {Array} Items dentro del rango
 */
const filterByDateRange = (items = EMPTY_ARRAY, startDate, endDate) => {
    if (!Array.isArray(items) || items.length === 0) return EMPTY_ARRAY;

    return items.filter(item => {
        const itemDate = new Date(item.date || item.timestamp || item.createdAt);
        return itemDate >= startDate && itemDate <= endDate;
    });
};

export const useAgentPreview = (
    agentId,
    dateRange,
    sales,
    menu,
    wasteLogs,
    customers
) => {
    // Extraer el tipo de rango correctamente antes para mantener limpias las dependencias
    const rangeType = typeof dateRange === 'string' ? dateRange : (dateRange?.type || 'today');
    const customStart = typeof dateRange === 'object' ? dateRange?.start : null;
    const customEnd = typeof dateRange === 'object' ? dateRange?.end : null;

    const dateBounds = useMemo(() => {
        return getDateRangeBounds(rangeType, customStart, customEnd);
    }, [rangeType, customStart, customEnd]);

    // Convertir el cálculo en "Estado Derivado" directamente.
    // El uso de useEffect + setState para cálculos síncronos causa "Maximum update depth exceeded" 
    // si el componente padre inyecta arrays inestables en cada render.
    const preview = useMemo(() => {
        if (!agentId || !rangeType) return null;

        const stableSales = sales || EMPTY_ARRAY;
        const stableMenu = menu || EMPTY_ARRAY;
        const stableWasteLogs = wasteLogs || EMPTY_ARRAY;
        const stableCustomers = customers || EMPTY_ARRAY;

        // Filtrar datos por rango de fecha
        const filteredSales = filterByDateRange(stableSales, dateBounds.start, dateBounds.end);
        const filteredWasteLogs = filterByDateRange(stableWasteLogs, dateBounds.start, dateBounds.end);

        switch (agentId) {
            case 'inventoryAuditor': {
                const totalWaste = filteredWasteLogs.length;
                const lowStock = stableMenu.filter(item => item.stock <= (item.minStock || 5)).length;
                return [
                    { label: 'Registros de merma', value: totalWaste },
                    { label: 'Productos en alerta de stock', value: lowStock },
                    { label: 'Total en menú', value: stableMenu.length }
                ];
            }

            case 'financialAnalyst': {
                const totalSales = filteredSales.length;
                const revenue = filteredSales.reduce((acc, curr) => acc + Number(curr.total || 0), 0);
                return [
                    { label: 'Ventas completadas', value: totalSales },
                    { label: 'Ingreso procesado', value: `$${revenue.toFixed(2)}` },
                    { label: 'Ticket Promedio', value: totalSales > 0 ? `$${(revenue / totalSales).toFixed(2)}` : '$0.00' }
                ];
            }

            case 'customerStrategist': {
                const activeCustomers = new Set(
                    filteredSales
                        .filter(s => s.customerId)
                        .map(s => s.customerId)
                ).size;
                const ticketsWithCustomer = filteredSales.filter(s => s.customerId).length;
                return [
                    { label: 'Clientes en base de datos', value: stableCustomers.length },
                    { label: 'Clientes activos en periodo', value: activeCustomers },
                    { label: 'Tickets vinculados', value: ticketsWithCustomer }
                ];
            }

            default:
                return EMPTY_METRICS;
        }
    }, [agentId, rangeType, dateBounds, sales, menu, wasteLogs, customers]);

    // isCalculating se fija en false porque este cálculo es casi instantáneo
    return { preview, isCalculating: false };
};