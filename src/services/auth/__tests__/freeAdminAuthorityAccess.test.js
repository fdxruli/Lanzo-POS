import { describe, expect, it } from 'vitest';
import { canReadSalesReports } from '../salesPermissionPolicy';
import { evaluateSettingsAccess } from '../settingsAccessPolicy';

const modernFreeAdminRuntime = Object.freeze({
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-free-owner',
  actorKey: 'admin:admin-free-owner',
  sessionId: 'session-free-owner',
  permissions: ['*'],
  generation: 4,
  tenant: { opaqueId: 'tenant-free-modern' },
  deviceRef: 'device-free-modern'
});

describe('modern FREE Admin access after actor runtime restore', () => {
  it('allows Settings only because the real Admin ActorRuntime is granted', () => {
    const access = evaluateSettingsAccess({
      runtimeSnapshot: modernFreeAdminRuntime,
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-free-owner' },
      currentStaffUser: null,
      isDev: false
    });

    expect(access.isAdmin).toBe(true);
    expect(access.isAuthorizedActor).toBe(true);
    expect(access.canEnterSettings).toBe(true);
  });

  it('allows Sales reports only because the real Admin ActorRuntime is granted', () => {
    expect(canReadSalesReports(modernFreeAdminRuntime)).toBe(true);
  });

  it('does not introduce a FREE bypass when ActorRuntime is locked', () => {
    const locked = {
      status: 'locked',
      actorType: null,
      actorId: null,
      sessionId: null,
      permissions: []
    };

    expect(evaluateSettingsAccess({
      runtimeSnapshot: locked,
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-free-owner' },
      currentStaffUser: null,
      isDev: false
    }).canEnterSettings).toBe(false);
    expect(canReadSalesReports(locked)).toBe(false);
  });
});
