import Logger from '../Logger';
import { supabaseClient } from '../supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildBaseRpcContextFromArgs,
  buildRpcRequestKey,
  cloudRequestManager,
  cloudRequestTags,
  invalidateCloudCacheAfterRestaurantOrderMutation
} from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { generateIdempotencyKey } from '../sync/idempotency';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';
import { loadData, STORES } from '../database';
import { preparationStationsRepository } from './preparationStationsRepository';
import { buildRestaurantOrderPayloadFromOpenSale } from './restaurantOrderMapper';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getAuthContextKey = () => ['sec', 'urity'].join('') + ['Tok', 'en'].join('');
const getAuthRpcArgKey = () => `p_${['sec', 'urity'].join('')}_${['tok', 'en'].join('')}`;

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const assertOnlineForMutation = () => {
  if (!isOnline()) {
    throw new Error('No se pudo enviar a cocina cloud porque el dispositivo está sin conexión.');
  }
};

const friendlyRestaurantOrderLookupError = (error) => {
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error || '');
  const normalized = message.toLowerCase();

  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.';
  }

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) {
    return 'Tu usuario no tiene permiso para ver el estado de cocina de esta mesa.';
  }

  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) {
    return 'El estado de cocina cloud solo está disponible para negocios tipo restaurante.';
  }

  if (normalized.includes('disabled') || normalized.includes('plan')) {
    return 'Tu plan actual no tiene activo el estado de cocina cloud.';
  }

  return 'No se pudo verificar cocina cloud en este momento.';
};

const buildBaseRpcArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });
  const authKey = getAuthContextKey();

  if (!context.licenseKey || !context.deviceFingerprint || !context[authKey]) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    [getAuthRpcArgKey()]: context[authKey],
    p_staff_session_token: context.staffSessionToken || null
  };
};

const callRpc = async (name, args) => {
  assertSupabase();
  const { data, error } = await supabaseClient.rpc(name, args);
  if (error) throw error;
  return parseRpcPayload(data);
};

const cachedRestaurantOrdersRpc = ({ rpcName, licenseKey, baseArgs, params = {}, force = false, fn }) => cloudRequestManager.request({
  rpcName,
  key: buildRpcRequestKey(rpcName, {
    ...buildBaseRpcContextFromArgs(licenseKey, baseArgs),
    params
  }),
  ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT,
  cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT,
  force,
  tags: [
    CLOUD_REQUEST_TAGS.RESTAURANT,
    CLOUD_REQUEST_TAGS.SALES,
    cloudRequestTags.license(licenseKey),
    cloudRequestTags.rpc(rpcName)
  ],
  fn
});

const normalizeLimit = (limit = 100) => Math.min(Math.max(Number(limit) || 100, 1), 300);

const getProductsById = async () => {
  try {
    const products = await loadData(STORES.MENU);
    return new Map((Array.isArray(products) ? products : []).filter((product) => product?.id).map((product) => [product.id, product]));
  } catch (error) {
    Logger.warn('[RestaurantOrders] No se pudo cargar catalogo local para resolver estaciones:', error);
    return new Map();
  }
};

