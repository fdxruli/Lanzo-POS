import { useEffect, useState } from 'react';
import { actorRuntimeController } from './actorRuntimeController';

/**
 * React subscription for the canonical actor authority.
 *
 * ActorRuntime snapshots are immutable but intentionally cloned on reads, so
 * useState/useEffect is used instead of useSyncExternalStore (which requires a
 * referentially stable getSnapshot result). The post-subscribe read closes the
 * small render/effect race without making UI state part of the authority.
 */
export const useActorRuntimeSnapshot = () => {
  const [snapshot, setSnapshot] = useState(() => actorRuntimeController.getState());

  useEffect(() => {
    const unsubscribe = actorRuntimeController.subscribe(setSnapshot);
    setSnapshot(actorRuntimeController.getState());
    return unsubscribe;
  }, []);

  return snapshot;
};

export default useActorRuntimeSnapshot;
