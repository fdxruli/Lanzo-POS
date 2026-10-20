import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPublicChunkRecoveryKey,
  isPublicChunkLoadError,
  recoverFromPublicChunkError
} from '../publicChunkRecovery';

describe('public chunk recovery', () => {
  let storage;
  let locationRef;

  beforeEach(() => {
    storage = new Map();
    storage.getItem = vi.fn((key) => Map.prototype.get.call(storage, key) || null);
    storage.setItem = vi.fn((key, value) => Map.prototype.set.call(storage, key, value));
    storage.removeItem = vi.fn((key) => Map.prototype.delete.call(storage, key));
    locationRef = { pathname: '/tienda/demo', reload: vi.fn() };
  });

  it('reloads once for a confirmed chunk error and prevents a loop', () => {
    const error = new Error('Failed to fetch dynamically imported module');
    expect(recoverFromPublicChunkError(error, { storage, locationRef })).toBe(true);
    expect(recoverFromPublicChunkError(error, { storage, locationRef })).toBe(false);
    expect(locationRef.reload).toHaveBeenCalledOnce();
  });

  it('does not reload for ordinary network or validation errors', () => {
    expect(isPublicChunkLoadError(new Error('Supabase request timeout'))).toBe(false);
    expect(recoverFromPublicChunkError(
      new Error('ECOMMERCE_PRODUCT_UNAVAILABLE'),
      { storage, locationRef }
    )).toBe(false);
    expect(locationRef.reload).not.toHaveBeenCalled();
  });

  it('keeps the one-shot marker for the tab session so later chunk failures cannot loop', () => {
    const error = new Error('Failed to fetch dynamically imported module');
    expect(recoverFromPublicChunkError(error, { storage, locationRef })).toBe(true);
    // A successful root boot does not clear the mark before a later lazy chunk can fail.
    expect(storage.getItem(getPublicChunkRecoveryKey(locationRef))).toBe('attempted');
    expect(recoverFromPublicChunkError(error, { storage, locationRef })).toBe(false);
    expect(locationRef.reload).toHaveBeenCalledOnce();
  });

  it('does not reload offline or when the tab cannot persist its one-shot marker', () => {
    const error = new Error('Failed to fetch dynamically imported module');
    expect(recoverFromPublicChunkError(error, {
      storage,
      locationRef,
      navigatorRef: { onLine: false }
    })).toBe(false);

    const restrictedStorage = {
      getItem() { throw new Error('storage blocked'); },
      setItem() { throw new Error('storage blocked'); }
    };
    expect(recoverFromPublicChunkError(error, {
      storage: restrictedStorage,
      locationRef,
      navigatorRef: { onLine: true }
    })).toBe(false);
    expect(locationRef.reload).not.toHaveBeenCalled();
  });
});
