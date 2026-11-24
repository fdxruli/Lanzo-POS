import { supabaseClient } from './supabase';
import Logger from './Logger';
import { SYNC_STATUS } from './sync/syncConstants';
import {
  createScopedPosRealtimeListener,
  stopScopedPosRealtimeListener
} from './sync/scopedPosRealtimeListener';

let scopedListener = null;
let scopedOwner = null;
let legacyStarted = false;

let activeChannel = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let isConnecting = false;
let onlineListener = null;
let legacyEpoch = 0;
let legacyAttempt = 0;
let reconnectTimerEpoch = null;
let onlineListenerEpoch = null;
const legacyChannels = new Set();
const channelEpochs = new WeakMap();
const retiringChannels = new WeakMap();

const closingChannels = new WeakSet();
const handledClosedChannels = new WeakSet();

const BASE_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60_000;

export const buildPosRealtimeTopic = (licenseDetailsOrTopic = null) => {
  const sourceTopic = typeof licenseDetailsOrTopic === 'string'
    ? licenseDetailsOrTopic
    : licenseDetailsOrTopic?.pos_realtime_topic ||
      licenseDetailsOrTopic?.posRealtimeTopic ||
      licenseDetailsOrTopic?.realtime_topic ||
      licenseDetailsOrTopic?.details?.realtime_topic ||
      null;

  if (!sourceTopic) return null;
  if (sourceTopic.startsWith('pos:')) return sourceTopic;
  if (sourceTopic.startsWith('license:')) {
    const [, suffix] = sourceTopic.split(':');
    return suffix ? `pos:${suffix}` : null;
  }

  return null;
};

const notifyStatus = (callbacks = {}, status, extra = {}) => {
  callbacks.onStatusChange?.({ status, ...extra });
};

export const startPosRealtimeListener = (options = {}) => {
  const { executionScope: owner, posTopic, licenseDetails, callbacks = {} } = options;
  if (owner) {
    owner.assertAdmission();
    if (legacyStarted) throw new Error('SYNC_EXECUTION_LEGACY_OWNER_ACTIVE');
    if (scopedOwner && scopedOwner !== owner && scopedOwner.getSnapshot().state !== 'DRAINED') {
      throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
    }
    if (scopedOwner === owner) {
      const status = scopedListener.getStatus();
      if (status.stopped || status.topic !== (posTopic || buildPosRealtimeTopic(licenseDetails))) {
        throw new Error('POS_REALTIME_GENERATION_RESTART_REQUIRED');
      }
      return scopedListener;
    }
    scopedOwner = owner;
    scopedListener = createScopedPosRealtimeListener({
      client: supabaseClient, topic: posTopic || buildPosRealtimeTopic(licenseDetails), callbacks, owner
    });
    return scopedListener;
  }
  if (scopedOwner && scopedOwner.getSnapshot().state !== 'DRAINED') {
    throw new Error('SYNC_EXECUTION_OWNER_MISMATCH');
  }
  legacyStarted = true;
  return startLegacyPosRealtimeListener({ ...options, epoch: ++legacyEpoch });
};

