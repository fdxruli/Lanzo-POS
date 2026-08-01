import Logger from '../Logger';
import { isDatabaseRecoveryPending } from '../db/databaseRecoveryState';
import { PRODUCT_SYNC_EVENT } from './productConstants';

const CHANNEL_NAME = 'product-store-invalidation';
const DEEP_SLEEP_THRESHOLD_MS = 60_000;
const AWAY_THRESHOLD_MS = 30_000;

const subscribers = new Set();
let broadcastChannel = null;
let infrastructureInstalled = false;
let lastAwayAt = 0;
let lastNotificationAt = 0;

const listeners = {};

const notifySubscribers = (source, detail = null) => {
  lastNotificationAt = Date.now();
  for (const subscriber of [...subscribers]) {
    try {
      subscriber({ source, detail });
    } catch (error) {
      Logger.warn('[ProductCatalogEvents] Un suscriptor no pudo procesar el cambio:', error);
    }
  }
};

const markAsAway = () => {
  if (!lastAwayAt) lastAwayAt = Date.now();
};

const notifyWakeUp = (source, force = false) => {
  if (isDatabaseRecoveryPending()) {
    lastAwayAt = 0;
    Logger.debug(`[ProductCatalogEvents] Wake-up omitido (${source}): recuperación local pendiente.`);
    return;
  }

  const timeAway = lastAwayAt ? Date.now() - lastAwayAt : 0;
  lastAwayAt = 0;
  if (!force && timeAway > 0 && timeAway < AWAY_THRESHOLD_MS) return;
  notifySubscribers(source, { timeAway });
};

const installInfrastructure = () => {
  if (infrastructureInstalled || typeof window === 'undefined') return;
  infrastructureInstalled = true;

  listeners.productsSync = (event) => {
    notifySubscribers(PRODUCT_SYNC_EVENT, event.detail);
  };
  listeners.visibility = () => {
    if (document.visibilityState === 'hidden') markAsAway();
    else if (document.visibilityState === 'visible') notifyWakeUp('visibilitychange');
  };
  listeners.blur = markAsAway;
  listeners.focus = () => {
    if (document.visibilityState === 'visible') notifyWakeUp('focus');
  };
  listeners.pageshow = (event) => {
    if (event.persisted) {
      notifyWakeUp('pageshow(persisted)', true);
    } else if (Date.now() - lastNotificationAt > DEEP_SLEEP_THRESHOLD_MS) {
      notifyWakeUp('pageshow(deep-sleep)', true);
    }
  };

  window.addEventListener(PRODUCT_SYNC_EVENT, listeners.productsSync);
  document.addEventListener('visibilitychange', listeners.visibility);
  window.addEventListener('blur', listeners.blur);
  window.addEventListener('focus', listeners.focus);
  window.addEventListener('pageshow', listeners.pageshow);

  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    listeners.broadcast = (event) => {
      if (event.data?.type === 'db-changed') {
        notifySubscribers('BroadcastChannel:db-changed', event.data);
      }
    };
    broadcastChannel.addEventListener('message', listeners.broadcast);
  } catch (error) {
    Logger.warn('[ProductCatalogEvents] BroadcastChannel no soportado:', error);
  }
};

const uninstallInfrastructure = () => {
  if (!infrastructureInstalled || typeof window === 'undefined') return;
  infrastructureInstalled = false;

  window.removeEventListener(PRODUCT_SYNC_EVENT, listeners.productsSync);
  document.removeEventListener('visibilitychange', listeners.visibility);
  window.removeEventListener('blur', listeners.blur);
  window.removeEventListener('focus', listeners.focus);
  window.removeEventListener('pageshow', listeners.pageshow);
  if (broadcastChannel && listeners.broadcast) {
    broadcastChannel.removeEventListener('message', listeners.broadcast);
  }
  broadcastChannel?.close();
  broadcastChannel = null;
  lastAwayAt = 0;
  Object.keys(listeners).forEach((key) => delete listeners[key]);
};

export const subscribeProductCatalogEvents = (subscriber) => {
  if (typeof subscriber !== 'function') return () => {};
  subscribers.add(subscriber);
  installInfrastructure();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) uninstallInfrastructure();
  };
};

export const broadcastDBChange = (metadata = {}) => {
  const payload = { type: 'db-changed', timestamp: Date.now(), metadata };
  notifySubscribers('broadcastDBChange', payload);

  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    if (broadcastChannel) {
      broadcastChannel.postMessage(payload);
      return;
    }
    const temporaryChannel = new BroadcastChannel(CHANNEL_NAME);
    temporaryChannel.postMessage(payload);
    setTimeout(() => temporaryChannel.close(), 0);
  } catch (error) {
    Logger.warn('[ProductCatalogEvents] No se pudo emitir el cambio:', error);
  }
};

export const getProductCatalogEventsDiagnostics = () => ({
  subscriberCount: subscribers.size,
  infrastructureInstalled,
  hasBroadcastChannel: Boolean(broadcastChannel)
});

export const resetProductCatalogEventsForTests = () => {
  subscribers.clear();
  uninstallInfrastructure();
  lastNotificationAt = 0;
};

