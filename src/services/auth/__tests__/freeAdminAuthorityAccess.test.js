import { describe, expect, it } from 'vitest';
import { grantTestActor } from './actorAccessTestHarness';
import { canReadSalesReports } from '../salesPermissionPolicy';
import { evaluateSettingsAccess } from '../settingsAccessPolicy';

const modernFreeAdminRuntime = () => grantTestActor({
  actorType: 'admin',
  actorId: 'admin-free-owner',
  permissions: ['*'],
  sessionId: 'session-free-owner'
});

describe('modern FREE Admin access after actor runtime restore', () => {
  it('allows Settings only because the real Admin ActorRuntime is granted', () => {
    const runtimeSnapshot = modernFreeAdminRuntime();
    const access = evaluateSettingsAccess({
      runtimeSnapshot,
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
    expect(canReadSalesReports(modernFreeAdminRuntime())).toBe(true);
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