const startLegacyPosRealtimeListener = ({ posTopic, licenseDetails, callbacks = {}, epoch = legacyEpoch } = {}) => {
  if (epoch !== legacyEpoch) return null;
  const resolvedTopic = posTopic || buildPosRealtimeTopic(licenseDetails);

  if (!supabaseClient) {
    Logger.warn('[PosRealtime] Supabase no esta configurado. POS sync queda degradado.');
    notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'supabase_not_configured' });
    return null;
  }

  if (!resolvedTopic) {
    Logger.warn('[PosRealtime] Falta topic privado POS. POS sync seguirá con pull manual/intervalos futuros.');
    notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'missing_pos_topic' });
    return null;
  }

  if (isConnecting || reconnectTimer || onlineListener || activeChannel) {
    return activeChannel;
  }

  const attempt = ++legacyAttempt;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    Logger.warn('[PosRealtime] Sin conexión. Esperando reconexión para POS realtime.');
    notifyStatus(callbacks, SYNC_STATUS.OFFLINE, { reason: 'offline' });
    scheduleReconnect(resolvedTopic, callbacks, epoch);
    return null;
  }

  isConnecting = true;
  notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason: 'connecting' });
  if (epoch !== legacyEpoch) {
    isConnecting = false;
    return null;
  }

  const channel = supabaseClient
    .channel(resolvedTopic, {
      config: { private: true }
    })
    .on('broadcast', { event: 'pos_event' }, (payload) => {
      if (epoch !== legacyEpoch || attempt !== legacyAttempt
        || channelEpochs.get(channel) !== epoch || handledClosedChannels.has(channel)) return;
      const event = payload?.payload || payload || {};
      const changeSeq = event?.change_seq ?? event?.changeSeq ?? null;
      const entity = event?.entity_type ?? event?.entityType ?? event?.entity ?? null;
      const eventType = event?.event_type ?? event?.eventType ?? event?.operation ?? null;

      Logger.log('[PosRealtime] Aviso POS recibido. Se debe hacer pull incremental.', changeSeq || 'sin_seq');
      callbacks.onPosChangeAvailable?.({
        source: 'realtime',
        eventType,
        entity,
        changeSeq,
        event
      });
    });
  legacyChannels.add(channel);
  channelEpochs.set(channel, epoch);
  let subscribed = false;
  const retireAndReconnect = async (reason) => {
    if (handledClosedChannels.has(channel)) return;
    handledClosedChannels.add(channel);
    const wasManualClose = closingChannels.has(channel);
    closingChannels.delete(channel);
    isConnecting = false;
    if (activeChannel === channel) activeChannel = null;
    const retirement = retireLegacyChannel(channel);
    if (!wasManualClose) {
      if (reason === 'closed') Logger.warn('[PosRealtime] Canal POS cerrado inesperadamente.');
      notifyStatus(callbacks, SYNC_STATUS.DEGRADED, { reason });
    }
    try {
      await retirement;
    } catch (error) {
      Logger.warn('[PosRealtime] No se pudo retirar el canal POS; se reintentará:', error);
      if (!wasManualClose && epoch === legacyEpoch && attempt === legacyAttempt) {
        scheduleReconnect(resolvedTopic, callbacks, epoch, { cleanupChannel: channel });
      }
      return;
    }
    if (!wasManualClose && epoch === legacyEpoch && attempt === legacyAttempt) {
      scheduleReconnect(resolvedTopic, callbacks, epoch);
    }
  };

  channel.subscribe((status, error) => {
    if (epoch !== legacyEpoch || attempt !== legacyAttempt
      || channelEpochs.get(channel) !== epoch || handledClosedChannels.has(channel)) return;
    if (status === 'SUBSCRIBED') {
      if (subscribed) return;
      subscribed = true;
      isConnecting = false;
      activeChannel = channel;
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectTimerEpoch = null;
      }
      Logger.log('[PosRealtime] Canal POS privado conectado.');
      notifyStatus(callbacks, SYNC_STATUS.ONLINE, { reason: 'subscribed' });
      callbacks.onConnectionRestored?.();
      return;
    }

    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      Logger.warn('[PosRealtime] Error de canal POS:', error, { diagnosticOperation: 'sync.realtime', diagnosticState: status });
      void retireAndReconnect(status).catch(error => {
        Logger.warn('[PosRealtime] No se pudo retirar el canal POS fallido:', error);
      });
      return;
    }

    if (status === 'CLOSED') {
      void retireAndReconnect('closed').catch(error => {
        Logger.warn('[PosRealtime] No se pudo retirar el canal POS cerrado:', error);
      });
    }
  });

  return channel;
};

