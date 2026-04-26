// src/hooks/useActiveTablesCount.js
import { useState, useEffect, useCallback } from 'react';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import Logger from '../../services/Logger';

/**
 * Hook para manejar el conteo de mesas activas.
 * 
 * @param {boolean} enabled - Si el feature de mesas está habilitado
 * @returns {{ activeTablesCount: number, fetchActiveTablesCount: function }}
 */
export function useActiveTablesCount(enabled) {
    const [activeTablesCount, setActiveTablesCount] = useState(0);

    const fetchActiveTablesCount = useCallback(async () => {
        if (!enabled) return;
        try {
            const count = await db.table(STORES.SALES)
                .where('status')
                .equals(SALE_STATUS.OPEN)
                .count();
            setActiveTablesCount(count);
        } catch (error) {
            Logger.error('Error contando mesas activas:', error);
        }
    }, [enabled]);

    useEffect(() => {
        const initializeCount = async () => {
            await fetchActiveTablesCount();
        };
        
        initializeCount();
    }, [fetchActiveTablesCount]);

    return {
        activeTablesCount,
        fetchActiveTablesCount
    };
}
