import { useEffect, useRef, useState } from 'react';
import Logger from '../services/Logger';
import {
  queryTickerInventoryAlerts,
  TICKER_ALERT_POLL_INTERVAL_MS
} from '../services/tickerAlerts';
import { TICKER_INVENTORY_ALERT_EVENT } from '../services/tickerAlertEvents';

const EMPTY_SNAPSHOT = { catalogSize: 0, alerts: [] };

export function useTickerAlerts() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const refreshIfVisible = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;

      const requestId = ++requestIdRef.current;
      try {
        const nextSnapshot = await queryTickerInventoryAlerts();
        if (!cancelled && requestId === requestIdRef.current) {
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        Logger.error('Error consultando alertas indexadas del ticker:', error);
      }
    };

    const initialTimer = window.setTimeout(() => {
      void refreshIfVisible();
    }, 0);
    const intervalId = window.setInterval(
      () => void refreshIfVisible(),
      TICKER_ALERT_POLL_INTERVAL_MS
    );

    const handleRefresh = () => void refreshIfVisible();
    window.addEventListener(TICKER_INVENTORY_ALERT_EVENT, handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);

    return () => {
      cancelled = true;
      requestIdRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
      window.removeEventListener(TICKER_INVENTORY_ALERT_EVENT, handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, []);

  return snapshot;
}
