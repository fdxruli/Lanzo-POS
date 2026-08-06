import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROFILE_LAST_LICENSE_KEY,
  PROFILE_LAST_LOAD_KEY
} from './licenseConstants';
import { invalidateProfileRefreshMetadata } from './profileRefreshCache';

const createStorage = () => {
  const values = new Map();
  return {
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn((key) => values.delete(key)),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
};

describe('invalidateProfileRefreshMetadata', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', createStorage());
  });

  it('removes both profile freshness markers without deleting unrelated storage', () => {
    localStorage.setItem(PROFILE_LAST_LOAD_KEY, '123');
    localStorage.setItem(PROFILE_LAST_LICENSE_KEY, 'LANZO-PRO');
    localStorage.setItem('unrelated', 'kept');

    invalidateProfileRefreshMetadata();

    expect(localStorage.getItem(PROFILE_LAST_LOAD_KEY)).toBeNull();
    expect(localStorage.getItem(PROFILE_LAST_LICENSE_KEY)).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });

  it('does not throw when storage is unavailable', () => {
    localStorage.removeItem.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => invalidateProfileRefreshMetadata()).not.toThrow();
  });
});
