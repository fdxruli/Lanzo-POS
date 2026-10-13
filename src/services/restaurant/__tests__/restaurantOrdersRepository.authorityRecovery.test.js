import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), recovered: vi.fn(), context: vi.fn(), runtime: { status: 'granted', generation: 1 } }));
vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../../Logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('../../auth/actorAuthorityRecovery', () => ({ reportActorAuthorityError: mocks.report }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: {
  getState: () => mocks.runtime,
  capture: () => {
    if (mocks.runtime.status !== 'granted') throw Object.assign(new Error('ACTOR_CONTEXT_LOCKED'), { code: 'ACTOR_CONTEXT_LOCKED' });
    const generation = mocks.runtime.generation;
    return { assertCurrent: () => {
      if (mocks.runtime.status !== 'granted' || generation !== mocks.runtime.generation) throw Object.assign(new Error('ACTOR_CONTEXT_STALE'), { code: 'ACTOR_CONTEXT_STALE' });
    } };
  }
} }));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { VERY_SHORT: 0 }, CLOUD_REQUEST_TTL: { VERY_SHORT: 0 },
  CLOUD_REQUEST_TAGS: { RESTAURANT: 'restaurant', SALES: 'sales' },
  buildBaseRpcContextFromArgs: vi.fn(() => ({})), buildRpcRequestKey: vi.fn(() => 'request'),
  cloudRequestManager: { request: ({ fn }) => fn() },
  cloudRequestTags: { license: () => 'license', rpc: () => 'rpc' },
  invalidateCloudCacheAfterRestaurantOrderMutation: vi.fn()
}));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: mocks.context }));
vi.mock('../../sync/idempotency', () => ({ generateIdempotencyKey: () => 'fixture-key' }));
vi.mock('../../sync/syncConstants', () => ({ SYNC_ENTITY_TYPES: {}, SYNC_OPERATIONS: {} }));
vi.mock('../../database', () => ({ loadData: vi.fn(async () => []), STORES: { MENU: 'menu' } }));
vi.mock('../preparationStationsRepository', () => ({ preparationStationsRepository: {} }));
vi.mock('../restaurantOrderMapper', () => ({ buildRestaurantOrderPayloadFromOpenSale: vi.fn() }));

import { restaurantOrdersRepository } from '../restaurantOrdersRepository';
const contractResponse = { data: { success: true, contractVersion: 1, minimumSupportedClientVersion: 1,
  strictParentVersionRequired: false, versionedWritesAvailable: true, versionedParentVersionRequired: true,
  adminSupervisionAvailable: false, legacyWritesAllowed: true, kitchenTerminalGuardEnabled: true,
  writesPaused: false, serverCapabilityGeneration: '1:0' }, error: null };

