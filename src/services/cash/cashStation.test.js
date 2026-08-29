import { describe, expect, it } from 'vitest';
import {
  areCashStationsEquivalent,
  getCashStationIdFromCloudResponse,
  getCashStationIdentity
} from './cashStation';

describe('cash station identity alignment', () => {
  it('treats the legacy and canonical forms of one device as equivalent', () => {
    expect(areCashStationsEquivalent('local:device:A', 'cash_station_device_A')).toBe(true);
    expect(areCashStationsEquivalent('cash_station_device_A', 'local:device:A')).toBe(true);
    expect(areCashStationsEquivalent('local:device:A', 'cash_station_device_B')).toBe(false);
    expect(areCashStationsEquivalent('cash_station_device_A', 'cash_station_device_A_suffix')).toBe(false);
    expect(areCashStationsEquivalent('station-A', 'station-A-suffix')).toBe(false);
  });

  it('keeps the local identity as a legacy-readable device binding', async () => {
    await expect(getCashStationIdentity({ deviceId: 'A' })).resolves.toMatchObject({
      deviceId: 'A',
      cashStationId: 'local:device:A',
      identityState: 'deterministic-device-bound'
    });
  });

  it('prefers the canonical station in the cloud response envelope', () => {
    expect(getCashStationIdFromCloudResponse({
      cash_station: { id: 'cash_station_device_A' },
      cash_station_id: 'wrong-station',
      cash_session: { metadata: { cash_station_id: 'older-station' } }
    })).toBe('cash_station_device_A');
  });
});
