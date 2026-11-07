import { useEffect, useState } from 'react';

const LOCK_NAME = 'lanzo_pos_active_window';
const CHANNEL_NAME = 'lanzo_pos_instance';
const FALLBACK_ELECTION_MS = 300;

/**
 * null: deciding ownership; false: this window owns it; true: another does.
 * Never mount the POS runtime until ownership is confirmed.
 */
export function useSingleInstance() {
  const [isDuplicate, setIsDuplicate] = useState(null);

  useEffect(() => {
    let disposed = false;
    let releaseLock = null;
    let stopFallback = () => {};
    const mark = (duplicate) => { if (!disposed) setIsDuplicate(duplicate); };

    // Only used by browsers without Web Locks. A blocked window never
    // announces itself as an active instance; simultaneous starts elect one.
    const startBroadcastFallback = () => {
      let channel;
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
      } catch {
        mark(true); // No reliable arbitration: deny a second operational runtime.
        return;
      }

      const instanceId = globalThis.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random());
      let role = 'checking';
      let primaryResponded = false;
      let higherPriorityContender = false;

      channel.onmessage = ({ data }) => {
        if (!data || data.instanceId === instanceId) return;

        if (data.type === 'CHECK_EXISTING') {
          if (role === 'primary') {
            channel.postMessage({ type: 'I_AM_HERE', instanceId });
          } else if (role === 'checking' && typeof data.instanceId === 'string' && data.instanceId < instanceId) {
            higherPriorityContender = true;
          }
        } else if (data.type === 'I_AM_HERE') {
          if (role === 'checking') {
            primaryResponded = true;
          } else if (role === 'primary' && (!data.instanceId || data.instanceId < instanceId)) {
            // Tie breaker for simultaneous elections, not for ordinary duplicates.
            role = 'duplicate';
            mark(true);
          }
        }
      };

      channel.postMessage({ type: 'CHECK_EXISTING', instanceId });
      const election = window.setTimeout(() => {
        if (disposed) return;
        role = primaryResponded || higherPriorityContender ? 'duplicate' : 'primary';
        mark(role === 'duplicate');
        if (role === 'primary') channel.postMessage({ type: 'I_AM_HERE', instanceId });
      }, FALLBACK_ELECTION_MS);

      stopFallback = () => {
        window.clearTimeout(election);
        channel.close();
      };
    };

    // Defer the request to survive React.StrictMode's mount/cleanup/remount.
    // The exclusive Web Lock remains held while this mounted window operates.
    const start = window.setTimeout(() => {
      if (disposed) return;
      if (typeof navigator.locks?.request !== 'function') {
        startBroadcastFallback();
        return;
      }

      try {
        const request = navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (disposed) return;
          if (!lock) {
            mark(true);
            return;
          }
          mark(false);
          await new Promise((resolve) => {
            releaseLock = resolve;
            if (disposed) resolve();
          });
        });
        Promise.resolve(request).catch(() => {
          if (!disposed) startBroadcastFallback();
        });
      } catch {
        startBroadcastFallback();
      }
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(start);
      stopFallback();
      releaseLock?.();
    };
  }, []);

  return isDuplicate;
}
