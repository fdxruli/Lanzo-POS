import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { restaurantOrdersRepository } from '../../services/restaurant/restaurantOrdersRepository';
import { bindRestaurantTableCapabilities, getRestaurantTableCapabilities } from '../../services/restaurant/restaurantTableCapabilities';
import { isRestaurantCloudTableSettlementRequired } from '../../services/restaurant/restaurantCloudTableGuards';
import { getLicenseKeyFromDetails, isRestaurantOrdersCloudEnabled } from '../../services/sync/syncConstants';

export function useRestaurantTableCapabilities(order) {
  const actor = useActorRuntimeSnapshot();
  const details = useAppStore((state) => state.licenseDetails);
  const licenseKey = getLicenseKeyFromDetails(details);
  const [binding, setBinding] = useState(null);
  const id = order?.id;
  const version = order?.cloudOrder?.updatedAt || order?.cloudRestaurantOrderUpdatedAt || order?.updatedAt;
  const cloud = Boolean(order?.cloudOrder || isRestaurantCloudTableSettlementRequired(order));
  useEffect(() => {
    if (!cloud || !id || !licenseKey || actor.status !== 'granted') return;
    let disposed = false;
    let handle;
    try { handle = actorRuntimeController.capture(); } catch { return; }
    restaurantOrdersRepository.getTableCapabilities({ licenseKey, localOrderId: id, actorHandle: handle })
      .then((response) => {
        handle.assertCurrent();
        if (!disposed && response?.success === true && response.contractVersion === 1 && response.localOrderId === id) {
          setBinding({ ...bindRestaurantTableCapabilities(response, handle, id), observedVersion: version });
        }
      }).catch(() => { if (!disposed) setBinding(null); });
    return () => { disposed = true; };
  }, [cloud, id, version, licenseKey, actor.status, actor.generation]);
  return getRestaurantTableCapabilities({ order, actor, enforceStaffOwnership: cloud || order?.restaurantAuthorityMode === 'cloud' || isRestaurantOrdersCloudEnabled(details), verified: binding?.observedVersion === version ? binding : null });
}
