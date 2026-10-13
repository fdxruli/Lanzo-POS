import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ database: null, actor: null, stale: false,
  caps: vi.fn(), cancel: vi.fn() }));
vi.mock('../../db/dexie', () => ({ STORES: { SALES: 'sales' }, db: {
  table: (name) => runtime.database.table(name), transaction: (...args) => runtime.database.transaction(...args)
} }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: { capture: () => runtime.actor } }));
vi.mock('../restaurantOrdersRepository', () => ({ restaurantOrdersRepository: {
  getTableCapabilities: (...args) => runtime.caps(...args), cancelRestaurantOrderFromPos: (...args) => runtime.cancel(...args)
} }));
vi.mock('../../sync/idempotency', () => ({ generateIdempotencyKey: () => 'admin-cancel-1' }));
import { cancelAdministrativeRestaurantTable } from '../restaurantAdministrativeCancellation';

const order = { id: 'table-a', status: 'open', orderType: 'table', restaurantCloudHydrated: true,
  reservationAuthority: 'cloud', createdByStaffUserId: 'staff-a', tenantOpaqueId: 'tenant-a' };
const receipt = { success: true, localOrderId: 'table-a', status: 'cancelled', serverVersion: 2,
  updatedAt: '2026-10-10T01:00:00Z', cancelledAt: '2026-10-10T01:00:00Z' };
beforeEach(async () => {
  runtime.stale = false;
  runtime.actor = { actorType: 'admin', actorId: 'admin-a', actorKey: 'admin:admin-a', sessionId: 'session-a',
    generation: 3, tenant: { opaqueId: 'tenant-a' }, assertCurrent: vi.fn(() => {
      if (runtime.stale) throw new Error('ACTOR_CONTEXT_STALE');
    }) };
  runtime.caps.mockReset().mockResolvedValue({ success: true, contractVersion: 1, localOrderId: order.id,
    cloudOrderId: 'cloud-a', parentVersion: '2026-10-10T00:00:00.123456Z', capabilities: { canCancelTable: true } });
  runtime.cancel.mockReset().mockResolvedValue(receipt);
  runtime.database = new Dexie(`admin-cancel-${crypto.randomUUID()}`);
  runtime.database.version(1).stores({ sales: 'id', menu: 'id' });
  await runtime.database.table('sales').put(order);
  await runtime.database.table('menu').put({ id: 'pizza', stock: 10, committedStock: 2 });
});
afterEach(async () => { await runtime.database.delete(); });
const cancel = () => cancelAdministrativeRestaurantTable({ licenseKey: 'license-a', order, reason: 'Cuenta duplicada' });

describe('administrative remote cancellation', () => {
  it('stores the receipt without releasing stock or changing historical ownership', async () => {
    expect(await cancel()).toEqual(receipt);
    expect(runtime.cancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      expectedVersion: '2026-10-10T00:00:00.123456Z', reason: 'Cuenta duplicada', actorHandle: runtime.actor
    }));
    expect(await runtime.database.table('menu').get('pizza')).toEqual({ id: 'pizza', stock: 10, committedStock: 2 });
    expect(await runtime.database.table('sales').get(order.id)).toMatchObject({
      createdByStaffUserId: 'staff-a', status: 'open', restaurantCancellationCleanupPending: { receipt }
    });
  });
  it.each(['staff', 'expired', 'denied', 'cross-tenant'])('rejects %s before the cancel RPC', async (kind) => {
    if (kind === 'staff') runtime.actor.actorType = 'staff';
    if (kind === 'expired') runtime.stale = true;
    if (kind === 'denied') runtime.caps.mockResolvedValue({ success: false });
    if (kind === 'cross-tenant') runtime.actor.tenant.opaqueId = 'tenant-b';
    await expect(cancel()).rejects.toThrow();
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(await runtime.database.table('sales').get(order.id)).toEqual(order);
  });
  it.each(['timeout', 'ambiguous', 'actor-change'])('preserves local records after %s without replay', async (kind) => {
    if (kind === 'timeout') runtime.cancel.mockRejectedValue(new Error('timeout'));
    if (kind === 'ambiguous') runtime.cancel.mockResolvedValue({ success: true });
    if (kind === 'actor-change') runtime.cancel.mockImplementation(async () => { runtime.stale = true; return receipt; });
    await expect(cancel()).rejects.toThrow();
    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(await runtime.database.table('sales').get(order.id)).toEqual(order);
    expect((await runtime.database.table('menu').get('pizza')).committedStock).toBe(2);
  });
});
