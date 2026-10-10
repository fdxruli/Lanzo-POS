import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  loadData: vi.fn(),
  request: vi.fn()
}));

vi.mock('../../Logger', () => ({ default: { warn: (...args) => mocks.warn(...args) } }));
vi.mock('../../supabase', () => ({ supabaseClient: null }));
vi.mock('../../database', () => ({
  STORES: { SYNC_CACHE: 'syncCache' },
  loadData: (...args) => mocks.loadData(...args),
  saveData: vi.fn()
}));
vi.mock('../../cloud', () => ({
  CLOUD_REQUEST_COOLDOWN: { SNAPSHOT: 1 },
  CLOUD_REQUEST_TAGS: { RESTAURANT: 'restaurant', PRODUCTS: 'products' },
  CLOUD_REQUEST_TTL: { MEDIUM: 1 },
  buildBaseRpcContextFromArgs: () => ({}),
  buildRpcRequestKey: () => 'preparation-stations-test',
  cloudRequestManager: { request: (...args) => mocks.request(...args) },
  cloudRequestTags: { license: () => 'license', rpc: () => 'rpc' },
  invalidateCloudCacheAfterRestaurantConfigMutation: vi.fn()
}));
vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async ({ licenseKey }) => ({
    licenseKey,
    deviceFingerprint: 'device-1',
    securityToken: 'token-1'
  }))
}));

import { preparationStationsRepository } from '../preparationStationsRepository';

describe('preparationStationsRepository.getPreparationStations stale reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadData.mockResolvedValue({ value: { stations: [
      { id: 'prep-hot', code: 'hot', name: 'Plancha', isActive: true }
    ] } });
  });

  it('uses cached stations for a stale Cloud response without an alarmist warning', async () => {
    const stale = Object.assign(new Error('CLOUD_REQUEST_RESPONSE_STALE'), {
      code: 'CLOUD_REQUEST_RESPONSE_STALE'
    });
    mocks.request.mockRejectedValue(stale);

    const result = await preparationStationsRepository.getPreparationStations({
      licenseKey: 'license-1', useCloud: true
    });

    expect(result).toMatchObject({ success: true, source: 'cache', fromCache: true, stale: true });
    expect(result.stations).toEqual([expect.objectContaining({ code: 'hot', name: 'Plancha' })]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('keeps real Cloud errors logged and returns the cached station set', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'ACTOR_PERMISSION_DENIED' });
    mocks.request.mockRejectedValue(error);

    const result = await preparationStationsRepository.getPreparationStations({
      licenseKey: 'license-1', useCloud: true
    });

    expect(result).toMatchObject({ success: false, source: 'cache', fromCache: true, error });
    expect(result.stations).toEqual([expect.objectContaining({ code: 'hot', name: 'Plancha' })]);
    expect(mocks.warn).toHaveBeenCalledWith('[PreparationStations] Lectura cloud fallo:', error);
  });
});