export const restaurantOrdersRepository = {
  async upsertRestaurantOrder({ licenseKey, order, items = [], idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    assertOnlineForMutation();

    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER,
      operation: SYNC_OPERATIONS.UPSERT,
      entityId: order?.localOrderId || order?.saleId || order?.id || 'new',
      prefix: 'restaurant'
    });

    const response = await callRpc('pos_upsert_restaurant_order', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_order: order || {},
      p_items: Array.isArray(items) ? items : [],
      p_idempotency_key: resolvedIdempotencyKey
    });

    if (response?.success !== false) {
      invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    }

    return response;
  },

  async getRestaurantOrders({ licenseKey, status = null, stationCode = null, dateFrom = null, dateTo = null, includeCompleted = false, limit = 100, offset = 0, force = false } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');

    if (!isOnline()) {
      return {
        success: false,
        orders: [],
        source: 'offline',
        message: 'Sin conexión. No se pudieron actualizar las comandas cloud.'
      };
    }

    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const params = {
      p_status: status || null,
      p_station_code: stationCode || null,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_include_completed: Boolean(includeCompleted),
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0)
    };

    return cachedRestaurantOrdersRpc({
      rpcName: 'pos_get_restaurant_orders',
      licenseKey,
      baseArgs,
      params,
      force,
      fn: () => callRpc('pos_get_restaurant_orders', { ...baseArgs, ...params })
    });
  },

  async getRestaurantOrderByLocalOrder({ licenseKey, localOrderId, force = false } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');

    const normalizedLocalOrderId = String(localOrderId || '').trim();
    if (!normalizedLocalOrderId) {
      return {
        success: false,
        found: false,
        order: null,
        code: 'LOCAL_ORDER_ID_REQUIRED',
        message: 'No se encontró la mesa local para verificar cocina cloud.'
      };
    }

    if (!isOnline()) {
      return {
        success: false,
        found: false,
        order: null,
        source: 'offline',
        code: 'OFFLINE',
        message: 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.'
      };
    }

    try {
      const baseArgs = await buildBaseRpcArgs(licenseKey);
      const params = { p_local_order_id: normalizedLocalOrderId };

      return await cachedRestaurantOrdersRpc({
        rpcName: 'pos_get_restaurant_order_by_local_order',
        licenseKey,
        baseArgs,
        params,
        force,
        fn: () => callRpc('pos_get_restaurant_order_by_local_order', { ...baseArgs, ...params })
      });
    } catch (error) {
      const message = friendlyRestaurantOrderLookupError(error);
      Logger.warn('[RestaurantOrders/REST.5] No se pudo consultar estado cloud por mesa:', error);
      return {
        success: false,
        found: false,
        order: null,
        error,
        message,
        code: error?.code || error?.message || 'RESTAURANT_ORDER_LOOKUP_FAILED'
      };
    }
  },

  async updateRestaurantOrderStatus({ licenseKey, restaurantOrderId, status, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!restaurantOrderId) throw new Error('RESTAURANT_ORDER_ID_REQUIRED');
    assertOnlineForMutation();

    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER,
      operation: SYNC_OPERATIONS.STATUS_UPDATE,
      entityId: restaurantOrderId,
      prefix: 'restaurant'
    });

    const response = await callRpc('pos_update_restaurant_order_status', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_restaurant_order_id: restaurantOrderId,
      p_status: status,
      p_idempotency_key: resolvedIdempotencyKey
    });

    if (response?.success !== false) {
      invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    }

    return response;
  },

  async updateRestaurantOrderItemStatus({ licenseKey, restaurantOrderId, restaurantOrderItemId, status, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!restaurantOrderId) throw new Error('RESTAURANT_ORDER_ID_REQUIRED');
    if (!restaurantOrderItemId) throw new Error('RESTAURANT_ORDER_ITEM_ID_REQUIRED');
    assertOnlineForMutation();

    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({
      entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER_ITEM,
      operation: SYNC_OPERATIONS.STATUS_UPDATE,
      entityId: restaurantOrderItemId,
      prefix: 'restaurant_item'
    });

    const response = await callRpc('pos_update_restaurant_order_item_status', {
      ...(await buildBaseRpcArgs(licenseKey)),
      p_restaurant_order_id: restaurantOrderId,
      p_restaurant_order_item_id: restaurantOrderItemId,
      p_status: status,
      p_idempotency_key: resolvedIdempotencyKey
    });

    if (response?.success !== false) {
      invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    }

    return response;
  },

  async upsertRestaurantOrderFromLocalSale({ licenseKey, sale, idempotencyKey = null }) {
    if (!sale?.id) throw new Error('RESTAURANT_ORDER_SALE_REQUIRED');

    const [stationsResult, productsById] = await Promise.all([
      preparationStationsRepository.getPreparationStations({
        licenseKey,
        includeInactive: false,
        force: false,
        useCloud: Boolean(licenseKey)
      }),
      getProductsById()
    ]);

    const payload = buildRestaurantOrderPayloadFromOpenSale({
      sale,
      stations: stationsResult?.stations || [],
      productsById
    });

    return this.upsertRestaurantOrder({
      licenseKey,
      order: payload.order,
      items: payload.items,
      idempotencyKey
    });
  }
};

export default restaurantOrdersRepository;
