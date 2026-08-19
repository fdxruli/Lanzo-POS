/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveTenantStorageNamespace,
  getTenantStorageState,
  getTenantStorageItem,
  inspectActiveTenantStorageSnapshot,
  markTenantStorageReady,
  removeTenantStorageItem,
  resumeTenantStorageWrites,
  setActiveTenantStorageNamespace,
  setTenantStorageItem
} from '../tenantScopedStorage';

describe('tenantScopedStorage', () => {
  beforeEach(() => { localStorage.clear(); clearActiveTenantStorageNamespace(); });

  it('never reads or mutates an unscoped legacy key', () => {
    const opaqueId = 't_0123456789abcdef0123456789abcdef';
    const legacyTenantKey = `lanzo:t:${opaqueId}:lanzo-active-orders-storage`;
    localStorage.setItem('lanzo-active-orders-storage', '{"tenant":"legacy-A"}');
    setActiveTenantStorageNamespace(opaqueId);
    markTenantStorageReady();
    resumeTenantStorageWrites();

    expect(getTenantStorageItem('lanzo-active-orders-storage')).toBeNull();
    setTenantStorageItem('lanzo-active-orders-storage', JSON.stringify({
      state: {
        activeOrders: [['draft-b', { id: 'draft-b', isSaved: false }]],
        currentOrderId: 'draft-b'
      },
      version: 0
    }));

    // No actor is mounted, so actor-owned data fails closed. Neither the
    // historical unscoped key nor the old tenant-scoped ownership location is
    // mutated or claimed by the tenant storage layer.
    expect(localStorage.getItem('lanzo-active-orders-storage')).toBe('{"tenant":"legacy-A"}');
    expect(localStorage.getItem(legacyTenantKey)).toBeNull();
  });

  it('keeps A and B state physically separate and blocks pre-ready reads', () => {
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(getTenantStorageItem('cart')).toBeNull();
    markTenantStorageReady();
    resumeTenantStorageWrites();
    setTenantStorageItem('cart', 'A');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBeNull();
    setTenantStorageItem('cart', 'B');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBe('A');
  });

  it('inspects only the active physical namespace before READY', () => {
    const a = 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 't_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const legacyKey = 'lanzo-active-orders-storage';
    const aKey = `lanzo:t:${a}:active-orders`;
    const bKey = `lanzo:t:${b}:active-orders`;
    localStorage.setItem(legacyKey, 'legacy-payload');
    localStorage.setItem(aKey, 'A-payload');
    localStorage.setItem(bKey, 'B-payload');

    setActiveTenantStorageNamespace(a);
    expect(getTenantStorageState()).toMatchObject({ ready: false, writesSuspended: true });
    expect(inspectActiveTenantStorageSnapshot()).toEqual({
      counts: { [`localStorage:${aKey}`]: 1 },
      occupiedStores: [`localStorage:${aKey}`]
    });
    expect(localStorage.getItem(legacyKey)).toBe('legacy-payload');
    expect(localStorage.getItem(bKey)).toBe('B-payload');

    clearActiveTenantStorageNamespace();
    expect(() => inspectActiveTenantStorageSnapshot()).toThrow('TENANT_STORAGE_NAMESPACE_MISSING');
  });

  it('fails closed when browser storage throws without clearing another tenant payload', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing });
    setActiveTenantStorageNamespace('t_cccccccccccccccccccccccccccccccc');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('cart')).toBeNull();
    expect(() => setTenantStorageItem('cart', 'C')).not.toThrow();
    expect(() => removeTenantStorageItem('cart')).not.toThrow();
    Object.defineProperty(window, 'localStorage', original);
  });

  it('keeps writes suspended while readable, resumes explicitly, and locks them again', () => {
    const opaqueId = 't_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const key = `lanzo:t:${opaqueId}:post-ready-test`;
    setActiveTenantStorageNamespace(opaqueId);
    markTenantStorageReady();
    expect(getTenantStorageItem('post-ready-test')).toBeNull();
    setTenantStorageItem('post-ready-test', 'blocked');
    expect(localStorage.getItem(key)).toBeNull();
    resumeTenantStorageWrites();
    setTenantStorageItem('post-ready-test', 'A');
    expect(localStorage.getItem(key)).toBe('A');
    clearActiveTenantStorageNamespace();
    setTenantStorageItem('post-ready-test', 'B');
    expect(localStorage.getItem(key)).toBe('A');
  });
});
