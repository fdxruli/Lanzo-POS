import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantStorage = vi.hoisted(() => ({ ready: true, namespace: 'tenant-a', values: new Map() }));

vi.mock('../../tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ ready: tenantStorage.ready, opaqueId: tenantStorage.namespace }),
  getTenantStorageItem: (key) => tenantStorage.ready ? (tenantStorage.values.get(`${tenantStorage.namespace}:${key}`) ?? null) : null,
  setTenantStorageItem: (key, value) => {
    if (tenantStorage.ready) tenantStorage.values.set(`${tenantStorage.namespace}:${key}`, value);
  },
  removeTenantStorageItem: (key) => {
    if (tenantStorage.ready) tenantStorage.values.delete(`${tenantStorage.namespace}:${key}`);
  }
}));

import {
  buildRestaurantSplitOrderSnapshot,
  clearRestaurantSplitDraft,
  getRestaurantSplitDraftStorageKey,
  readRestaurantSplitDraft,
  saveRestaurantSplitDraft
} from '../../sales/restaurantSplitDraft';

const makeDraft = (overrides = {}) => {
  const order = [{ lineId: 'line-a', id: 'product-a', name: 'Agua', quantity: 2, price: 30 }];
  const orderSnapshot = buildRestaurantSplitOrderSnapshot({ order, total: 60 });
  return {
    orderId: 'mesa-local-4',
    order,
    orderSnapshot,
    guests: [{ id: 'T1', displayName: 'Ana' }, { id: 'T2', displayName: '' }],
    allocations: [{ poolQuantity: 0, ticketQuantities: [1, 1] }],
    step: 'items',
    ...overrides
  };
};

describe('restaurant split local draft', () => {
  beforeEach(() => {
    tenantStorage.ready = true;
    tenantStorage.namespace = 'tenant-a';
    tenantStorage.values.clear();
  });

  it('restores presentation names, step and allocations for the same tenant, order and snapshot', () => {
    const draft = makeDraft();
    expect(saveRestaurantSplitDraft(draft)).toBe(true);
    expect(readRestaurantSplitDraft(draft)).toMatchObject({
      status: 'restored',
      step: 'items',
      guests: [{ id: 'T1', displayName: 'Ana' }, { id: 'T2', displayName: '' }],
      allocations: [{ poolQuantity: 0, ticketQuantities: [1, 1] }]
    });
  });

  it('isolates identical order identifiers across businesses and clears only the active tenant draft', () => {
    const draft = makeDraft();
    expect(saveRestaurantSplitDraft(draft)).toBe(true);
    const storageKey = getRestaurantSplitDraftStorageKey(draft.orderId);
    tenantStorage.namespace = 'tenant-b';
    expect(readRestaurantSplitDraft(draft).status).toBe('missing');
    expect(saveRestaurantSplitDraft({ ...draft, guests: [{ id: 'T1', displayName: '' }, { id: 'T2', displayName: '' }] })).toBe(true);
    expect(clearRestaurantSplitDraft(draft.orderId)).toBe(true);
    expect(tenantStorage.values.has(`tenant-b:${storageKey}`)).toBe(false);
    tenantStorage.namespace = 'tenant-a';
    expect(readRestaurantSplitDraft(draft).status).toBe('restored');
  });

  it('invalidates a draft when a commercial line or sale discount changes', () => {
    const draft = makeDraft();
    saveRestaurantSplitDraft(draft);
    const changedOrder = [{ ...draft.order[0], quantity: 3 }];
    const changedSnapshot = buildRestaurantSplitOrderSnapshot({ order: changedOrder, total: 90 });
    expect(readRestaurantSplitDraft({ ...draft, order: changedOrder, orderSnapshot: changedSnapshot })).toEqual({ status: 'stale' });
    expect(tenantStorage.values.size).toBe(0);
  });

  it('rejects fractional units but preserves canonical fractional quantities for bulk items', () => {
    const unitDraft = makeDraft({
      order: [{ id: 'unit-a', lineId: 'unit-line', name: 'Vaso', quantity: 1, price: 20 }],
      allocations: [{ poolQuantity: 0, ticketQuantities: [0.5, 0.5] }]
    });
    unitDraft.orderSnapshot = buildRestaurantSplitOrderSnapshot({ order: unitDraft.order, total: 20 });
    expect(saveRestaurantSplitDraft(unitDraft)).toBe(false);

    const bulkDraft = makeDraft({
      order: [{ id: 'bulk-a', lineId: 'bulk-line', name: 'Queso', saleType: 'weight', quantity: 1.5, price: 20 }],
      allocations: [{ poolQuantity: 0, ticketQuantities: [1, 0.5] }]
    });
    bulkDraft.orderSnapshot = buildRestaurantSplitOrderSnapshot({ order: bulkDraft.order, total: 30 });
    expect(saveRestaurantSplitDraft(bulkDraft)).toBe(true);
    expect(readRestaurantSplitDraft(bulkDraft).status).toBe('restored');
  });

  it('does not read or write when tenant storage is not ready', () => {
    const draft = makeDraft();
    tenantStorage.ready = false;
    expect(readRestaurantSplitDraft(draft).status).toBe('unavailable');
    expect(saveRestaurantSplitDraft(draft)).toBe(false);
    expect(clearRestaurantSplitDraft(draft.orderId)).toBe(false);
  });
});
