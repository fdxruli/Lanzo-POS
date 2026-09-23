import { useSyncExternalStore } from 'react';
import {
  getLocalInventoryOperationalAlertsSnapshot,
  subscribeLocalInventoryOperationalAlerts
} from '../services/localInventoryOperationalAlerts';

export function useInventoryOperationalAlertsSnapshot() {
  return useSyncExternalStore(
    subscribeLocalInventoryOperationalAlerts,
    getLocalInventoryOperationalAlertsSnapshot,
    getLocalInventoryOperationalAlertsSnapshot
  );
}

export default useInventoryOperationalAlertsSnapshot;
