// QA integration only. Nothing imports this from App/Layout or commercial flows.
// Registry holds context/runtime IDs, never credentials or JWTs.
import { acquireEcomSignalLeadership } from './ecomSignalLeadership';
const owners = new WeakMap();
const keyOf = handle => JSON.stringify([handle.actorKey, handle.sessionId, handle.deviceRef,
  handle.generation, handle.tenant?.opaqueId, handle.tenant?.databaseName, handle.tenant?.generation]);

export function attachEcomSignalQa({ enabled = false, runtime, receiver, captureCredentials,
  isOnline = () => globalThis.navigator?.onLine !== false,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  events = globalThis.window, visibilityEvents = globalThis.document,
  onProbe = () => {}, onState = () => {}, onReconcileRequired = () => {},
  acquireLeadership = acquireEcomSignalLeadership,
  now = Date.now, uuid = () => crypto.randomUUID() }) {
  if (!enabled) return () => {};
  const owner = {};
  let disposed = false, suspended = false, cleanupRun, leadershipAbort, activeKey, sequence = 0;
  const release = () => { sequence++; leadershipAbort?.abort(); leadershipAbort = null; cleanupRun?.(); cleanupRun = null; activeKey = null; };
  const previous = owners.get(runtime);
  previous?.release?.();
  const slot = { owner, release, contextKey: previous?.contextKey, runtimeId: previous?.runtimeId,
    deniedKey: previous?.deniedKey, expiresAt: previous?.expiresAt, expired: previous?.expired, rollovers: 0 };
  owners.set(runtime, slot);
  const current = () => !disposed && owners.get(runtime)?.owner === owner;
  const sync = () => {
    if (!current()) return;
    let handle, key;
    try { handle = runtime.capture('ecommerce'); key = keyOf(handle); }
    catch { release(); return; }
    if (suspended || !isOnline() || !isVisible()) { release(); return; }
    if (key === activeKey || key === slot.deniedKey) return;
    release();
    if (slot.contextKey !== key) { slot.contextKey = key; slot.runtimeId = uuid(); slot.deniedKey = null; }
    if (slot.expired || (slot.expiresAt && now() >= slot.expiresAt)) {
      // A fresh runtime requests a NEW grant after canonical SQL validation;
      // neither the old topic nor its tombstone is renewed.
      slot.runtimeId = uuid(); slot.expiresAt = null; slot.expired = false;
    }
    activeKey = key;
    leadershipAbort = new AbortController();
    const leadershipSignal = leadershipAbort.signal;
    const ticket = sequence;
    const valid = () => {
      if (!current() || ticket !== sequence || suspended || !isOnline() || !isVisible()) return false;
      try { handle.assertCurrent('ecommerce'); return true; } catch { return false; }
    };
    // Credentials are read from the captured actor family, then rechecked before
    // sending. Offline GRANTED never supplies cloud authority by itself.
    Promise.resolve().then(() => acquireLeadership(key, leadershipSignal)).then(unlock => {
      if (!valid()) { unlock(); return; }
      return captureCredentials(handle);
    }).then(credentials => {
      if (!valid()) return;
      if (credentials.sessionId !== handle.sessionId) { release(); return; }
      const capture = { ...credentials.capture, runtime_id: slot.runtimeId,
        actor_generation: handle.generation, tenant_generation: handle.tenant.generation };
      const cleanup = receiver.start(capture,
        probe => { if (valid()) onProbe(probe); },
        (state, detail) => {
          if (!valid()) return;
          if (state === 'connected') { slot.expiresAt = detail?.grantExpiresAt; slot.rollovers = 0; }
          if (state === 'denied') slot.deniedKey = key;
          if (state === 'stopped') release();
          if (state === 'expired') {
            slot.expired = true;
            release();
            // One automatic rollover; repeated expiry without a successful join
            // waits for an external lifecycle event instead of spinning.
            if (++slot.rollovers <= 1) queueMicrotask(sync);
          }
          const safeDetail = state === 'connected' && typeof detail?.grantId === 'string'
            ? { grantId: detail.grantId }
            : undefined;
          if (safeDetail) onState(state, safeDetail);
          else onState(state);
        }, reason => { if (valid()) onReconcileRequired(reason); });
      if (valid()) cleanupRun = cleanup;
      else cleanup();
    }).catch(error => { if (valid() && error?.name !== 'AbortError') { slot.deniedKey = key; release(); onState('denied'); } });
  };
  const unsubscribe = runtime.subscribe(sync);
  const suspend = () => { suspended = true; if (current()) release(); };
  const resume = () => { suspended = false; sync(); };
  events?.addEventListener('online', sync); events?.addEventListener('offline', sync);
  events?.addEventListener('pagehide', suspend); events?.addEventListener('pageshow', resume);
  visibilityEvents?.addEventListener('freeze', suspend); visibilityEvents?.addEventListener('resume', resume);
  visibilityEvents?.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true; release(); unsubscribe();
    events?.removeEventListener('online', sync); events?.removeEventListener('offline', sync);
    events?.removeEventListener('pagehide', suspend); events?.removeEventListener('pageshow', resume);
    visibilityEvents?.removeEventListener('freeze', suspend); visibilityEvents?.removeEventListener('resume', resume);
    visibilityEvents?.removeEventListener('visibilitychange', sync);
    if (owners.get(runtime)?.owner === owner) slot.release = null;
  };
}
