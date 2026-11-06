import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { evaluateActorAccess, isActorSnapshotCurrent } from './actorAccessPolicy';
import { useActorRuntimeSnapshot } from './useActorRuntimeSnapshot';

export const useActorAccess = () => {
  const snapshot = useActorRuntimeSnapshot();
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const runtimeSnapshot = isActorSnapshotCurrent(snapshot) ? snapshot : null;
  return useMemo(() => evaluateActorAccess({
    currentDeviceRole, currentAdminUser, currentStaffUser, runtimeSnapshot
  }), [currentDeviceRole, currentAdminUser, currentStaffUser, runtimeSnapshot]);
};
