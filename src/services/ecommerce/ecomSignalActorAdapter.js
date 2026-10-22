// QA integration only. Nothing imports this from App/Layout or commercial flows.
// Registry holds context/runtime IDs, never credentials or JWTs.
const owners = new WeakMap();
const keyOf = handle => JSON.stringify([handle.actorKey, handle.sessionId, handle.deviceRef,
  handle.generation, handle.tenant?.opaqueId, handle.tenant?.databaseName, handle.tenant?.generation]);

export function attachEcomSignalQa({ enabled = false, runtime, receiver, captureCredentials,
  isOnline = () => globalThis.navigator?.onLine !== false,
  isVisible = () => globalThis.document?.visibilityState !== 'hidden',
  events = globalThis.window, visibilityEvents = globalThis.document,
  onProbe = () => {}, onState = () => {}, uuid = () => crypto.randomUUID() }) {
  if (!enabled) return () => {};
  const owner = {};
  let disposed = false, cleanupRun, activeKey, sequence = 0;
  const release = () => { sequence++; cleanupRun?.(); cleanupRun = null; activeKey = null; };
  const previous = owners.get(runtime);
  previous?.release?.();
  const slot = { owner, release, contextKey: previous?.contextKey, runtimeId: previous?.runtimeId, deniedKey: previous?.deniedKey };
  owners.set(runtime, slot);
  const current = () => !disposed && owners.get(runtime)?.owner === owner;
  const sync = () => {
    if (!current()) return;
    let handle, key;
    try { handle = runtime.capture('ecommerce'); key = keyOf(handle); }
    catch { release(); return; }
    if (!isOnline() || !isVisible()) { release(); return; }
    if (key === activeKey || key === slot.deniedKey) return;
    release();
    if (slot.contextKey !== key) { slot.contextKey = key; slot.runtimeId = uuid(); slot.deniedKey = null; }
    activeKey = key;
    const ticket = sequence;
    const valid = () => {
      if (!current() || ticket !== sequence || !isOnline() || !isVisible()) return false;
      try { handle.assertCurrent('ecommerce'); return true; } catch { return false; }
    };
    // Credentials are read from the captured actor family, then rechecked before
    // sending. Offline GRANTED never supplies cloud authority by itself.
    Promise.resolve().then(() => captureCredentials(handle)).then(credentials => {
      if (!valid()) return;
      if (credentials.sessionId !== handle.sessionId) { release(); return; }
      const capture = { ...credentials.capture, runtime_id: slot.runtimeId,
        actor_generation: handle.generation, tenant_generation: handle.tenant.generation };
      const cleanup = receiver.start(capture,
        probe => { if (valid()) onProbe(probe); },
        state => {
          if (!valid()) return;
          if (['denied', 'expired', 'stopped'].includes(state)) slot.deniedKey = key;
          onState(state);
        });
      if (valid()) cleanupRun = cleanup;
      else cleanup();
    }).catch(() => { if (valid()) { slot.deniedKey = key; release(); onState('denied'); } });
  };
  const unsubscribe = runtime.subscribe(sync);
  events?.addEventListener('online', sync); events?.addEventListener('offline', sync);
  visibilityEvents?.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true; release(); unsubscribe();
    events?.removeEventListener('online', sync); events?.removeEventListener('offline', sync);
    visibilityEvents?.removeEventListener('visibilitychange', sync);
    if (owners.get(runtime)?.owner === owner) slot.release = null;
  };
}
