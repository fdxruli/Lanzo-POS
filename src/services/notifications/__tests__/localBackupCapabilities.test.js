import { describe, expect, it } from 'vitest';
import { shouldUseLocalBackupAlerts } from '../notificationCapabilities';
describe('local backup alert capabilities', () => {
  it('allows Free defaults and explicit backup capability independent of inventory', () => {
    expect(shouldUseLocalBackupAlerts({})).toBe(true);
    expect(shouldUseLocalBackupAlerts({ features: { local_backup_alerts: true, local_inventory_alerts: false } })).toBe(true);
  });
  it.each([
    { local_backup_alerts: false },
    { local_backup_alerts: true, notification_center: true },
    { local_backup_alerts: true, cloud_notifications: true },
    { realtime_license_sync: true }
  ])('rejects a disabled or cloud notification surface %o', (features) => {
    expect(shouldUseLocalBackupAlerts({ features })).toBe(false);
  });
});
