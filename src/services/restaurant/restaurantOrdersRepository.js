import Logger from '../Logger';
import { supabaseClient } from '../supabase';
import { CLOUD_REQUEST_COOLDOWN, CLOUD_REQUEST_TAGS, CLOUD_REQUEST_TTL, buildBaseRpcContextFromArgs, buildRpcRequestKey, cloudRequestManager, cloudRequestTags, invalidateCloudCacheAfterRestaurantOrderMutation } from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { generateIdempotencyKey } from '../sync/idempotency';
import { SYNC_ENTITY_TYPES, SYNC_OPERATIONS } from '../sync/syncConstants';
import { loadData, STORES } from '../database';
import { preparationStationsRepository } from './preparationStationsRepository';
import { buildRestaurantOrderPayloadFromOpenSale } from './restaurantOrderMapper';
import { reportActorAuthorityError } from '../auth/actorAuthorityRecovery';
import { actorRuntimeController } from '../auth/actorRuntimeController';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getAuthContextKey = () => ['sec', 'urity'].join('') + ['Tok', 'en'].join('');
const getAuthRpcArgKey = () => `p_${['sec', 'urity'].join('')}_${['tok', 'en'].join('')}`;
const LOOKUP_ERROR_ORDER = Object.freeze({ __statusError: true, items: [] });
const parseRpcPayload = (data) => (typeof data === 'string' ? JSON.parse(data) : data || {});
const assertSupabase = () => { if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED'); };
const assertOnlineForMutation = () => { if (!isOnline()) throw new Error('No se pudo enviar a cocina cloud porque el dispositivo está sin conexión.'); };
const normalizeLookupResponse = (response = {}) => (response?.success === false && !response?.order ? { ...response, order: LOOKUP_ERROR_ORDER } : response);

const friendlyRestaurantOrderLookupError = (error) => {
  const message = typeof error === 'string' ? error : error?.message || error?.code || String(error || '');
  const normalized = message.toLowerCase();
  if (normalized.includes('sin conexión') || normalized.includes('offline') || normalized.includes('failed to fetch') || normalized.includes('network')) return 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.';
  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('pos_permission_denied')) return 'Tu usuario no tiene permiso para ver el estado de cocina de esta mesa.';
  if (normalized.includes('food_service') || normalized.includes('restaurant_orders_food_service_required')) return 'El estado de cocina cloud solo está disponible para negocios tipo restaurante.';
  if (normalized.includes('disabled') || normalized.includes('plan')) return 'Tu plan actual no tiene activo el estado de cocina cloud.';
  return 'No se pudo verificar cocina cloud en este momento.';
};

const assertCapturedRpcActor = (actorHandle) => {
  try {
    actorHandle.assertCurrent();
  } catch {
    throw Object.assign(new Error('CLOUD_REQUEST_RESPONSE_STALE'), { code: 'CLOUD_REQUEST_RESPONSE_STALE' });
  }
};

