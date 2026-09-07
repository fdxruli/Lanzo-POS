import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ value: null }));

vi.mock('../tenant/tenantScopedStorage', () => ({
  getTenantStorageItem: () => storage.value,
  setTenantStorageItem: (_key, value) => { storage.value = value; }
}));

vi.mock('../supabase', () => ({
  getStableDeviceId: vi.fn(() => Promise.resolve('fp-stable-browser'))
}));

import {
  areCashStationsEquivalent,
  getCashStationEvidence,
  getCashStationIdFromCloudResponse,
  getCashStationIdentity,
  isCanonicalCashStation,
  persistCashStationBinding
} from './cashStation';

const DEVICE_UUID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  storage.value = null;
});

describe('cash station identity alignment', () => {
  it('never aliases a local storage key to a canonical cloud station', () => {
    expect(areCashStationsEquivalent('local:device:fp-browser-a', `cash_station_device_${DEVICE_UUID}`)).toBe(false);
    expect(areCashStationsEquivalent('local:device:fp-browser-a', 'local:device:fp-browser-a')).toBe(true);
    expect(areCashStationsEquivalent(`cash_station_device_${DEVICE_UUID}`, `cash_station_device_${DEVICE_UUID}`)).toBe(true);
    expect(areCashStationsEquivalent(`cash_station_device_${DEVICE_UUID}`, 'cash_station_device_650e8400-e29b-41d4-a716-446655440001')).toBe(false);
    expect(areCashStationsEquivalent('station-A', 'station-A-suffix')).toBe(false);
    expect(isCanonicalCashStation(`cash_station_device_${DEVICE_UUID}`)).toBe(true);
    expect(isCanonicalCashStation(DEVICE_UUID)).toBe(false);
    expect(isCanonicalCashStation(`cash_station_device_${DEVICE_UUID}-suffix`)).toBe(false);
    expect(isCanonicalCashStation('fp-browser-a')).toBe(false);
  });

  it('separates browser fingerprint, local key and unresolved cloud station', async () => {
    await expect(getCashStationIdentity({ deviceFingerprint: 'fp-browser-a' })).resolves.toMatchObject({
      deviceFingerprint: 'fp-browser-a',
      localStationKey: 'local:device:fp-browser-a',
      cashStationId: null,
      deviceId: null,
      identityState: 'legacy_unresolved'
    });
  });

  it('never uses a cloud device UUID as the browser fingerprint', async () => {
    await expect(getCashStationIdentity({ deviceId: DEVICE_UUID })).resolves.toMatchObject({
      deviceFingerprint: 'fp-stable-browser',
      localStationKey: 'local:device:fp-stable-browser',
      cashStationId: null,
      deviceId: DEVICE_UUID
    });
  });

  it('collects all station evidence so conflicting responses cannot be accepted', () => {
    const evidence = getCashStationEvidence({
      cash_station: { id: `cash_station_device_${DEVICE_UUID}` },
      cash_session: { cash_station_id: 'cash_station_device_650e8400-e29b-41d4-a716-446655440001' }
    });
    expect(evidence.map((entry) => entry.value)).toEqual([
      `cash_station_device_${DEVICE_UUID}`,
      'cash_station_device_650e8400-e29b-41d4-a716-446655440001'
    ]);
  });

  it('persists and reloads a tenant-scoped canonical binding without raw identifiers', async () => {
    const cashStationId = `cash_station_device_${DEVICE_UUID}`;
    expect(persistCashStationBinding({
      licenseKey: 'license-tenant-a',
      deviceFingerprint: 'fp-browser-a',
      cashStationId,
      deviceId: DEVICE_UUID,
      stationKey: 'station-key-a'
    })).toBe(true);

    expect(storage.value).not.toContain('license-tenant-a');
    expect(storage.value).not.toContain('fp-browser-a');
    await expect(getCashStationIdentity({
      licenseKey: 'license-tenant-a',
      deviceFingerprint: 'fp-browser-a'
    })).resolves.toMatchObject({
      deviceFingerprint: 'fp-browser-a',
      localStationKey: 'local:device:fp-browser-a',
      cashStationId,
      deviceId: DEVICE_UUID,
      stationKey: 'station-key-a',
      identityState: 'canonical'
    });
    await expect(getCashStationIdentity({
      licenseKey: 'license-tenant-b',
      deviceFingerprint: 'fp-browser-a'
    })).resolves.toMatchObject({ cashStationId: null });
  });

  it('prefers the canonical station in the cloud response envelope', () => {
    expect(getCashStationIdFromCloudResponse({
      cash_station: { id: `cash_station_device_${DEVICE_UUID}` },
      cash_station_id: 'wrong-station',
      cash_session: { metadata: { cash_station_id: 'older-station' } }
    })).toBe(`cash_station_device_${DEVICE_UUID}`);
  });
});
