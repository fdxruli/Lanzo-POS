import { getDocumentInstanceCoordinator } from '../../../src/services/instance/instanceCoordinator';
const params = new URLSearchParams(location.search);
const counters = { requests: 0, bootstrap: 0, lateEffect: 0, lateBootstrap: 0, evaluations: 0, errors: [], messages: [], states: [] };
let firstDenied = params.has('transient');
const nativeLocks = navigator.locks;
const request = (...args) => {
  counters.requests++;
  if (params.has('denyLocks') || firstDenied) { firstDenied = false; return Promise.reject(new DOMException('synthetic denial', 'SecurityError')); }
  return nativeLocks.request(...args);
};
let transport;
const NativeBC = globalThis.BroadcastChannel;
class ObservedBC extends NativeBC {
  constructor(name) {
    if (params.has('denyBC')) throw new DOMException('synthetic denial', 'SecurityError');
    super(name); transport = this;
  }
  postMessage(message) { counters.messages.push(message); super.postMessage(message); }
}
const target = { document, isSecureContext, crypto, navigator: { locks: params.has('noLocks') ? undefined : nativeLocks ? { request } : undefined },
  BroadcastChannel: params.has('noBC') ? undefined : ObservedBC };
const coordinator = getDocumentInstanceCoordinator(target);
coordinator.subscribe(snapshot => { counters.states.push({ state: snapshot.state, epoch: snapshot.localEpoch, held: snapshot.nativeHeld, pending: snapshot.pendingExecutors }); });
const ready = coordinator.start().then(snapshot => {
  if (snapshot.state === 'COORDINATOR_HELD') { const ticket = coordinator.captureTicket(); coordinator.assertCurrent(ticket); counters.bootstrap++; }
});
let resolveWork, work;
window.fixture = { coordinator, counters, ready,
  snapshot: () => ({ ...coordinator.getSnapshot(), counters }),
  inject: message => transport?.onmessage?.({ data: message }),
  beginWork(kind = 'callback') {
    work = coordinator.runExecutor(async ticket => {
      if (kind === 'import') await import(`/delayed.js?nonce=${crypto.randomUUID()}`);
      else await new Promise(done => { resolveWork = done; });
      coordinator.assertCurrent(ticket);
      if (kind === 'import') counters.lateBootstrap++;
      else counters.lateEffect++;
    }).catch(error => { counters.errors.push(error.code || error.message); });
    return true;
  },
  finishWork: () => resolveWork?.(),
  workDone: () => work,
  release: () => { void coordinator.quiesceAndRelease(); },
};
