import { describe, expect, it } from 'vitest';
import { buildRpcRequestKey } from './cloudRequestKeys';

const context = {
  licenseKey: 'license-redacted-test',
  deviceId: 'device-A',
  staffSessionToken: 'staff-session-A',
  actorKey: 'admin:actor-A',
  actorSessionId: 'actor-session-A'
};

describe('cash cloud request identity', () => {
  it('separates cache keys by actor and local financial station', () => {
    const stationA = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      cashStationId: 'local:device:A'
    });
    const stationB = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      cashStationId: 'cash_station_device_B'
    });
    const actorB = buildRpcRequestKey('pos_get_current_cash_session', {
      ...context,
      actorKey: 'admin:actor-B',
      cashStationId: 'local:device:A'
    });

    expect(stationA).not.toBe(stationB);
    expect(stationA).not.toBe(actorB);
    expect(stationA).not.toContain('license-redacted-test');
    expect(stationA).not.toContain('staff-session-A');
  });
});
