import { inspectInstanceCapabilities } from './instanceCapabilities';
import {
  INSTANCE_LOCK_NAME, INSTANCE_CHANNEL_NAME, INSTANCE_PROTOCOL_VERSION,
  INSTANCE_STATES as S, COORDINATION_MODE, randomInstanceId, validateInstanceMessage,
} from './instanceProtocol';

const DOCUMENT_COORDINATOR = Symbol.for('lanzo.pos.document.instanceCoordinator.v1');
const transitions = {
  STARTING: [S.CHECKING, S.QUIESCING],
  CHECKING: [S.SECONDARY, S.ERROR, S.QUIESCING],
  SECONDARY: [S.RECOVERING, S.ERROR, S.QUIESCING],
  RECOVERING: [S.COORDINATOR_HELD, S.QUIESCING],
  COORDINATOR_HELD: [S.QUIESCING],
  QUIESCING: [S.RELEASED, S.ERROR],
  ERROR: [S.CHECKING, S.QUIESCING],
  RELEASED: [],
};
const boundedSet = (map, key, value, limit) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value);
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
export class InstanceCoordinationError extends Error {
  constructor(code) { super(code); this.name = 'InstanceCoordinationError'; this.code = code; }
}

/** Inert on import. Explicit invocation creates one service for this document.
 * A view may subscribe/unsubscribe; only explicit quiesce or document termination
 * ends ownership. No authentication, storage, network or commercial imports.
 */
export function getDocumentInstanceCoordinator(target = globalThis) {
  const documentTarget = target.document;
  if (!documentTarget) throw new InstanceCoordinationError('INSTANCE_DOCUMENT_REQUIRED');
  if (Object.hasOwn(documentTarget, DOCUMENT_COORDINATOR)) return documentTarget[DOCUMENT_COORDINATOR];
  const coordinator = createCoordinator(target);
  Object.defineProperty(documentTarget, DOCUMENT_COORDINATOR, { value: coordinator });
  return coordinator;
}

