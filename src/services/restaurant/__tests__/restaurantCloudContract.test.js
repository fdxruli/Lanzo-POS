import { describe, expect, it } from 'vitest';
import { assertRestaurantCloudContract, normalizeRestaurantCloudContract, RESTAURANT_UPGRADE_MESSAGE } from '../restaurantCloudContract';
const bridge = { success: true, contractVersion: 1, minimumSupportedClientVersion: 1,
  strictParentVersionRequired: false, versionedWritesAvailable: true, versionedParentVersionRequired: true,
  adminSupervisionAvailable: false, legacyWritesAllowed: true, kitchenTerminalGuardEnabled: true,
  writesPaused: false, serverCapabilityGeneration: '1:0' };
describe('Restaurant server contract (TR-06/36/40)', () => {
  it('recognizes discovery without granting premature Admin authority', () => {
    expect(normalizeRestaurantCloudContract(bridge)).toMatchObject({ supported: true, adminSupervisionAvailable: false });
  });
  it('accepts strict with Admin still disabled, then a separately activated license', () => {
    const strict = { ...bridge, contractVersion: 2, minimumSupportedClientVersion: 2,
      strictParentVersionRequired: true, legacyWritesAllowed: false };
    expect(normalizeRestaurantCloudContract(strict).supported).toBe(true);
    expect(normalizeRestaurantCloudContract({ ...strict, adminSupervisionAvailable: true }).adminSupervisionAvailable).toBe(true);
  });
  it.each([
    { contractVersion: 3 }, { minimumSupportedClientVersion: 3 }, { contractVersion: '2' },
    { versionedParentVersionRequired: false }, { kitchenTerminalGuardEnabled: false },
    { serverCapabilityGeneration: null }, { adminSupervisionAvailable: true }
  ])('blocks unproven contracts %j without a legacy write fallback', (change) => {
    const contract = normalizeRestaurantCloudContract({ ...bridge, ...change });
    expect(contract.supported).toBe(false);
    expect(() => assertRestaurantCloudContract(contract, { mutation: true })).toThrow(RESTAURANT_UPGRADE_MESSAGE);
  });
  it('keeps missing endpoint distinct from maintenance and permits authenticated reads during pause', () => {
    expect(normalizeRestaurantCloudContract(null)).toMatchObject({ endpointAvailable: false, supported: false });
    const paused = normalizeRestaurantCloudContract({ ...bridge, writesPaused: true });
    expect(assertRestaurantCloudContract(paused)).toBe(paused);
    expect(() => assertRestaurantCloudContract(paused, { mutation: true })).toThrow('actualización programada');
  });
});