describe('restaurant RPC authority recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (name) => name === 'pos_restaurant_cloud_contract_v1'
      ? contractResponse : { data: { success: true }, error: null });
    mocks.runtime = { status: 'granted', generation: 1 };
    mocks.context.mockResolvedValue({ licenseKey: 'lic-1', deviceFingerprint: 'fixture-device', securityToken: 'fixture-token', staffSessionToken: 'fixture-actor' });
    vi.stubGlobal('navigator', { onLine: true });
    mocks.report.mockImplementation((error) => {
      const authFailure = /DEVICE_TOKEN_(INVALID|REQUIRED)/.test(error?.message || '');
      if (authFailure) mocks.recovered();
      return authFailure;
    });
  });

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED'])('reports %s once and preserves the original RPC rejection', async (message) => {
    const error = { code: 'P0001', message };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' })).rejects.toBe(error);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith(error, { operation: 'pos_get_restaurant_orders' });
    expect(mocks.recovered).toHaveBeenCalledTimes(1);
  });

  it('reports authority before a lookup translates its failure', async () => {
    const error = { code: 'P0001', message: 'DEVICE_TOKEN_INVALID' };
    mocks.rpc.mockResolvedValue({ data: null, error });
    const result = await restaurantOrdersRepository.getRestaurantOrderByLocalOrder({ licenseKey: 'lic-1', localOrderId: 'table-1' });
    expect(result).toMatchObject({ success: false, error });
    expect(mocks.report).toHaveBeenCalledWith(error, { operation: 'pos_get_restaurant_order_by_local_order' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected write promise without reissuing it', async () => {
    const error = Object.assign(new Error('DEVICE_TOKEN_INVALID'), { code: 'P0001' });
    mocks.rpc.mockImplementation(async (name) => {
      if (name === 'pos_restaurant_cloud_contract_v1') return contractResponse;
      throw error;
    });
    await expect(restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { id: 'table-1' } })).rejects.toBe(error);
    expect(mocks.report).toHaveBeenCalledWith(error, { operation: 'pos_upsert_restaurant_order_versioned_v1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it.each(['DEVICE_TOKEN_INVALID', 'DEVICE_TOKEN_REQUIRED', 'DEVICE_NOT_ALLOWED'])('reports an unsuccessful %s RPC payload without replacing or retrying it', async (code) => {
    const result = { success: false, code, message: code };
    mocks.rpc.mockImplementation(async (name) => name === 'pos_restaurant_cloud_contract_v1'
      ? contractResponse : { data: result, error: null });
    await expect(restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { id: 'table-1' } })).resolves.toBe(result);
    expect(mocks.report).toHaveBeenCalledWith(result, { operation: 'pos_upsert_restaurant_order_versioned_v1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it.each(['NETWORK_ERROR', 'RATE_LIMITED', 'INSUFFICIENT_STOCK'])('preserves %s without activating recovery', async (message) => {
    const error = { code: message, message };
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' })).rejects.toBe(error);
    expect(mocks.recovered).not.toHaveBeenCalled();
  });

  it('requires reauthentication for a missing local device token before any RPC', async () => {
    mocks.context.mockResolvedValue({ licenseKey: 'lic-1', deviceFingerprint: 'fixture-device', securityToken: null });
    await expect(restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' })).rejects.toMatchObject({ code: 'DEVICE_TOKEN_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.recovered).toHaveBeenCalledTimes(1);
  });

  it('keeps an incomplete device identity distinct from a missing token', async () => {
    mocks.context.mockResolvedValue({ licenseKey: 'lic-1', deviceFingerprint: null, securityToken: null });
    await expect(restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' })).rejects.toThrow('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.recovered).not.toHaveBeenCalled();
  });

  it('does not dispatch with valid cached tokens while the actor is locked', async () => {
    mocks.runtime = { status: 'locked', generation: 2, reason: 'admin_actor_logged_out' };
    await expect(restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { id: 'table-1' } })).rejects.toMatchObject({ code: 'ACTOR_CONTEXT_LOCKED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['DEVICE_TOKEN_INVALID', 'read'], ['DEVICE_TOKEN_INVALID', 'write'],
    ['NETWORK_ERROR', 'read'], ['NETWORK_ERROR', 'write'],
    [null, 'read'], [null, 'write']
  ])('discards an old %s %s response without reporting against a newly granted actor', async (message, operation) => {
    let complete;
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = operation === 'read'
      ? restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' })
      : restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { id: 'table-1' } });
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    mocks.runtime = { status: 'granted', generation: 3 };
    complete(message ? { data: null, error: { code: 'P0001', message } } : { data: { success: true }, error: null });
    await expect(pending).rejects.toMatchObject({ code: 'CLOUD_REQUEST_RESPONSE_STALE' });
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.runtime).toMatchObject({ status: 'granted', generation: 3 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('discards context built for a previous actor before dispatch', async () => {
    let complete;
    mocks.context.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = restaurantOrdersRepository.getRestaurantOrders({ licenseKey: 'lic-1' });
    await vi.waitFor(() => expect(mocks.context).toHaveBeenCalledTimes(1));
    mocks.runtime = { status: 'granted', generation: 3 };
    complete({ licenseKey: 'lic-1', deviceFingerprint: 'fixture-device', securityToken: 'fixture-token' });
    await expect(pending).rejects.toMatchObject({ code: 'CLOUD_REQUEST_RESPONSE_STALE' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('TR-06/07/08: missing discovery is an old SQL contract, never actor recovery', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    expect(await restaurantOrdersRepository.getCloudContract({ licenseKey: 'lic-1' })).toMatchObject({ supported: false, endpointAvailable: false });
    await expect(restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { localOrderId: 'table' } }))
      .rejects.toMatchObject({ code: 'RESTAURANT_CLIENT_UPGRADE_REQUIRED' });
    expect(mocks.rpc.mock.calls.every(([name]) => name === 'pos_restaurant_cloud_contract_v1')).toBe(true);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.recovered).not.toHaveBeenCalled();
  });

  it('TR-02/03/37: discovery then one versioned write preserves exact token and caller idempotency', async () => {
    const order = { localOrderId: 'table', expectedParentVersion: '2026-10-10T09:15:00.123456Z' };
    await restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order, idempotencyKey: 'same-financial-context' });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['pos_restaurant_cloud_contract_v1', 'pos_upsert_restaurant_order_versioned_v1']);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_order: { ...order, clientContractVersion: 2 }, p_idempotency_key: 'same-financial-context' });
    expect(order).not.toHaveProperty('clientContractVersion');
  });

  it('TR-11/39/40: each mutation rediscovers policy and never falls back after a cutover', async () => {
    await restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { localOrderId: 'table' }, idempotencyKey: 'stable' });
    mocks.rpc.mockResolvedValue({ ...contractResponse, data: { ...contractResponse.data, writesPaused: true, serverCapabilityGeneration: '2:0' } });
    await expect(restaurantOrdersRepository.upsertRestaurantOrder({ licenseKey: 'lic-1', order: { localOrderId: 'table' }, idempotencyKey: 'stable' }))
      .rejects.toMatchObject({ code: 'RESTAURANT_CONTRACT_MAINTENANCE' });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['pos_restaurant_cloud_contract_v1', 'pos_upsert_restaurant_order_versioned_v1', 'pos_restaurant_cloud_contract_v1']);
    expect(mocks.recovered).not.toHaveBeenCalled();
  });

  it('TR-20/29: an obsolete Kitchen parent-cancel request is rejected without any RPC', async () => {
    await expect(restaurantOrdersRepository.updateRestaurantOrderStatus({ licenseKey: 'lic-1', restaurantOrderId: 'cloud', status: 'cancelled' }))
      .rejects.toMatchObject({ code: 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
