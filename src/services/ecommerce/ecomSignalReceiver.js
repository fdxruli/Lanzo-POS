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
  }

  function stop() {
    generation++;
    dispose(active);
    active = null;
  }

  function start(context, onProbe = () => {}, onState = () => {}) {
    stop();
    const run = { generation, context: structuredClone(context), abort: new AbortController(),
      timers: new Set(), transport: null, token: null, attempts: 0, disposed: false, deadline: 0 };
    active = run;
    const current = () => active === run && generation === run.generation && !run.disposed;
    const later = (fn, ms) => {
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
    const recover = () => {
      if (!current()) return;
      closeTransport();
      if (++run.attempts > 5 || (run.deadline && now() >= run.deadline)) { terminal('stopped'); return; }
      onState('retrying');
      later(connect, Math.min(15000, 500 * 2 ** (run.attempts - 1)) * (0.8 + random() * 0.4));
    };
    async function connect() {
      if (!current()) return;
      let candidate;
      try {
        onState('authorizing');
        const result = await broker(run.context, { signal: run.abort.signal });
        if (!current()) return;
        if (!result.ok) {
          // Only transport, 429 and HTTP 5xx are recoverable. Unknown responses
          // and authorization failures stop this captured context permanently.
          if (result.status === 409 || result.status === 429 || result.status >= 500) recover();
          else terminal('denied');
          return;
        }
        const c = result.connection;
        const expiry = Math.min(c.grantExpiresAt, c.jwtExpiresAt);
        if (!c.accessToken || !c.topic?.startsWith('ecom:qa-probe:1a2:') || !Number.isFinite(expiry) || expiry <= now() + 5000) {
          terminal('denied'); return;
        }
        run.deadline = expiry;
        candidate = await createTransport(c.url, c.publicKey);
        if (!current()) { candidate.disconnect(); await candidate.removeAllChannels(); return; }
        closeTransport();
        run.transport = candidate;
        run.token = c.accessToken;
        await candidate.setAuth(run.token);
        if (!current()) return;
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
            onState('connected');
            later(() => { closeTransport(); connect(); }, Math.max(1000, expiry - now() - 30000));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Protocol Unauthorized is authoritative. Unknown CHANNEL_ERROR is
            // also terminal; transport timeouts/closures have bounded retries.
            if (status === 'CHANNEL_ERROR' || /unauthorized|invalid.*jwt|expired/i.test(error?.message ?? '')) terminal('denied');
            else recover();
          }
        });
        later(() => { if (now() >= expiry && run.transport === transport) terminal('expired'); }, expiry - now());
      } catch (error) {
        if (!current()) { if (candidate && candidate !== run.transport) candidate.disconnect(); return; }
        if (error?.name === 'AbortError') return;
        recover();
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
    const response = await fetcher(endpoint, { method: 'POST', signal,
      headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(capture) });
    return { ok: response.ok, status: response.status, connection: response.ok ? await response.json() : null };
  };
}
