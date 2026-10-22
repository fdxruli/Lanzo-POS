import Logger from '../services/Logger';
import { actorRuntimeController } from '../services/auth/actorRuntimeController';

// These snapshots fence deferred health work only. UI and writes continue to
// use the canonical Actor Runtime; this helper never grants or refreshes it.
const sameContext = (a, b) => (
  a.generation === b.generation
  && a.status === b.status
  && a.actorKey === b.actorKey
  && a.sessionId === b.sessionId
  && a.deviceRef === b.deviceRef
  && a.tenant?.opaqueId === b.tenant?.opaqueId
  && a.tenant?.generation === b.tenant?.generation
  && a.tenant?.databaseName === b.tenant?.databaseName
);

export const startAdminResumeChecks = ({
  performHealthCheck,
  evaluateLocalAuthority = () => actorRuntimeController.getState()
}) => {
  let active = true;
  let timer = null;
  let inFlight = false;
  let pendingReason = null;

  const reportFailure = () => Logger.warn('[ResumeCheck] Health check could not complete.');
  const cancelTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    pendingReason = null;
  };
  const markInactive = () => {
    cancelTimer();
    try {
      sessionStorage.setItem('lanzo_last_active', String(Date.now()));
    } catch {
      // Activity metadata is best effort and never an authorization input.
    }
  };
  const schedule = (reason) => {
    if (!active || document.visibilityState === 'hidden') return;
    // Expiration must publish synchronously, including offline and while a
    // previous remote check is pending. The 250ms debounce grants no grace.
    const context = evaluateLocalAuthority();
    if (!active || inFlight) return;
    if (timer !== null) window.clearTimeout(timer);
    pendingReason = reason === 'online' || pendingReason === 'online' ? 'online' : reason;
    timer = window.setTimeout(async () => {
      timer = null;
      const selectedReason = pendingReason;
      pendingReason = null;
      if (!active || document.visibilityState === 'hidden') return;
      if (!sameContext(context, evaluateLocalAuthority()) || !active) return;
      inFlight = true;
      try {
        await performHealthCheck(selectedReason);
      } catch {
        // Do not log transport payloads or allow an unhandled rejection.
        if (active) reportFailure();
      } finally {
        inFlight = false;
      }
    }, 250);
  };
  const visibility = () => {
    if (document.visibilityState === 'hidden') markInactive();
    else schedule('visibility');
  };
  const resume = () => schedule('resume');
  const pageshow = () => schedule('pageshow');
  const focus = () => schedule('focus');
  const online = () => schedule('online');
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('resume', resume);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('focus', focus);
  window.addEventListener('online', online);
  window.addEventListener('pagehide', markInactive);

  return () => {
    active = false;
    cancelTimer();
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('resume', resume);
    window.removeEventListener('pageshow', pageshow);
    window.removeEventListener('focus', focus);
    window.removeEventListener('online', online);
    window.removeEventListener('pagehide', markInactive);
  };
};
