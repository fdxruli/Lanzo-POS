import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { evaluateActorAccess } from './actorAccessPolicy';
import { useActorRuntimeSnapshot } from './useActorRuntimeSnapshot';

export const useActorAccess = () => {
  const snapshot = useActorRuntimeSnapshot();
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentAdminUser = useAppStore((state) => state.currentAdminUser);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  return useMemo(() => evaluateActorAccess({
    currentDeviceRole, currentAdminUser, currentStaffUser, runtimeSnapshot: snapshot
  }), [currentDeviceRole, currentAdminUser, currentStaffUser, snapshot]);
};
