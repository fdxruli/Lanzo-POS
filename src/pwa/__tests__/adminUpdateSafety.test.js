// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { getAdminUpdateDraftBlockReason, hasAdminUpdateWrites, installAdminUpdateWriteTracking, registerAdminUpdateBlocker } from '../adminUpdateSafety';

describe('update protection around native IndexedDB commits', () => {
  it('tracks complete write transactions and preserves committed records', async () => {
    const db = new Dexie('qa-update-writes');
    db.version(1).stores({ sales: 'id' });
    installAdminUpdateWriteTracking(db);
    try {
      await db.transaction('rw', db.sales, async () => {
        await db.sales.put({ id: 'sale-1', total: 150 });
        expect(hasAdminUpdateWrites()).toBe(true);
      });
      expect(hasAdminUpdateWrites()).toBe(false);
      expect(await db.sales.get('sale-1')).toEqual({ id: 'sale-1', total: 150 });
      await db.transaction('r', db.sales, async () => {
        expect(hasAdminUpdateWrites()).toBe(false);
      });
    } finally { await db.delete(); }
  });

  it('releases protection only when an aborted native transaction settles', async () => {
    const db = new Dexie('qa-update-abort');
    db.version(1).stores({ sales: 'id' });
    installAdminUpdateWriteTracking(db);
    try {
      await expect(db.transaction('rw', db.sales, async () => {
        await db.sales.put({ id: 'uncommitted' });
        expect(hasAdminUpdateWrites()).toBe(true);
        throw new Error('abort-fixture');
      })).rejects.toThrow('abort-fixture');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(hasAdminUpdateWrites()).toBe(false);
      expect(await db.sales.get('uncommitted')).toBeUndefined();
    } finally { await db.delete(); }
  });

  it('keeps independent forms protected until each releases its blocker', () => {
    const releaseA = registerAdminUpdateBlocker('form-a');
    const releaseB = registerAdminUpdateBlocker('form-b');
    expect(getAdminUpdateDraftBlockReason()).toBe('form-a');
    releaseA(); releaseA();
    expect(getAdminUpdateDraftBlockReason()).toBe('form-b');
    releaseB();
    expect(getAdminUpdateDraftBlockReason()).toBeNull();
  });
});
