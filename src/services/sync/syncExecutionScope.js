/** Optional ownership of local execution. Never authentication, cancellation,
 * remote confirmation or ownership of a Web Lock. Unknown is irreversible.
 * Factories are registered synchronously; rejected promises are always observed.
 */
let nextScope = 0;
export const createSyncExecutionScope = ({
  id = `sync-${++nextScope}`, generation = 0, context = {},
  isContextCurrent = () => true, timerApi = globalThis, onEvent = null
} = {}) => {
  const identity = Object.freeze({ id, generation, context: Object.freeze({ ...context }) });
  const tasks = new Map(), scheduled = new Map(), sources = new Map(), unknown = new Set();
  let state = 'ACTIVE', sequence = 0, completed = 0, rejected = 0;
  let observerFailed = false;
  const emit = (type, detail = {}) => {
    if (!onEvent || observerFailed) return;
    try {
      const result = onEvent(Object.freeze({ type, ...identity, ...detail }));
      if (result?.then) Promise.resolve(result).catch(() => { observerFailed = true; });
    } catch { observerFailed = true; }
  };
  const isCurrent = () => {
    try { return isContextCurrent() === true; } catch { return false; }
  };
  const error = code => Object.assign(new Error(code), { code });
  const assertCurrent = () => { if (!isCurrent()) throw error('SYNC_EXECUTION_CONTEXT_STALE'); };
  const assertAdmission = () => {
    assertCurrent();
    if (state !== 'ACTIVE') throw error('SYNC_EXECUTION_QUIESCED');
  };
  const snapshot = () => Object.freeze({ ...identity, state, accepting: state === 'ACTIVE',
    pending: tasks.size, scheduled: scheduled.size, sources: sources.size, completed, rejected,
    observerFailed, unknown: [...unknown],
    tasks: [...tasks.values()].map(({ id: taskId, label, parent, started, cleanup }) => (
      Object.freeze({ id: taskId, label, parent, started, cleanup })
    )) });
  const markUnobservable = (reason = 'unknown_critical_work') => {
    unknown.add(reason);
    // Evidence can arrive after quiesce or context loss. Never discard it.
    if (state === 'DRAINED') state = 'UNKNOWN';
    emit('unknown', { reason });
  };
  const closeBranch = record => {
    if (!record.settled || record.children.size || record.closed) return;
    record.closed = true;
    if (record.parentRecord) {
      record.parentRecord.children.delete(record);
      closeBranch(record.parentRecord);
    }
  };
  const startTask = (label, factory, { parent = null, cleanup = false } = {}) => {
    if (typeof factory !== 'function') throw new TypeError('Sync work requires an unstarted factory');
    const record = { id: ++sequence, label, parent: parent?.id ?? null, started: false, cleanup,
      parentRecord: parent, children: new Set(), settled: false, closed: false };
    parent?.children.add(record);
    tasks.set(record.id, record);
    const token = Object.freeze({ ...identity, taskId: record.id, assertCurrent, markUnobservable,
      track(child) {
        assertCurrent();
        if (record.closed) throw error('SYNC_EXECUTION_PARENT_SETTLED');
        return startTask(`${label}:continuation`, child, { parent: record });
      }
    });
    // Register before even an observer can synchronously call quiesce.
    const task = Promise.resolve().then(() => {
      if (!cleanup) {
        if (parent) assertCurrent(); else assertAdmission();
      }
      record.started = true;
      emit('started', { taskId: record.id, label });
      if (!cleanup) { if (parent) assertCurrent(); else assertAdmission(); }
      return factory(token);
    });
    const completion = task.then(
      () => { record.settled = true; tasks.delete(record.id); closeBranch(record); completed++; emit('settled', { taskId: record.id, label }); },
      () => {
        record.settled = true; tasks.delete(record.id); closeBranch(record); rejected++;
        if (cleanup) markUnobservable(`cleanup_failed:${label}`);
        emit('rejected', { taskId: record.id, label });
      }
    );
    record.completion = completion;
    emit('registered', { taskId: record.id, label, parent: record.parent });
    return task;
  };
  const run = (label, factory) => { assertAdmission(); return startTask(label, factory); };
  const schedule = (label, factory, delayMs = 0) => {
    assertAdmission();
    if (typeof factory !== 'function') throw new TypeError('Scheduled work requires an unstarted factory');
    const key = ++sequence;
    let resolveDone, rejectDone, fired = false, timer;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    done.catch(() => {});
    const cancel = () => {
      if (fired || !scheduled.has(key)) return false;
      timerApi.clearTimeout(timer); scheduled.delete(key);
      resolveDone({ cancelled: true }); emit('timer_cancelled', { label }); return true;
    };
    scheduled.set(key, { cancel, label });
    try {
      timer = timerApi.setTimeout(() => {
        if (!scheduled.has(key)) return;
        fired = true;
        // Keep the scheduling record until the registered task exists.
        try {
          const task = run(label, factory);
          scheduled.delete(key);
          task.then(resolveDone, rejectDone);
        } catch (failure) { scheduled.delete(key); rejectDone(failure); }
      }, Math.max(Number(delayMs) || 0, 0));
    } catch (failure) { scheduled.delete(key); rejectDone(failure); throw failure; }
    emit('scheduled', { label });
    return Object.freeze({ cancel, done });
  };
  const addSource = (label, stopScheduling) => {
    assertAdmission();
    if (typeof stopScheduling !== 'function') throw new TypeError('Source requires cleanup');
    const key = ++sequence;
    sources.set(key, { label, stopScheduling });
    return () => sources.delete(key);
  };
  const quiesce = () => {
    if (state !== 'ACTIVE') return snapshot();
    state = 'QUIESCING';
    for (const { cancel } of [...scheduled.values()]) cancel();
    for (const [key, source] of [...sources]) {
      sources.delete(key);
      // Cleanup is an explicit internal continuation, never new commercial work.
      startTask(`stop:${source.label}`, source.stopScheduling, { cleanup: true });
    }
    emit('quiesce');
    return snapshot();
  };
  const settleObserved = async () => {
    if (state === 'ACTIVE') throw error('SYNC_EXECUTION_QUIESCE_REQUIRED');
    if (state !== 'DRAINED') state = 'DRAINING';
    while (tasks.size) await Promise.all([...tasks.values()].map(task => task.completion));
    state = unknown.size ? 'UNKNOWN' : 'DRAINED';
    emit(state.toLowerCase());
    return snapshot();
  };
  return Object.freeze({ ...identity, isContextCurrent: isCurrent, assertCurrent, assertAdmission,
    run, schedule, addSource, quiesce, markUnobservable, getSnapshot: snapshot, settleObserved,
    async drain() {
      const result = await settleObserved();
      if (result.state !== 'DRAINED') await new Promise(() => {});
      return result;
    }
  });
};