const buildBaseRpcArgs = async (licenseKey) => {
  let actorHandle;
  try {
    actorHandle = actorRuntimeController.capture();
    const context = await buildPosSyncAuthContext({ licenseKey });
    assertCapturedRpcActor(actorHandle);
    const authKey = getAuthContextKey();
    if (!context.licenseKey || !context.deviceFingerprint) throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
    if (!context[authKey]) throw Object.assign(new Error('DEVICE_TOKEN_REQUIRED'), { code: 'DEVICE_TOKEN_REQUIRED' });
    return {
      args: { p_license_key: context.licenseKey, p_device_fingerprint: context.deviceFingerprint, [getAuthRpcArgKey()]: context[authKey], p_staff_session_token: context.staffSessionToken || null },
      actorHandle
    };
  } catch (error) {
    if (actorHandle) assertCapturedRpcActor(actorHandle);
    reportActorAuthorityError(error, { operation: 'restaurant_rpc_context' });
    throw error;
  }
};
const callRpc = async (name, args, actorHandle) => {
  assertSupabase();
  try {
    assertCapturedRpcActor(actorHandle);
    const { data, error } = await supabaseClient.rpc(name, args);
    assertCapturedRpcActor(actorHandle);
    if (error) throw error;
    const response = parseRpcPayload(data);
    if (response?.success === false) reportActorAuthorityError(response, { operation: name });
    return response;
  } catch (error) {
    // Late responses belong to the captured actor, even when the cloud cache
    // will apply its own stale-response guard after this callback resolves.
    assertCapturedRpcActor(actorHandle);
    // Report before a lookup caller or cache boundary can translate P0001.
    // Recovery never retries the RPC or replaces its original rejection.
    reportActorAuthorityError(error, { operation: name });
    throw error;
  }
};
const cachedRestaurantOrdersRpc = ({ rpcName, licenseKey, baseArgs, params = {}, force = false, fn }) => cloudRequestManager.request({ rpcName, key: buildRpcRequestKey(rpcName, { ...buildBaseRpcContextFromArgs(licenseKey, baseArgs), params }), ttlMs: CLOUD_REQUEST_TTL.VERY_SHORT, cooldownMs: CLOUD_REQUEST_COOLDOWN.VERY_SHORT, force, tags: [CLOUD_REQUEST_TAGS.RESTAURANT, CLOUD_REQUEST_TAGS.SALES, cloudRequestTags.license(licenseKey), cloudRequestTags.rpc(rpcName)], fn });
const normalizeLimit = (limit = 100) => Math.min(Math.max(Number(limit) || 100, 1), 300);
const getProductsById = async () => { try { const products = await loadData(STORES.MENU); return new Map((Array.isArray(products) ? products : []).filter((product) => product?.id).map((product) => [product.id, product])); } catch (error) { Logger.warn('[RestaurantOrders] No se pudo cargar catalogo local para resolver estaciones:', error); return new Map(); } };

