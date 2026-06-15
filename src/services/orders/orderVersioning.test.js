import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareOrderVersions,
  getOrderDeviceId,
  selectNewestOrder
} from './orderVersioning';

describe('orderVersioning', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('compares revision before updatedAt or item count', () => {
    const localOrder = {
      revision: 2,
      updatedAt: '2026-06-14T12:00:00.000Z',
      items: [{}, {}, {}]
    };
    const dbOrder = {
      revision: 3,
      updatedAt: '2026-06-14T11:00:00.000Z',
      items: []
    };

    expect(selectNewestOrder(localOrder, dbOrder)).toEqual({
      source: 'db',
      order: dbOrder
    });
  });

  it('uses updatedAt and then deviceId as deterministic tie breakers', () => {
    const older = {
      revision: 4,
      updatedAt: '2026-06-14T11:00:00.000Z',
      deviceId: 'device-z'
    };
    const newer = {
      revision: 4,
      updatedAt: '2026-06-14T12:00:00.000Z',
      deviceId: 'device-a'
    };

    expect(compareOrderVersions(newer, older)).toBe(1);
    expect(compareOrderVersions(
      { ...newer, deviceId: 'device-b' },
      { ...newer, deviceId: 'device-a' }
    )).toBe(1);
  });

  it('reuses the main device id when available', () => {
    localStorage.setItem('lanzo_device_id', 'DEVICE-001');

    expect(getOrderDeviceId()).toBe('DEVICE-001');
  });
});
