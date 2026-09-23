import { useMemo } from 'react';
import {
  buildEcommercePublishedStockTickerAlert,
  mapInventoryOperationalAlertsForTicker
} from '../services/tickerAlerts';
import { useInventoryOperationalAlertsSnapshot } from './useInventoryOperationalAlertsSnapshot';
import { useEcommercePublishedStockAlerts } from './useEcommercePublishedStockAlerts';

const EMPTY_SNAPSHOT = { catalogSize: 0, alerts: [] };

export function useTickerAlerts(enabled = true) {
  const localInventorySnapshot = useInventoryOperationalAlertsSnapshot();
  const { snapshot: ecommerceSnapshot } = useEcommercePublishedStockAlerts({
    enabled,
    reason: 'free_ticker'
  });

  return useMemo(() => {
    if (!enabled) return EMPTY_SNAPSHOT;

    const ecommerceAlert = buildEcommercePublishedStockTickerAlert(ecommerceSnapshot);
    const inventoryAlerts = mapInventoryOperationalAlertsForTicker(
      localInventorySnapshot.alerts
    );

    return {
      catalogSize: localInventorySnapshot.catalogSize,
      alerts: ecommerceAlert
        ? [ecommerceAlert, ...inventoryAlerts]
        : inventoryAlerts
    };
  }, [ecommerceSnapshot, enabled, localInventorySnapshot.alerts, localInventorySnapshot.catalogSize]);
}
