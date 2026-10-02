// src/hooks/pos/useActiveTablesCount.js
import { useState, useEffect, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import Logger from '../../services/Logger';

const readActiveTableCounts = async () => {
    const openSales = await db.table(STORES.SALES).where('status').equals(SALE_STATUS.OPEN).toArray();
    let active = 0;
    let kitchenRejected = 0;
    for (const sale of openSales) {
        if (sale.fulfillmentStatus === 'cancelled') kitchenRejected += 1;
        else active += 1;
    }
    return { active, kitchenRejected };
};

/**
 * Hook para manejar el conteo de mesas / ventas abiertas en restaurante.
 *
 * @param {boolean} enabled - Si el feature de mesas está habilitado
 * @returns {{
 *   activeTablesCount: number,
 *   kitchenRejectedOpenCount: number,
 *   fetchActiveTablesCount: function
 * }}
 */
export function useActiveTablesCount(enabled) {
    const [activeTablesCount, setActiveTablesCount] = useState(0);
    const [kitchenRejectedOpenCount, setKitchenRejectedOpenCount] = useState(0);

    const fetchActiveTablesCount = useCallback(async () => {
        if (!enabled) return;
        try {
            const { active, kitchenRejected } = await readActiveTableCounts();
            setActiveTablesCount(active);
            setKitchenRejectedOpenCount(kitchenRejected);
        } catch (error) {
            Logger.error('Error contando mesas activas:', error);
        }
    }, [enabled]);

    useEffect(() => {
        // Dexie reruns this query only when its SALES dependencies change.
        // The badge observes committed writes, including cancellations from
        // tabs or OrderSummary, with no optimistic decrement or polling.
        if (!enabled) return;
        const subscription = liveQuery(readActiveTableCounts).subscribe({
            next: ({ active, kitchenRejected }) => {
                setActiveTablesCount(active);
                setKitchenRejectedOpenCount(kitchenRejected);
            },
            error: (error) => Logger.error('Error observando mesas activas:', error)
        });
        return () => subscription.unsubscribe();
    }, [enabled]);

    return {
        activeTablesCount,
        kitchenRejectedOpenCount,
        fetchActiveTablesCount
    };
}