const retireLegacyChannel = channel => {
  if (retiringChannels.has(channel)) return retiringChannels.get(channel);
  closingChannels.add(channel);
  const pending = Promise.resolve()
    .then(() => supabaseClient?.removeChannel(channel))
    .then(result => {
      if (result !== 'ok' && result !== 'timed out') {
        throw new Error(`POS_REALTIME_CLEANUP_${result}`);
      }
      legacyChannels.delete(channel);
    })
    .catch(error => {
      retiringChannels.delete(channel);
      throw error;
    });
  retiringChannels.set(channel, pending);
  return pending;
};

const scheduleReconnect = (posTopic, callbacks = {}, epoch = legacyEpoch, { cleanupChannel = null } = {}) => {
  if (epoch !== legacyEpoch || reconnectTimer || onlineListener) return;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const listener = () => {
      if (onlineListener !== listener || epoch !== legacyEpoch) return;
      window.removeEventListener('online', listener);
      onlineListener = null;
      onlineListenerEpoch = null;
      reconnectAttempts = 0;
      Logger.log('[PosRealtime] Red recuperada. Reconectando POS realtime.');
      if (cleanupChannel) {
        scheduleReconnect(posTopic, callbacks, epoch, { cleanupChannel });
      } else {
        startLegacyPosRealtimeListener({ posTopic, callbacks, epoch });
      }
    };
    onlineListener = listener;
    onlineListenerEpoch = epoch;
    window.addEventListener('online', listener);
    notifyStatus(callbacks, SYNC_STATUS.OFFLINE, { reason: 'offline_waiting_online' });
    return;
  }

  const backoffStep = Math.min(reconnectAttempts, 5);
  const delay = Math.min(MAX_RECONNECT_DELAY, BASE_RECONNECT_DELAY * 2 ** backoffStep);
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    reconnectTimerEpoch = null;
    if (epoch !== legacyEpoch) return;
    if (cleanupChannel) {
      try {
        await retireLegacyChannel(cleanupChannel);
      } catch (error) {
        Logger.warn('[PosRealtime] El retiro sigue pendiente; se reintentará:', error);
        if (epoch === legacyEpoch) scheduleReconnect(posTopic, callbacks, epoch, { cleanupChannel });
        return;
      }
      if (epoch !== legacyEpoch) return;
    }
    startLegacyPosRealtimeListener({ posTopic, callbacks, epoch });
  }, delay);
  reconnectTimerEpoch = epoch;
};

export const stopPosRealtimeListener = async (channel = activeChannel) => {
  const ownedStop = stopScopedPosRealtimeListener(channel);
  if (ownedStop) return ownedStop;
  if (!channel && scopedListener && scopedOwner?.getSnapshot().state !== 'DRAINED') {
    return stopScopedPosRealtimeListener(scopedListener);
  }
  const epoch = channel ? channelEpochs.get(channel) ?? legacyEpoch : legacyEpoch;
  const stoppingCurrentEpoch = epoch === legacyEpoch;
  if (stoppingCurrentEpoch) legacyEpoch += 1;

  if (reconnectTimer && reconnectTimerEpoch === epoch) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectTimerEpoch = null;
  }

  if (onlineListener && onlineListenerEpoch === epoch) {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
    onlineListenerEpoch = null;
  }

  const channelsToStop = new Set([...legacyChannels].filter(item => channelEpochs.get(item) === epoch));
  if (channel && (!channelEpochs.has(channel) || channelEpochs.get(channel) === epoch)) channelsToStop.add(channel);
  if (stoppingCurrentEpoch) {
    isConnecting = false;
    reconnectAttempts = 0;
    if (activeChannel && channelEpochs.get(activeChannel) === epoch) activeChannel = null;
  }

  await Promise.allSettled([...channelsToStop].map(retireLegacyChannel));
};

export const getPosRealtimeStatus = () => scopedOwner && !legacyStarted ? scopedListener.getStatus() : ({
  isActive: Boolean(activeChannel),
  isConnecting,
  reconnectAttempts
});