function createCoordinator(target) {
  const capabilities = inspectInstanceCapabilities(target);
  let identityError = null;
  let instanceId = null;
  try { if (capabilities.randomIdentity) instanceId = randomInstanceId(target.crypto); }
  catch { identityError = 'INSTANCE_IDENTITY_UNAVAILABLE'; }
  let state = S.STARTING, localEpoch = 0, nativeHeld = false, heldEpoch = null;
  let diagnostic = null, messaging = 'inactive', observedOwner = null;
  let channel = null, requestId = null, sequence = 0, attempt = null, releaseFlight = null;
  let ticketController = null;
  const listeners = new Set(), issuedTickets = new WeakSet(), executors = new Set();
  const seen = new Map(), peers = new Map(), peerOrder = new Map();
  let snapshot;
  function publish() {
    snapshot = Object.freeze({ state, instanceId, localEpoch, mode: COORDINATION_MODE,
      nativeHeld, diagnostic, messaging, observedOwner, pendingExecutors: executors.size, capabilities });
    // An observer failure must not reject the native lock callback.
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* observer owns its error */ } }
  }
  function move(next) {
    if (!transitions[state].includes(next)) throw new InstanceCoordinationError('INSTANCE_TRANSITION_INVALID');
    state = next;
    publish();
  }
  function closeChannel() {
    if (channel) {
      channel.onmessage = null;
      channel.onmessageerror = null;
      try { channel.close(); } catch { /* already unavailable */ }
    }
    channel = null;
    peers.clear(); peerOrder.clear(); seen.clear();
  }
  function disableMessaging() {
    closeChannel(); messaging = 'unavailable'; publish();
  }
  function send(type, to, correlation, epoch = localEpoch, messageState = state) {
    if (!channel) return;
    try {
      channel.postMessage({ v: INSTANCE_PROTOCOL_VERSION, type, from: instanceId, to,
        requestId: correlation, messageId: `${instanceId}:${++sequence}`, epoch,
        mode: COORDINATION_MODE, state: messageState });
    } catch { disableMessaging(); }
  }
  function onMessage(event) {
    const message = event.data;
    if (!validateInstanceMessage(message, instanceId, requestId)) return;
    if (message.type === 'RELEASE' && (observedOwner?.instanceId !== message.from
      || observedOwner.epoch !== message.epoch)) return;
    if (seen.has(message.messageId)) return;
    const serial = Number(message.messageId.split(':')[1]);
    const prior = peerOrder.get(message.from);
    if (prior && (serial <= prior.serial || message.epoch < prior.epoch)) return;
    // RELEASE is the terminal hint for the held epoch, not our newer revoke epoch.
    boundedSet(seen, message.messageId, true, 512);
    boundedSet(peerOrder, message.from, { epoch: message.epoch, serial }, 128);
    if (message.type === 'PROBE') {
      boundedSet(peers, message.from, message.requestId, 128);
      if (nativeHeld) send('STATUS', message.from, message.requestId, heldEpoch);
      else if ([S.CHECKING, S.SECONDARY, S.RECOVERING].includes(state)) send('CANDIDATE', message.from, message.requestId);
      return;
    }
    // Informational only; never changes local state, native ownership or tickets.
    if (state !== S.SECONDARY) return;
    if (message.type === 'STATUS') {
      observedOwner = Object.freeze({ instanceId: message.from, epoch: message.epoch }); publish();
    } else if (message.type === 'RELEASE' && observedOwner?.instanceId === message.from
      && observedOwner.epoch === message.epoch) {
      observedOwner = null; publish();
    }
  }
  function openChannel() {
    if (!capabilities.broadcastChannel) { messaging = 'unavailable'; return; }
    try {
      channel = new target.BroadcastChannel(INSTANCE_CHANNEL_NAME);
      channel.onmessage = onMessage;
      channel.onmessageerror = disableMessaging;
      messaging = 'available';
    } catch { disableMessaging(); }
  }
  function probe() {
    if (![S.SECONDARY, S.COORDINATOR_HELD].includes(state)) return null;
    try { requestId = randomInstanceId(target.crypto); }
    catch { disableMessaging(); return null; }
    observedOwner = null;
    send('PROBE', null, requestId);
    publish();
    return requestId;
  }
  function invalidateTickets() {
    localEpoch += 1;
    ticketController?.abort();
    ticketController = null;
  }
  function isCurrent(ticket) {
    return Boolean(ticket && issuedTickets.has(ticket) && nativeHeld && state === S.COORDINATOR_HELD
      && ticket.instanceId === instanceId && ticket.localEpoch === localEpoch
      && ticket.signal === ticketController?.signal && !ticket.signal.aborted);
  }
  function assertCurrent(ticket) {
    if (!isCurrent(ticket)) throw new InstanceCoordinationError('INSTANCE_COORDINATION_STALE');
  }
  function captureTicket() {
    if (!nativeHeld || state !== S.COORDINATOR_HELD) throw new InstanceCoordinationError('INSTANCE_COORDINATION_REQUIRED');
    const ticket = Object.freeze({ instanceId, localEpoch, mode: COORDINATION_MODE, signal: ticketController.signal });
    issuedTickets.add(ticket);
    return ticket;
  }
  function runExecutor(callback) {
    const ticket = captureTicket();
    if (typeof callback !== 'function') throw new TypeError('Executor must be a function');
    // Register before invoking the callback, including callbacks that quiesce us.
    const task = Promise.resolve().then(() => { assertCurrent(ticket); return callback(ticket); })
      .then(value => { assertCurrent(ticket); return value; });
    const tracked = task.finally(() => { executors.delete(tracked); publish(); });
    executors.add(tracked); publish();
    return tracked;
  }
  async function waitForExecutors() {
    while (executors.size) await Promise.allSettled([...executors]);
  }
  function start() {
    if ([S.QUIESCING, S.RELEASED].includes(state)) return Promise.reject(new InstanceCoordinationError('INSTANCE_RESTART_FORBIDDEN'));
    if (attempt) return attempt.ready.promise;
    if (![S.STARTING, S.ERROR].includes(state)) return Promise.reject(new InstanceCoordinationError('INSTANCE_RESTART_FORBIDDEN'));
    const current = { ready: deferred(), hold: deferred(), abort: new AbortController(), settled: null };
    attempt = current;
    localEpoch += 1; diagnostic = null; releaseFlight = null;
    move(S.CHECKING);
    if (state !== S.CHECKING) return current.ready.promise; // synchronous observer requested shutdown
    if (!capabilities.secureContext || !capabilities.webLocks || !instanceId) {
      diagnostic = identityError || (!instanceId ? 'INSTANCE_IDENTITY_UNAVAILABLE'
        : !capabilities.secureContext ? 'INSTANCE_SECURE_CONTEXT_REQUIRED' : 'INSTANCE_WEB_LOCKS_REQUIRED');
      move(S.ERROR); current.ready.resolve(snapshot);
      current.settled = Promise.resolve();
      return current.ready.promise;
    }
    openChannel();
    if (state !== S.CHECKING) return current.ready.promise;
    move(S.SECONDARY);
    if (state !== S.SECONDARY) return current.ready.promise;
    let nativeRequest;
    try {
      nativeRequest = target.navigator.locks.request(INSTANCE_LOCK_NAME,
        { mode: 'exclusive', signal: current.abort.signal }, async lock => {
          if (!lock) throw new InstanceCoordinationError('INSTANCE_WEB_LOCKS_FAILED');
          if (attempt !== current || state !== S.SECONDARY) return;
          nativeHeld = true; heldEpoch = localEpoch;
          move(S.RECOVERING);
          if (state === S.RECOVERING) {
            ticketController = new AbortController();
            move(S.COORDINATOR_HELD);
            if (state === S.COORDINATOR_HELD) for (const [peer, correlation] of [...peers]) send('STATUS', peer, correlation, heldEpoch);
          }
          current.ready.resolve(snapshot);
          await current.hold.promise;
          nativeHeld = false; heldEpoch = null;
        });
    } catch (error) { nativeRequest = Promise.reject(error); }
    current.settled = Promise.resolve(nativeRequest).catch(async () => {
      if (state === S.QUIESCING) return; // explicit cancellation is not an API failure
      diagnostic = 'INSTANCE_WEB_LOCKS_FAILED';
      if (nativeHeld) {
        invalidateTickets(); move(S.QUIESCING);
        await waitForExecutors(); nativeHeld = false; current.hold.resolve();
      }
      closeChannel(); messaging = 'inactive';
      if (releaseFlight) return;
      move(S.ERROR); current.ready.resolve(snapshot);
    });
    probe();
    return current.ready.promise;
  }
  async function retry() {
    if (state !== S.ERROR) throw new InstanceCoordinationError('INSTANCE_RETRY_REQUIRES_ERROR');
    const previous = attempt;
    await previous?.settled;
    // Concurrent retry callers reuse one new attempt; a concurrent close wins.
    if (attempt !== previous) return attempt.ready.promise;
    if (state !== S.ERROR) throw new InstanceCoordinationError('INSTANCE_RESTART_FORBIDDEN');
    attempt = null;
    return start();
  }
  function quiesceAndRelease() {
    if (releaseFlight) return releaseFlight;
    if (state === S.RELEASED) return Promise.resolve(snapshot);
    const completion = deferred();
    releaseFlight = completion.promise;
    invalidateTickets();
    if (state !== S.QUIESCING) move(S.QUIESCING);
    attempt?.abort.abort(); // cancels pending requests; does not steal a held lock
    void (async () => {
      await waitForExecutors();
      if (nativeHeld) for (const [peer, correlation] of [...peers]) send('RELEASE', peer, correlation, heldEpoch, S.RELEASED);
      attempt?.hold.resolve();
      await attempt?.settled;
      nativeHeld = false; heldEpoch = null; observedOwner = null;
      closeChannel(); messaging = 'inactive';
      move(S.RELEASED);
      attempt?.ready.resolve(snapshot);
      completion.resolve(snapshot);
    })();
    return completion.promise;
  }
  publish();
  return Object.freeze({ getSnapshot: () => snapshot, start, retry, probe, captureTicket,
    isCurrent, assertCurrent, runExecutor, waitForExecutors, quiesceAndRelease,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
