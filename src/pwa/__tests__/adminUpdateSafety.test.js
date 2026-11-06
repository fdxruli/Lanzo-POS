// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { getAdminUpdateCartState, getAdminUpdateDraftBlockReason, hasAdminUpdateWrites, installAdminUpdateWriteTracking, registerAdminUpdateBlocker, setAdminUpdateCartStateReader } from '../adminUpdateSafety';

describe('update protection around native IndexedDB commits', () => {
  it('reads a fresh cart snapshot without POS imports and fails closed on reader errors', () => {
    setAdminUpdateCartStateReader(null);
    expect(getAdminUpdateCartState()).toEqual({ hasOpenCart: false, checkoutLocked: false });
    const state = { hasOpenCart: true, checkoutLocked: false };
    setAdminUpdateCartStateReader(() => state);
    expect(getAdminUpdateCartState()).toEqual(state);
    state.checkoutLocked = true;
    expect(getAdminUpdateCartState().checkoutLocked).toBe(true);
    setAdminUpdateCartStateReader(() => { throw new Error('unavailable'); });
    expect(getAdminUpdateCartState().checkoutLocked).toBe(true);
    setAdminUpdateCartStateReader(null);
  });

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
    let nativeAbort;
    db.version(1).stores({ sales: 'id' });
    installAdminUpdateWriteTracking(db);
    try {
      await expect(db.transaction('rw', db.sales, async () => {
        await db.sales.put({ id: 'uncommitted' });
        expect(hasAdminUpdateWrites()).toBe(true);
        nativeAbort = new Promise(resolve => {
          Dexie.currentTransaction.idbtrans.addEventListener('abort', resolve, { once: true });
        });
        throw new Error('abort-fixture');
      })).rejects.toThrow('abort-fixture');
      // Dexie's public rejection can precede the native abort event.
      await nativeAbort;
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