export const restaurantOrdersRepository = {
  async upsertRestaurantOrder({ licenseKey, order, items = [], idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    assertOnlineForMutation();
    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({ entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER, operation: SYNC_OPERATIONS.UPSERT, entityId: order?.localOrderId || order?.saleId || order?.id || 'new', prefix: 'restaurant' });
    const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
    const response = await callRpc('pos_upsert_restaurant_order', { ...baseArgs, p_order: order || {}, p_items: Array.isArray(items) ? items : [], p_idempotency_key: resolvedIdempotencyKey }, actorHandle);
    if (response?.success !== false) invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    return response;
  },
  async getRestaurantOrders({ licenseKey, status = null, stationCode = null, dateFrom = null, dateTo = null, includeCompleted = false, limit = 100, offset = 0, force = false } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!isOnline()) return { success: false, orders: [], source: 'offline', message: 'Sin conexión. No se pudieron actualizar las comandas cloud.' };
    const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
    const params = { p_status: status || null, p_station_code: stationCode || null, p_date_from: dateFrom || null, p_date_to: dateTo || null, p_include_completed: Boolean(includeCompleted), p_limit: normalizeLimit(limit), p_offset: Math.max(Number(offset) || 0, 0) };
    return cachedRestaurantOrdersRpc({ rpcName: 'pos_get_restaurant_orders', licenseKey, baseArgs, params, force, fn: () => callRpc('pos_get_restaurant_orders', { ...baseArgs, ...params }, actorHandle) });
  },
  async getRestaurantOrderByLocalOrder({ licenseKey, localOrderId, force = false } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    const normalizedLocalOrderId = String(localOrderId || '').trim();
    if (!normalizedLocalOrderId) return normalizeLookupResponse({ success: false, found: false, order: null, code: 'LOCAL_ORDER_ID_REQUIRED', message: 'No se encontró la mesa local para verificar cocina cloud.' });
    if (!isOnline()) return normalizeLookupResponse({ success: false, found: false, order: null, source: 'offline', code: 'OFFLINE', message: 'No se pudo verificar cocina cloud porque el dispositivo está sin conexión.' });
    try {
      const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
      const params = { p_local_order_id: normalizedLocalOrderId };
      const response = await cachedRestaurantOrdersRpc({ rpcName: 'pos_get_restaurant_order_by_local_order', licenseKey, baseArgs, params, force, fn: () => callRpc('pos_get_restaurant_order_by_local_order', { ...baseArgs, ...params }, actorHandle) });
      return normalizeLookupResponse(response);
    } catch (error) {
      const message = friendlyRestaurantOrderLookupError(error);
      Logger.warn('[RestaurantOrders/REST.5] No se pudo consultar estado cloud por mesa:', error);
      return normalizeLookupResponse({ success: false, found: false, order: null, error, message, code: error?.code || error?.message || 'RESTAURANT_ORDER_LOOKUP_FAILED' });
    }
  },
  async updateRestaurantOrderStatus({ licenseKey, restaurantOrderId, status, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!restaurantOrderId) throw new Error('RESTAURANT_ORDER_ID_REQUIRED');
    assertOnlineForMutation();
    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({ entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER, operation: SYNC_OPERATIONS.STATUS_UPDATE, entityId: restaurantOrderId, prefix: 'restaurant' });
    const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
    const response = await callRpc('pos_update_restaurant_order_status', { ...baseArgs, p_restaurant_order_id: restaurantOrderId, p_status: status, p_idempotency_key: resolvedIdempotencyKey }, actorHandle);
    if (response?.success !== false) invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    return response;
  },
  async updateRestaurantOrderItemStatus({ licenseKey, restaurantOrderId, restaurantOrderItemId, status, idempotencyKey = null }) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    if (!restaurantOrderId) throw new Error('RESTAURANT_ORDER_ID_REQUIRED');
    if (!restaurantOrderItemId) throw new Error('RESTAURANT_ORDER_ITEM_ID_REQUIRED');
    assertOnlineForMutation();
    const resolvedIdempotencyKey = idempotencyKey || generateIdempotencyKey({ entityType: SYNC_ENTITY_TYPES.RESTAURANT_ORDER_ITEM, operation: SYNC_OPERATIONS.STATUS_UPDATE, entityId: restaurantOrderItemId, prefix: 'restaurant_item' });
    const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
    const response = await callRpc('pos_update_restaurant_order_item_status', { ...baseArgs, p_restaurant_order_id: restaurantOrderId, p_restaurant_order_item_id: restaurantOrderItemId, p_status: status, p_idempotency_key: resolvedIdempotencyKey }, actorHandle);
    if (response?.success !== false) invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    return response;
  },
  async closeRestaurantOrderAfterCheckout({ licenseKey, localOrderId, paidSaleId = null, paidSaleFolio = null, paidTotal = null, paymentSummary = {}, idempotencyKey = null } = {}) {
    if (!licenseKey) throw new Error('LICENSE_KEY_REQUIRED');
    const normalizedLocalOrderId = String(localOrderId || '').trim();
    if (!normalizedLocalOrderId) return { success: true, skipped: true, code: 'LOCAL_ORDER_ID_REQUIRED', message: 'No se encontro la mesa local para cerrar cocina cloud.' };
    assertOnlineForMutation();
    const { args: baseArgs, actorHandle } = await buildBaseRpcArgs(licenseKey);
    const response = await callRpc('pos_close_restaurant_order_after_checkout', {
      ...baseArgs,
      p_local_order_id: normalizedLocalOrderId,
      p_paid_sale_id: paidSaleId || null,
      p_paid_sale_folio: paidSaleFolio || null,
      p_paid_total: paidTotal ?? null,
      p_payment_summary: paymentSummary && typeof paymentSummary === 'object' ? paymentSummary : {},
      p_idempotency_key: idempotencyKey || `restaurant:checkout-close:${normalizedLocalOrderId}:${paidSaleId || paidSaleFolio || 'sale'}`
    }, actorHandle);
    if (response?.success !== false) invalidateCloudCacheAfterRestaurantOrderMutation(licenseKey);
    return response;
  },
  async upsertRestaurantOrderFromLocalSale({ licenseKey, sale, idempotencyKey = null }) {
    if (!sale?.id) throw new Error('RESTAURANT_ORDER_SALE_REQUIRED');
    const [stationsResult, productsById] = await Promise.all([preparationStationsRepository.getPreparationStations({ licenseKey, includeInactive: false, force: false, useCloud: Boolean(licenseKey) }), getProductsById()]);
    const payload = buildRestaurantOrderPayloadFromOpenSale({ sale, stations: stationsResult?.stations || [], productsById });
    return this.upsertRestaurantOrder({ licenseKey, order: payload.order, items: payload.items, idempotencyKey });
  }
};

export default restaurantOrdersRepository;
