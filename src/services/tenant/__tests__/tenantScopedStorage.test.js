/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveTenantStorageNamespace,
  getTenantStorageItem,
  markTenantStorageReady,
  setActiveTenantStorageNamespace,
  setTenantStorageItem
} from '../tenantScopedStorage';

describe('tenantScopedStorage', () => {
  beforeEach(() => { localStorage.clear(); clearActiveTenantStorageNamespace(); });

  it('never reads or mutates an unscoped legacy key', () => {
    localStorage.setItem('lanzo-active-orders-storage', '{"tenant":"legacy-A"}');
    setActiveTenantStorageNamespace('t_0123456789abcdef0123456789abcdef');
    markTenantStorageReady();
    expect(getTenantStorageItem('lanzo-active-orders-storage')).toBeNull();
    setTenantStorageItem('lanzo-active-orders-storage', '{"tenant":"B"}');
    expect(localStorage.getItem('lanzo-active-orders-storage')).toBe('{"tenant":"legacy-A"}');
    expect(localStorage.getItem('lanzo:t:t_0123456789abcdef0123456789abcdef:lanzo-active-orders-storage')).toBe('{"tenant":"B"}');
  });

  it('keeps A and B state physically separate and blocks pre-ready reads', () => {
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(getTenantStorageItem('cart')).toBeNull();
    markTenantStorageReady();
    setTenantStorageItem('cart', 'A');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    markTenantStorageReady();
    expect(getTenantStorageItem('cart')).toBeNull();
    setTenantStorageItem('cart', 'B');
    clearActiveTenantStorageNamespace();
    setActiveTenantStorageNamespace('t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    markTenantStorageReady();
    expect(getTenantStorageItem('cart')).toBe('A');
  });
});
