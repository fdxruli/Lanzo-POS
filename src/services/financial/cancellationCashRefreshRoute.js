// One narrowly-scoped DOM route. No financial authority, durable queue, or bus.
export const CASH_SYNC_UPDATED_EVENT = 'lanzo:cash-sync-updated';
const publicationOwners = new WeakMap();
const routes = new WeakMap();

export const isCancellationCashEventForScope = (event, scope = null) => (
  !publicationOwners.has(event) || publicationOwners.get(event) === scope
);

// Capture the original scope in the projection's arguments before its awaits.
// Even a closed scope still publishes the historical event; its old signal may
// not admit a refresh in another scope. Other event consumers are unchanged.
export const publishCancellationCashUpdate = (scope = null) => {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent(CASH_SYNC_UPDATED_EVENT);
  publicationOwners.set(event, scope);
  window.dispatchEvent(event);
};

export const getCancellationCashRefreshRoute = scope => {
  if (routes.has(scope)) return routes.get(scope);
  scope.assertAdmission();
  let stopped = false;
  const subscriptions = new Set(), pending = new Set();
  const isCurrent = () => !stopped && scope.isContextCurrent() && scope.getSnapshot().accepting;
  const observe = promise => {
    const completion = promise.then(() => pending.delete(completion), () => pending.delete(completion));
    pending.add(completion);
    return promise;
  };
  const fence = () => {
    stopped = true;
    for (const subscription of [...subscriptions]) subscription.unsubscribe();
  };
  const source = scope.addSource('cancellation_cash_refresh', () => {
    fence();
    // Never wait for scope.drain() from its own cleanup. No new work can join.
    return Promise.all([...pending]).then(() => undefined);
  });
  const runRead = factory => {
    if (!isCurrent()) return Promise.resolve(null);
    try {
      const task = scope.run('cancellation_cash:read', () => isCurrent() ? factory() : null);
      const result = task.catch(error => {
        if (!isCurrent() && ['SYNC_EXECUTION_QUIESCED', 'SYNC_EXECUTION_CONTEXT_STALE'].includes(error?.code)) return null;
        throw error;
      });
      // React's initial effect deliberately does not await this public result.
      result.catch(() => {});
      return observe(result);
    } catch (error) {
      if (!isCurrent()) return Promise.resolve(null);
      throw error;
    }
  };
  const route = Object.freeze({
    isCurrent, runRead,
    stop() { fence(); return source.stop(); },
    subscribe(refresh, canRefresh = () => true) {
      scope.assertAdmission();
      if (stopped) throw new Error('CANCELLATION_CASH_ROUTE_STOPPED');
      let active = true, timer = null;
      const listener = event => {
        if (!active || !isCurrent() || !isCancellationCashEventForScope(event, scope) || !canRefresh() || timer) return;
        const scheduled = scope.schedule('cancellation_cash:debounce', () => {
          timer = null;
          if (!active || !isCurrent() || !canRefresh()) return null;
          return refresh();
        }, 0);
        timer = scheduled;
        observe(scheduled.done);
      };
      const subscription = Object.freeze({
        unsubscribe() {
          if (!active) return;
          active = false;
          window.removeEventListener(CASH_SYNC_UPDATED_EVENT, listener);
          timer?.cancel(); timer = null;
          subscriptions.delete(subscription);
        }
      });
      subscriptions.add(subscription);
      window.addEventListener(CASH_SYNC_UPDATED_EVENT, listener);
      return subscription;
    }
  });
  routes.set(scope, route);
  return route;
};
