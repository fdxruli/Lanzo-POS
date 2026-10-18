// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalBackupAttentionKey, readLocalBackupAttention,
  resetLocalBackupAttentionMemory, updateLocalBackupAttention
} from '../localBackupAttention';

const scope = { databaseName: `LanzoDB_t_t_${'a'.repeat(32)}`, actorKey: 'admin:private-user', deviceRef: 'private-device' };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear(); resetLocalBackupAttentionMemory(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('durable local backup attention', () => {
  it('survives a fresh memory/session without persisting identity or sensitive data', async () => {
    const key = await buildLocalBackupAttentionKey(scope);
    updateLocalBackupAttention(key, 'presented');
    updateLocalBackupAttention(key, 'postpone');
    updateLocalBackupAttention(key, 'read', 'unlock');
    resetLocalBackupAttentionMemory();
    sessionStorage.clear();
    expect(await buildLocalBackupAttentionKey(scope)).toBe(key);
    expect(readLocalBackupAttention(key)).toMatchObject({ presentedAt: expect.any(String), readStates: ['unlock'], postponedAt: expect.any(String) });
    const stored = JSON.stringify(Object.entries(localStorage));
    for (const identity of Object.values(scope)) expect(stored).not.toContain(identity);
    expect(Object.keys(JSON.parse(localStorage.getItem(key)))).toEqual(['version', 'presentedAt', 'readStates', 'postponedAt']);
  });
  it('isolates tenant, actor and device while keeping the same actor stable', async () => {
    const keys = await Promise.all([
      buildLocalBackupAttentionKey(scope),
      buildLocalBackupAttentionKey({ ...scope, databaseName: `LanzoDB_t_t_${'b'.repeat(32)}` }),
      buildLocalBackupAttentionKey({ ...scope, actorKey: 'staff:other' }),
      buildLocalBackupAttentionKey({ ...scope, deviceRef: 'other' })
    ]);
    expect(new Set(keys).size).toBe(4);
    updateLocalBackupAttention(keys[0], 'presented');
    for (const key of keys.slice(1)) expect(readLocalBackupAttention(key).presentedAt).toBeNull();
  });
  it('rejects invalid or missing context instead of writing unscoped preferences', async () => {
    expect(await buildLocalBackupAttentionKey({ ...scope, databaseName: 'LanzoDB' })).toBeNull();
    expect(await buildLocalBackupAttentionKey({ ...scope, actorKey: null })).toBeNull();
    expect(await buildLocalBackupAttentionKey({ ...scope, deviceRef: null })).toBeNull();
    updateLocalBackupAttention('unscoped', 'presented');
    expect(localStorage.length).toBe(0);
  });
  it('keeps presentation separate from reading and deduplicates normal session locks', async () => {
    const key = await buildLocalBackupAttentionKey(scope);
    updateLocalBackupAttention(key, 'presented');
    expect(readLocalBackupAttention(key).readStates).toEqual([]);
    updateLocalBackupAttention(key, 'read', 'unlock');
    updateLocalBackupAttention(key, 'read', 'unlock');
    updateLocalBackupAttention(key, 'read', 'error');
    expect(readLocalBackupAttention(key).readStates).toEqual(['unlock', 'error']);
    expect(readLocalBackupAttention(key).presentedAt).not.toBeNull();
  });
  it('tolerates corrupt/unsupported data and filters unknown condition payloads', async () => {
    const key = await buildLocalBackupAttentionKey(scope);
    localStorage.setItem(key, '{broken');
    expect(readLocalBackupAttention(key).presentedAt).toBeNull();
    localStorage.setItem(key, JSON.stringify({ version: 1, presentedAt: 'bad date', readStates: ['unlock', 'private error', 'unlock'], pin: 'secret' }));
    expect(readLocalBackupAttention(key)).toEqual({ version: 1, presentedAt: null, readStates: ['unlock'], postponedAt: null });
    localStorage.setItem(key, JSON.stringify({ version: 99, presentedAt: new Date().toISOString() }));
    expect(readLocalBackupAttention(key).presentedAt).toBeNull();
  });
  it('falls back to memory when writes or storage access are blocked', async () => {
    const key = await buildLocalBackupAttentionKey(scope);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    updateLocalBackupAttention(key, 'presented');
    expect(readLocalBackupAttention(key).presentedAt).not.toBeNull();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    updateLocalBackupAttention(key, 'read', 'unlock');
    expect(readLocalBackupAttention(key).readStates).toEqual(['unlock']);
  });
  it('uses opaque memory-only keys if hashing is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const key = await buildLocalBackupAttentionKey(scope);
    expect(key).toMatch(/^backup-attention-memory:\d+$/);
    expect(await buildLocalBackupAttentionKey(scope)).toBe(key);
    updateLocalBackupAttention(key, 'presented');
    expect(readLocalBackupAttention(key).presentedAt).not.toBeNull();
    expect(localStorage.length).toBe(0);
  });
  it('does not retain a persisted preference after it is removed', async () => {
    const key = await buildLocalBackupAttentionKey(scope);
    updateLocalBackupAttention(key, 'presented');
    localStorage.removeItem(key);
    expect(readLocalBackupAttention(key).presentedAt).toBeNull();
  });
});
