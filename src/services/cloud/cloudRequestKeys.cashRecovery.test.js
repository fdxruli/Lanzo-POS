import { describe, expect, it } from 'vitest';
import { buildRpcRequestKey } from './cloudRequestKeys';

const context = {
  licenseKey: 'license-redacted-test',
  deviceFingerprint: 'fp-browser-a',
  staffSessionToken: 'staff-session-A',
  actorKey: 'admin:actor-A',
  actorSessionId: 'actor-session-A'
};

const stationA = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';
const stationB = 'cash_station_device_650e8400-e29b-41d4-a716-446655440001';

describe('cash cloud request identity', () => {
  it('separates cache keys by actor, local key and canonical financial station', () => {
    const localStation = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      localStationKey: 'local:device:fp-browser-a'
    });
    const canonicalStation = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      cashStationId: stationB
    });
    const actorB = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      actorKey: 'admin:actor-B',
      localStationKey: 'local:device:fp-browser-a'
    });

    expect(localStation).not.toBe(canonicalStation);
    expect(localStation).not.toBe(actorB);
    expect(localStation).not.toContain('license-redacted-test');
    expect(localStation).not.toContain('staff-session-A');
  });

  it('does not collapse the browser fingerprint into a synthetic cash station id', () => {
    const localKey = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      localStationKey: 'local:device:fp-browser-a'
    });
    const canonicalKey = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      cashStationId: stationA
    });

    expect(localKey).not.toBe(canonicalKey);
    expect(localKey).toContain('local_station:');
    expect(canonicalKey).toContain('cash_station:');
  });
});
