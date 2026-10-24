// Phase 1B building block only. Nothing subscribes from App or the inbox.
// A new controller belongs to one captured Actor Runtime context. Calling start
// again disposes the previous run; stop is safe for Strict Mode cleanup.
export function createEcomSignalReceiver({ broker, createTransport, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let generation = 0;
  let active;

  function dispose(run) {
    if (!run || run.disposed) return;
    run.disposed = true;
    run.abort.abort();
    for (const timer of run.timers) clearTimer(timer);
    run.timers.clear();
    // disconnect synchronously disables the old transport's reconnect loop.
    const transport = run.transport;
    run.transport = null;
    try { transport?.disconnect(); } catch { /* already closed */ }
    try { Promise.resolve(transport?.removeAllChannels()).catch(() => {}); } catch { /* idempotent */ }
    run.token = null;
    run.connection = null;
  }

  function stop() {
    generation++;
    dispose(active);
    active = null;
  }

  function start(context, onProbe = () => {}, onState = () => {}, onReconcileRequired = () => {}) {
    stop();
    const run = { generation, context: structuredClone(context), abort: new AbortController(),
      timers: new Set(), transport: null, token: null, attempts: 0, disposed: false, deadline: 0,
      connection: null, request: 0 };
    active = run;
    const current = () => active === run && generation === run.generation && !run.disposed;
    const later = (fn, ms) => {
      if (!current()) return null;
      const timer = setTimer(() => { run.timers.delete(timer); if (current()) fn(); }, ms);
      run.timers.add(timer);
      return timer;
    };
    const closeTransport = () => {
      for (const timer of run.timers) clearTimer(timer);
      run.timers.clear();
      const old = run.transport;
      run.transport = null;
      old?.disconnect();
      Promise.resolve(old?.removeAllChannels()).catch(() => {});
      run.token = null;
    };
    const terminal = state => { if (current()) { dispose(run); onState(state); } };
    const recover = (keepTransport = false) => {
      if (!current()) return;
      if (!keepTransport) closeTransport();
      if (++run.attempts > 5 || (run.deadline && now() >= run.deadline)) { terminal('stopped'); return; }
      onState('retrying');
      later(connect, Math.min(15000, 500 * 2 ** (run.attempts - 1)) * (0.8 + random() * 0.4));
    };
    async function connect() {
      if (!current()) return;
      const request = ++run.request;
      const latest = () => current() && request === run.request;
      let candidate;
      try {
        onState('authorizing');
        const result = await broker(run.context, { signal: run.abort.signal });
        if (!latest()) return;
        if (!result.ok) {
          // Only transport, 429 and HTTP 5xx are recoverable. Unknown responses
          // and authorization failures stop this captured context permanently.
          if (result.status === 410) terminal('expired');
          else if (result.status === 409 || result.status === 429 || result.status >= 500) recover(!!run.transport);
          else terminal('denied');
          return;
        }
        const c = result.connection;
        const expiry = Math.min(c.grantExpiresAt, c.jwtExpiresAt);
        if (!c.accessToken || !c.topic?.startsWith('ecom:qa-probe:1a2:') || !Number.isFinite(expiry) || expiry <= now() + 5000) {
          terminal('denied'); return;
        }
        run.deadline = expiry;
        const connectionMetadata = { url: c.url, publicKey: c.publicKey, topic: c.topic,
          grantId: c.grantId, grantExpiresAt: c.grantExpiresAt, jwtExpiresAt: c.jwtExpiresAt };
        const schedule = (renew = true) => {
          for (const timer of run.timers) clearTimer(timer);
          run.timers.clear();
          if (renew) later(connect, Math.max(1000, expiry - now() - (25000 + random() * 10000)));
          later(() => { if (now() >= run.deadline) terminal('expired'); }, expiry - now());
        };
        // Renew the concession without tearing down a healthy socket. Updating
        // a JWT uses the supported access_token protocol, never Auth setSession.
        const previous = run.connection;
        if (run.transport && previous?.topic === c.topic && previous.url === c.url && previous.publicKey === c.publicKey) {
          const transport = run.transport;
          if (run.token !== c.accessToken) await transport.setAuth(c.accessToken);
          if (!latest() || run.transport !== transport) return;
          run.token = c.accessToken; run.connection = connectionMetadata; run.attempts = 0;
          // A session-clamped expiry (or cached reply) cannot advance. Wait for
          // the existing deadline instead of hammering the broker every second.
          schedule(expiry > Math.min(previous.grantExpiresAt, previous.jwtExpiresAt));
          onState('connected', { grantId: c.grantId, grantExpiresAt: c.grantExpiresAt });
          return;
        }
        candidate = await createTransport(c.url, c.publicKey);
        if (!latest()) { candidate.disconnect(); await candidate.removeAllChannels(); return; }
        closeTransport();
        run.transport = candidate;
        run.token = c.accessToken;
        run.connection = connectionMetadata;
        await candidate.setAuth(run.token);
        if (!latest() || run.transport !== candidate) return;
        const transport = candidate;
        const channel = transport.channel(c.topic, { config: { private: true, broadcast: { ack: true, self: false } } });
        channel.on('broadcast', { event: 'qa_probe' }, message => {
          if (current() && run.transport === transport && now() < run.deadline) onProbe(message.payload);
        });
        let completed = false;
        channel.subscribe((status, error) => {
          if (!current() || run.transport !== transport) return;
          if (status === 'SUBSCRIBED' && !completed) {
            completed = true;
            run.attempts = 0;
            schedule();
            onState('connected', { grantId: c.grantId, grantExpiresAt: c.grantExpiresAt });
            // Signals are hints. A future inbox consumer must fetch through its
            // current Lanzo RPC after initial join, reconnect or topic rollover.
            onReconcileRequired({ reason: previous?.topic !== c.topic ? 'topic_changed' : 'reconnected' });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // The SDK also emits CHANNEL_ERROR for a broken WebSocket. Only
            // an explicit authorization rejection latches the captured actor;
            // an unclassified transport failure rechecks the broker, bounded.
            const reason = typeof error === 'string' ? error : error?.message ?? error?.reason ?? '';
            if (/unauthorized|permission.denied|invalid.*jwt|jwt.*expired|token.*expired/i.test(reason)) terminal('denied');
            else recover();
          }
        });
        later(() => { if (now() >= run.deadline && run.transport === transport) terminal('expired'); }, expiry - now());
      } catch (error) {
        if (!latest()) { if (candidate && candidate !== run.transport) candidate.disconnect(); return; }
        if (error?.name === 'AbortError') return;
        recover(!!run.transport);
      }
    }
    void connect();
    // Old cleanup must never stop a new Strict Mode/context run.
    return () => { if (active === run) stop(); else dispose(run); };
  }
  return { start, stop };
}

export async function createEcomSignalTransport(url, publicKey) {
  const { RealtimeClient } = await import('@supabase/supabase-js');
  // No Auth client, storage, URL session detection, refresh or setSession.
  return new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: publicKey } });
}

export function createEcomSignalBrokerClient({ endpoint, publicKey, fetcher = fetch }) {
  return async (capture, { signal }) => {
    const response = await fetcher(endpoint, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(capture) });
    return { ok: response.ok, status: response.status, connection: response.ok ? await response.json() : null };
  };
}
