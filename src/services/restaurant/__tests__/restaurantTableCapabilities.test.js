import { describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { getState: () => ({ status: 'locked' }) } }));
import { bindRestaurantTableCapabilities, getRestaurantTableCapabilities, TABLE_CAPABILITIES } from '../restaurantTableCapabilities';

const actor = { status: 'granted', actorType: 'staff', actorId: 'staff-a', actorKey: 'staff:staff-a',
  sessionId: 'session-a', generation: 1, deviceRef: 'device-a', permissions: ['pos','refunds'], tenant: { opaqueId: 'tenant-a' } };
const order = { id: 'table-a', status: 'open', orderType: 'table', createdByStaffUserId: 'staff-a', tenantOpaqueId: 'tenant-a' };
const caps = (updates = {}, actorUpdates = {}, verified = null) => getRestaurantTableCapabilities({
  order: { ...order, ...updates }, actor: { ...actor, ...actorUpdates }, verified });
describe('restaurant canonical authority projection', () => {
  it('A01-A03/A25 permits local owner with operation permissions, offline without Cloud', () => {
    expect(caps()).toMatchObject({ canEditTable: true, canCheckoutTable: true, canSplitTable: true, canCancelTable: true });
  });
  it('A04-A08 denies foreign Staff mutations while allowing review', () => {
    expect(caps({}, { actorId: 'staff-b' })).toMatchObject({ canViewTable: true,
      canEditTable: false, canCheckoutTable: false, canSplitTable: false, canCancelTable: false });
  });
  it('A25 preserves Free/local legacy edit permissions without a Cloud owner contract', () => {
    const free = getRestaurantTableCapabilities({ order: { ...order, createdByStaffUserId: null }, actor, enforceStaffOwnership: false });
    expect(free).toMatchObject({ canEditTable: true, canCheckoutTable: true, canSplitTable: true, canCancelTable: true });
  });
  it('A26 never infers a legacy owner from device or missing staff identity', () => {
    expect(caps({ createdByStaffUserId: null, deviceId: 'device-a' }).canEditTable).toBe(false);
    expect(caps({ createdByStaffUserId: null }, { actorType: 'admin' }).canEditTable).toBe(true);
  });
  it.each(['paid', 'cancelled', 'closed'])('A13/A14 blocks terminal %s', (status) => {
    expect(caps({ status })).toMatchObject({ canCheckoutTable: false, canEditTable: false, canSplitTable: false });
  });
  it('A17 denies expired/locked sessions', () => { expect(Object.values(caps({}, { status: 'locked' }))).not.toContain(true); });
  it('A18/A28 denies tenant change', () => { expect(Object.values(caps({ tenantOpaqueId: 'tenant-b' }))).not.toContain(true); });
  it('permissions remain independent', () => { expect(caps({}, { permissions: ['pos'] }).canCancelTable).toBe(false); });
  it('Cloud grants fail closed until backend evidence arrives', () => {
    expect(caps({ restaurantOrderId: 'cloud-a' })).toMatchObject({ canViewTable: true, canCheckoutTable: false, canSplitTable: false });
  });
  it('A09/A10/A11/A12 supports verified admin remote settlement/cancel, keeps inventory edit blocked', () => {
    const admin = { ...actor, actorType: 'admin', actorId: 'admin-b', actorKey: 'admin:admin-b' };
    const verified = bindRestaurantTableCapabilities({ capabilities: Object.fromEntries(TABLE_CAPABILITIES.map((key) => [key, true])) }, admin, order.id);
    const result = getRestaurantTableCapabilities({ order: { ...order, restaurantCloudHydrated: true }, actor: admin, verified });
    expect(result).toMatchObject({ canCheckoutTable: true, canSplitTable: true, canCancelTable: true, canAdministerTable: true, canEditTable: false, canSendToKitchen: false });
  });
  it.each(['actorKey','sessionId','generation','tenantId','orderId'])('A18/A20 invalidates stale binding %s', (field) => {
    const verified = bindRestaurantTableCapabilities({ capabilities: { canCheckoutTable: true } }, actor, order.id);
    expect(caps({ restaurantOrderId: 'cloud-a' }, {}, { ...verified, [field]: 'other' }).canCheckoutTable).toBe(false);
  });
});
