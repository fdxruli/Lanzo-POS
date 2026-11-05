/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLicenseFromStorage, saveLicenseToStorage } from '../licenseStorage';

vi.mock('../utils', () => ({
  isLocalStorageEnabled: () => true,
  safeLocalStorageSet: (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
}));

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('required license persistence', () => {
  it('round trips a signed license for a reload', async () => {
    await saveLicenseToStorage({ license_key: 'FREE-ROUNDTRIP' }, { required: true });
    expect(await getLicenseFromStorage()).toMatchObject({ license_key: 'FREE-ROUNDTRIP' });
  });

  it('rejects a failed write instead of announcing success', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(saveLicenseToStorage({ license_key: 'FREE-FAILED' }, { required: true }))
      .rejects.toMatchObject({ code: 'DB_BROWSER_STORAGE_UNAVAILABLE' });
  });

  it('retains the best-effort contract for existing callers', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(saveLicenseToStorage({ license_key: 'EXISTING' })).resolves.toBeUndefined();
  });
});
