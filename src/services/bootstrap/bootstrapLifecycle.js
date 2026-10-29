/** Optional observation of explicitly registered local work. This is not
 * authorization, cancellation, server confirmation, or ownership of a lock.
 * Register factories before start. Quiesce prevents new starts; it cannot stop
 * transport already in progress. Unknown critical work never drains by timeout.
 */
export const createBootstrapLifecycle = ({ isContextCurrent = () => true } = {}) => {
  const pending = new Set();
  const unknown = new Set();
  let accepting = true;
  let completed = 0;
  let rejected = 0;
  const assertCurrent = () => {
    if (!isContextCurrent()) {
      const error = new Error('BOOTSTRAP_LIFECYCLE_CONTEXT_STALE');
      error.code = 'BOOTSTRAP_LIFECYCLE_CONTEXT_STALE';
      throw error;
    }
  };
  const assertAdmission = () => {
    assertCurrent();
    if (!accepting) throw new Error('BOOTSTRAP_LIFECYCLE_QUIESCED');
  };
  const snapshot = () => Object.freeze({ accepting, pending: pending.size,
    completed, rejected, unknown: [...unknown] });
  const observe = (promise) => {
    const task = Promise.resolve(promise);
    const completion = task.then(
      () => { completed++; pending.delete(completion); },
      () => { rejected++; pending.delete(completion); }
    );
    pending.add(completion);
    return task;
  };
  return Object.freeze({
    assertCurrent,
    // Join an explicitly owned lifetime without acquiring cancellation rights.
    // Admission is synchronous; callers must join before starting new work.
    observe(promise) { assertAdmission(); return observe(promise); },
    track(factory) {
      assertAdmission();
      if (typeof factory !== 'function') throw new TypeError('Bootstrap work requires an unstarted factory');
      // Add completion before the microtask can invoke the operation.
      const task = Promise.resolve().then(() => { assertAdmission(); return factory(); });
      return observe(task);
    },
    markUnobservable(reason = 'unknown_critical_work') {
      // Recording a discovered boundary admits no work or authority. Already
      // running work can reveal unknown children after quiesce/invalidation;
      // refusing that evidence would allow a falsely empty drain.
      unknown.add(reason);
    },
    quiesce() { accepting = false; },
    async drain() {
      // Callers quiesce first when an exit frontier is required. No force release.
      while (pending.size) await Promise.all([...pending]);
      if (unknown.size) await new Promise(() => {});
      return snapshot();
    },
    getSnapshot: snapshot
  });
};

// Only the audited provider advertises this contract. Unknown substitutes keep
// the previous conservative classification (including callers with test mocks).
export const loadBootstrapProfile = (loadProfile, licenseKey, options = {}, lifecycle, unknownReason) => {
  if (lifecycle && loadProfile?.bootstrapLifecycleVersion !== 1) {
    lifecycle.markUnobservable(unknownReason);
  }
  return loadProfile(licenseKey, { ...options, ...(lifecycle ? { lifecycle } : {}) });
};
