import { useMemo, useSyncExternalStore } from 'react';
import { getNativeTenantReconnectRevision, subscribeLocalDatabaseActivity } from '../db/databaseRuntime';
import { useAppStore } from '../../store/useAppStore';
import { evaluateActorAccess } from './actorAccessPolicy';
import { useActorRuntimeSnapshot } from './useActorRuntimeSnapshot';

export const useActorAccess = () => {
  const snapshot = useActorRuntimeSnapshot();
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  // Recheck the same actor at the end of a reconnect. Refreshing on close
  // itself would unmount protected pages and interrupt their in-flight work.
  const reconnectRevision = useSyncExternalStore(subscribeLocalDatabaseActivity, getNativeTenantReconnectRevision);
  return useMemo(
    () => evaluateActorAccess({ currentDeviceRole, currentAdminUser, currentStaffUser, runtimeSnapshot: snapshot }),
    // Physical readiness is an implicit input of evaluateActorAccess.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDeviceRole, currentAdminUser, currentStaffUser, snapshot, reconnectRevision]
  );
};
