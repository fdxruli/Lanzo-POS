// src/hooks/pos/useActiveTablesCount.js
import { useRestaurantActiveTables } from '../restaurant/useRestaurantActiveTables';

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
    const { active, kitchenRejected, refresh } = useRestaurantActiveTables({ enabled });
    return { activeTablesCount: active, kitchenRejectedOpenCount: kitchenRejected,
        fetchActiveTablesCount: refresh };
}
