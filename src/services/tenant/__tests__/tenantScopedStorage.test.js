/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveTenantStorageNamespace,
  getTenantStorageItem,
  markTenantStorageReady,
  removeTenantStorageItem,
  resumeTenantStorageWrites,
  setActiveTenantStorageNamespace,
  setTenantStorageItem
} from '../tenantScopedStorage';

describe('tenantScopedStorage', () => {
  beforeEach(() => { localStorage.clear(); clearActiveTenantStorageNamespace(); });

  it('never reads or mutates an unscoped legacy key', () => {
    localStorage.setItem('lanzo-active-orders-storage', '{"tenant":"legacy-A"}');
    setActiveTenantStorageNamespace('t_0123456789abcdef0123456789abcdef');
    markTenantStorageReady();
    resumeTenantStorageWrites();
    expect(getTenantStorageItem('lanzo-active-orders-storage')).toBeNull();
    setTenantStorageItem('lanzo-active-orders-storage', '{"tenant":"B"}');
    expect(localStorage.getItem('lanzo-active-orders-storage')).toBe('{"tenant":"legacy-A"}');
    expect(localStorage.getItem('lanzo:t:t_0123456789abcdef0123456789abcdef:lanzo-active-orders-storage')).toBe('{"tenant":"B"}');
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
