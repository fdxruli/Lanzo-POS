// The WeakMap attests handles created by this implementation, not a provider's
// self-declared version/flag. Neither the handle nor its scope grants authority.
const handles = new WeakMap();
export const ownsScopedPosRealtimeListener = (handle, owner) => (
  Boolean(handle && owner && handles.get(handle)?.owner === owner)
);
export const stopScopedPosRealtimeListener = handle => handles.get(handle)?.stop();

export const createScopedPosRealtimeListener = ({ client, topic, callbacks, owner }) => {
  owner.assertAdmission();
  let stopped = false, current = null, connecting = false, attempts = 0;
  let timer = null, online = null;
  const channels = new Set(), retiring = new WeakMap();
  const allowed = () => !stopped && owner.isContextCurrent() && owner.getSnapshot().accepting;
  const observe = (label, factory) => {
    if (!allowed()) return;
    try {
      const task = owner.run(`pos_realtime:${label}`, factory);
      task.catch(() => {}); // The scope retains rejected work and cleanup failures.
      return task;
    } catch { return undefined; }
  };
  const notify = async (name, value) => {
    if (!allowed()) return;
    // Await callback results as well as synchronous effects. Detached work from
    // an unknown caller still needs its own contract, as in the orchestrator.
    await callbacks[name]?.(value);
  };
  const retire = channel => {
    if (retiring.has(channel)) return retiring.get(channel);
    // The caller is an observed callback/connect task or registered cleanup.
    // Install the promise before invoking the transport (it may call back).
    const pending = Promise.resolve().then(async () => {
      const result = await client.removeChannel(channel);
      if (result !== 'ok' && result !== 'timed out') {
        throw new Error(`POS_REALTIME_CLEANUP_${result}`);
      }
    });
    retiring.set(channel, pending);
    pending.then(() => channels.delete(channel), () => channels.delete(channel));
    pending.catch(() => owner.markUnobservable('pos_realtime_channel_cleanup_failed'));
    return pending;
  };
  const clearSources = () => {
    timer?.cancel(); timer = null;
    if (online) window.removeEventListener('online', online);
    online = null;
  };
  const stop = () => {
    // Fence callbacks and remove scheduling synchronously, before teardown awaits.
    stopped = true; connecting = false; current = null;
    clearSources();
    return source.stop();
  };
  const reconnect = () => {
    if (!allowed() || timer || online) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const listener = () => {
        if (online !== listener || !allowed()) return;
        window.removeEventListener('online', listener); online = null;
        attempts = 0;
        observe('online', connect);
      };
      online = listener;
      window.addEventListener('online', listener);
      return;
    }
    if (attempts >= 5) return;
    timer = owner.schedule('pos_realtime:reconnect', token => {
      timer = null;
      if (allowed()) return connect(token);
    }, 3000 * 2 ** attempts++);
  };
  const connect = async () => {
    if (!allowed() || connecting) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      reconnect();
      await notify('onStatusChange', { status: 'offline', reason: 'offline_waiting_online' });
      return;
    }
    if (!client || !topic) {
      await notify('onStatusChange', { status: 'degraded', reason: client ? 'missing_pos_topic' : 'supabase_not_configured' });
      return;
    }
    connecting = true;
    await notify('onStatusChange', { status: 'degraded', reason: 'connecting' });
    if (!allowed()) return;
    // Capture before subscribe: some transports synchronously publish status.
    const channel = client.channel(topic, { config: { private: true } });
    channels.add(channel); current = channel;
    const channelCurrent = () => allowed() && current === channel && !retiring.has(channel);
    channel.on('broadcast', { event: 'pos_event' }, payload => {
      if (!channelCurrent()) return;
      observe('broadcast', async () => {
        if (!channelCurrent()) return;
        const event = payload?.payload || payload || {};
        await notify('onPosChangeAvailable', {
          source: 'realtime', event,
          changeSeq: event.change_seq ?? event.changeSeq ?? null,
          entity: event.entity_type ?? event.entityType ?? event.entity ?? null,
          eventType: event.event_type ?? event.eventType ?? event.operation ?? null
        });
      });
    });
    channel.subscribe(status => {
      if (!channelCurrent()) return;
      observe('status', async () => {
        if (!channelCurrent()) return;
        if (status === 'SUBSCRIBED') {
          connecting = false; attempts = 0;
          timer?.cancel(); timer = null;
          await notify('onStatusChange', { status: 'online', reason: 'subscribed' });
          if (channelCurrent()) await notify('onConnectionRestored');
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          connecting = false; current = null;
          // Reconnect cannot overtake retirement. If stop arrives while removal
          // is pending, this task remains observed and reconnect is fenced.
          await retire(channel);
          if (!allowed()) return;
          reconnect();
          await notify('onStatusChange', { status: 'degraded', reason: status });
        }
      });
    });
  };
  const source = owner.addSource('pos_realtime', () => {
    stopped = true; connecting = false; current = null; clearSources();
    // allSettled preserves every retirement even if one cleanup rejects early.
    return Promise.allSettled([...channels].map(retire)).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('POS_REALTIME_CLEANUP_FAILED');
    });
  });
  const handle = Object.freeze({ stop, getStatus: () => ({
    isActive: Boolean(current) && !connecting && !stopped,
    isConnecting: connecting, reconnectAttempts: attempts, stopped, topic
  }) });
  handles.set(handle, { owner, stop });
  observe('connect', connect);
  return handle;
};
