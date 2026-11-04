/**
 * Optional, per-invocation observation. The injected runner must register before
 * calling its factory and retain it until the returned promise settles (the
 * F01-1 runExecutor contract). It supplies admission, never financial authority.
 *
 * result preserves the operation's public settlement. settled is value-free and
 * also waits for work hidden by timeouts. Neither confirms a remote operation.
 * All critical continuations must be awaited or explicitly tracked as factories.
 * Detached/unobservable work is outside this contract: do not release on it.
 */
export const observeFinancialExecution = (operation, { runExecutor } = {}) => {
  if (typeof operation !== 'function' || typeof runExecutor !== 'function') {
    throw new TypeError('Financial execution requires operation and executor factories');
  }
  let resolveResult, rejectResult, resolveSettled;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const settled = new Promise(resolve => { resolveSettled = resolve; });
  const pending = new Set();
  let started = false, closed = false, unobservable = false, publicStatus = 'pending';
  const snapshot = () => Object.freeze({ started, closed, unobservable, publicStatus, pendingTasks: pending.size });
  const executionScope = Object.freeze({
    markUnobservable() {
      if (closed) throw new Error('FINANCIAL_EXECUTION_SCOPE_CLOSED');
      // An unknown critical frontier is terminally undrained, not cancelled.
      // Deliberately no timeout, completion token, or force-release escape hatch.
      if (!unobservable) { unobservable = true; pending.add(new Promise(() => {})); }
    },
    track(factory) {
      if (closed) throw new Error('FINANCIAL_EXECUTION_SCOPE_CLOSED');
      if (typeof factory !== 'function') throw new TypeError('Tracked work requires an unstarted factory');
      // Register synchronously before invoking the factory, including nested work.
      const task = Promise.resolve().then(factory);
      const completion = task.then(
        () => { pending.delete(completion); },
        () => { pending.delete(completion); }
      );
      pending.add(completion);
      return task;
    }
  });
  const execute = async ticket => {
    if (started || closed) throw new Error('FINANCIAL_EXECUTION_ALREADY_STARTED');
    started = true;
    try {
      const value = await operation(executionScope, ticket);
      publicStatus = 'fulfilled'; resolveResult(value);
    } catch (error) {
      publicStatus = 'rejected'; rejectResult(error);
    } finally {
      // No drain timeout. A non-settling client task keeps the runner pending.
      while (pending.size) await Promise.all([...pending]);
      closed = true;
      resolveSettled(snapshot());
    }
  };
  const registrationFailed = error => {
    // A compliant runner can fail admission before invoking execute. A failure
    // after invocation must not truncate the observed local execution lifetime.
    if (!started && !closed) {
      publicStatus = 'rejected'; closed = true;
      rejectResult(error); resolveSettled(snapshot());
    }
  };
  try {
    Promise.resolve(runExecutor(execute)).then(
      () => registrationFailed(new Error('FINANCIAL_EXECUTION_NOT_STARTED')),
      registrationFailed
    );
  } catch (error) { registrationFailed(error); }
  return Object.freeze({ result, settled, getSnapshot: snapshot });
};
