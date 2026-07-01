import Logger from '../Logger';
import { supabaseClient } from '../supabase';
import { loadData, saveData, STORES } from '../database';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterRestaurantConfigMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { generateIdempotencyKey } from '../sync/idempotency';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';

export const FALLBACK_PREPARATION_STATIONS = Object.freeze([
  Object.freeze({
    id: 'station_kitchen',
    code: 'kitchen',
    name: 'Cocina',
    sortOrder: 0,
    isDefault: true,
    isActive: true,
    serverVersion: 1,
    updatedAt: null
  })
]);

const CACHE_PREFIX = 'preparation_stations:';
const nowIso = () => new Date().toISOString();
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const cacheKey = (licenseKey) => `${CACHE_PREFIX}${licenseKey || 'local'}`;

export const getFallbackPreparationStations = () => FALLBACK_PREPARATION_STATIONS.map((station) => ({ ...station }));

const normalizeStation = (station = {}) => ({
  id: station.id || station.code || 'station_kitchen',
  code: String(station.code || 'kitchen').trim() || 'kitchen',
  name: String(station.name || 'Cocina').trim() || 'Cocina',
  sortOrder: Number(station.sortOrder ?? station.sort_order ?? 0) || 0,
  isDefault: station.isDefault ?? station.is_default ?? false,
  isActive: station.isActive ?? station.is_active ?? true,
  serverVersion: Number(station.serverVersion ?? station.server_version ?? 1) || 1,
  updatedAt: station.updatedAt || station.updated_at || null
});

const normalizeStations = (stations = []) => {
  const normalized = (Array.isArray(stations) ? stations : [])
    .map(normalizeStation)
    .filter((station) => station.code && station.name)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));

  return normalized.length > 0 ? normalized : getFallbackPreparationStations();
};

const readCachedStations = async (licenseKey) => {
  try {
    const record = await loadData(STORES.SYNC_CACHE, cacheKey(licenseKey));
    return normalizeStations(record?.value?.stations || []);
  } catch (error) {
    Logger.warn('[PreparationStations] No se pudo leer cache local:', error);
    return null;
  }
};

const writeCachedStations = async (licenseKey, stations) => {
  if (!licenseKey) return;
  try {
    await saveData(STORES.SYNC_CACHE, {
      key: cacheKey(licenseKey),
      value: {
        stations: normalizeStations(stations),
        updatedAt: nowIso()
      },
      updatedAt: nowIso()
    });
  } catch (error) {
    Logger.warn('[PreparationStations] No se pudo guardar cache local:', error);
  }
};

const buildBaseRpcArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });

  if (!context.licenseKey || !context.deviceFingerprint || !context.securityToken) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    p_security_token: context.securityToken,
    p_staff_session_token: context.staffSessionToken || null
  };
};

const callRpc = async (name, args) => {
  assertSupabase();
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return parseRpcPayload(data);
};

const cachedStationsRpc = ({ rpcName, licenseKey, baseArgs, params = {}, force = false, fn }) => cloudRequestManager.request({
  rpcName,
  key: buildRpcRequestKey(rpcName, {
    ...buildBaseRpcContextFromArgs(licenseKey, baseArgs),
    params
  }),
  ttlMs: CLOUD_REQUEST_TTL.MEDIUM,
  cooldownMs: CLOUD_REQUEST_COOLDOWN.SNAPSHOT,
  force,
  tags: [
    CLOUD_REQUEST_TAGS.RESTAURANT,
    CLOUD_REQUEST_TAGS.PRODUCTS,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName)
  ],
  fn
});

export const preparationStationsRepository = {
  getFallbackPreparationStations,

  async getPreparationStations({ licenseKey, includeInactive = false, force = false, useCloud = false } = {}) {
    if (!useCloud || !licenseKey) {
      return {
        success: true,
        stations: getFallbackPreparationStations(),
        source: 'fallback'
      };
    }

    if (!isOnline()) {
      const cached = await readCachedStations(licenseKey);
      return {
        success: false,
        stations: cached || getFallbackPreparationStations(),
        source: cached ? 'cache' : 'fallback',
        fromCache: Boolean(cached),
        message: 'Sin conexion. Se usaran las areas guardadas o Cocina.'
      };
    }

    try {
      const baseArgs = await buildBaseRpcArgs(licenseKey);
      const params = { p_include_inactive: Boolean(includeInactive) };
      const payload = await cachedStationsRpc({
        rpcName: 'pos_get_preparation_stations',
        licenseKey,
        baseArgs,
        params,
        force,
        fn: () => callRpc('pos_get_preparation_stations', {
          ...baseArgs,
          ...params
        })
      });

      const stations = normalizeStations(payload?.stations);
      await writeCachedStations(licenseKey, stations);

      return {
        success: payload?.success !== false,
        stations,
        source: payload?.source || 'cloud',
        raw: payload
      };
    } catch (error) {
      Logger.warn('[PreparationStations] Lectura cloud fallo:', error);
      const cached = await readCachedStations(licenseKey);
      return {
        success: false,
        stations: cached || getFallbackPreparationStations(),
        source: cached ? 'cache' : 'fallback',
        fromCache: Boolean(cached),
        error,
        message: 'No se pudieron actualizar las areas de preparacion.'
      };
    }
  },

  async upsertPreparationStation({ licenseKey, station, expectedVersion = null, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    const response = await callRpc('pos_upsert_preparation_station', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_station: station,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey || generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.PREPARATION_STATION,
        operation: SYNC_OPERATIONS.UPSERT,
        entityId: station?.id || station?.code || 'new',
        prefix: 'restaurant'
      })
    });

    if (response?.success !== false) {
      invalidateCloudCacheAfterRestaurantConfigMutation(licenseKey);
      if (response?.stations) await writeCachedStations(licenseKey, response.stations);
    }

    return response;
  },

  async togglePreparationStation({ licenseKey, stationId, isActive, expectedVersion = null, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    const response = await callRpc('pos_toggle_preparation_station', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_station_id: stationId,
      p_is_active: Boolean(isActive),
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey || generateIdempotencyKey({
        entityType: SYNC_ENTITY_TYPES.PREPARATION_STATION,
        operation: SYNC_OPERATIONS.TOGGLE_STATUS,
        entityId: stationId,
        prefix: 'restaurant'
      })
    });

    if (response?.success !== false) {
      invalidateCloudCacheAfterRestaurantConfigMutation(licenseKey);
      if (response?.stations) await writeCachedStations(licenseKey, response.stations);
    }

    return response;
  }
};

export default preparationStationsRepository;
