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
    const refresh = () => setSnapshot(actorRuntimeController.getState());
    refresh();
    globalThis.addEventListener?.('focus', refresh);
    globalThis.document?.addEventListener('visibilitychange', refresh);
    return () => {
      unsubscribe();
      globalThis.removeEventListener?.('focus', refresh);
      globalThis.document?.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    if (snapshot.status !== 'granted' || !Number.isFinite(snapshot.authorizationExpiresAt)) return;
    // Unmount protected content even when an idle page has no store updates.
    const timer = setTimeout(() => {
      setSnapshot(actorRuntimeController.getState());
    }, Math.min(2 ** 31 - 1, Math.max(0, snapshot.authorizationExpiresAt - Date.now())));
    return () => clearTimeout(timer);
  }, [snapshot]);

  return snapshot;
};

export default useActorRuntimeSnapshot;
