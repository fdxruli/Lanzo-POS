import { describe, expect, it } from 'vitest';
import {
  canAuditSalesReports,
  canPerformRefunds,
  canReadSalesReports,
  getSalesFinalHistoryScope,
  getSalesActorIdentity
} from '../salesPermissionPolicy';

describe('salesPermissionPolicy', () => {
  it('keeps reports read authority separate from refunds action authority', () => {
    const reportsOnly = {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-report', permissions: { reports: true, refunds: false } }
    };
    const refundsOnly = {
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-refund', permissions: { reports: false, refunds: true } }
    };

    expect(canReadSalesReports(reportsOnly)).toBe(true);
    expect(canPerformRefunds(reportsOnly)).toBe(false);
    expect(canReadSalesReports(refundsOnly)).toBe(false);
    expect(canPerformRefunds(refundsOnly)).toBe(true);
  });

  it('does not treat historical cancellation or report keys as refunds', () => {
    const authority = {
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-legacy',
        permissions: {
          reports: true,
          sales_cancellations: true,
          cancel_sales: true,
          sales_cancellations_global: true,
          all_sales: true
        }
      }
    };

    expect(canPerformRefunds(authority)).toBe(false);
  });

  it('requires a positive current actor identity and fails closed during transitions', () => {
    expect(canPerformRefunds({ currentDeviceRole: 'admin', currentAdminUser: null })).toBe(false);
    expect(canPerformRefunds({
      currentDeviceRole: 'staff',
      currentStaffUser: { permissions: { refunds: true } }
    })).toBe(false);
    expect(getSalesActorIdentity({ currentDeviceRole: null })).toBeNull();

    const admin = { currentDeviceRole: 'admin', currentAdminUser: { id: 'admin-1' } };
    expect(canReadSalesReports(admin)).toBe(true);
    expect(canPerformRefunds(admin)).toBe(true);
    expect(getSalesActorIdentity(admin)).toBe('admin:admin-1');
  });

  it('accepts only a granted runtime identity with a bound session', () => {
    const runtime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-1',
      sessionId: 'session-1',
      permissions: ['refunds']
    };

    expect(canPerformRefunds(runtime)).toBe(true);
    expect(getSalesActorIdentity(runtime)).toBe('staff:staff-1:session-1');
    expect(canPerformRefunds({ ...runtime, status: 'handoff_check' })).toBe(false);
    expect(canPerformRefunds({ ...runtime, sessionId: null })).toBe(false);
  });

  it('requests cross-device final history only for an audit-authorized actor', () => {
    const admin = {
      status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 'session-admin', permissions: ['*']
    };
    const auditStaff = {
      status: 'granted', actorType: 'staff', actorId: 'staff-audit', sessionId: 'session-audit', permissions: ['reports', 'reports_global']
    };
    const standardStaff = {
      status: 'granted', actorType: 'staff', actorId: 'staff-1', sessionId: 'session-1', permissions: ['reports']
    };

    expect(canAuditSalesReports(admin)).toBe(true);
    expect(getSalesFinalHistoryScope(admin)).toBe('license');
    expect(canAuditSalesReports(auditStaff)).toBe(true);
    expect(getSalesFinalHistoryScope(auditStaff)).toBe('license');
    expect(canAuditSalesReports(standardStaff)).toBe(false);
    expect(getSalesFinalHistoryScope(standardStaff)).toBe('mine');
  });

  it('keeps one authorized admin history scope across two devices while staff remains device-scoped', () => {
    const sharedLicense = 'license-shared';
    const adminOnDeviceA = {
      status: 'granted', actorType: 'admin', actorId: 'admin-1', sessionId: 'session-a',
      licenseId: sharedLicense, deviceId: 'device-a', permissions: ['*']
    };
    const adminOnDeviceB = {
      ...adminOnDeviceA, sessionId: 'session-b', deviceId: 'device-b'
    };
    const staffOnDeviceA = {
      status: 'granted', actorType: 'staff', actorId: 'staff-1', sessionId: 'staff-session-a',
      licenseId: sharedLicense, deviceId: 'device-a', permissions: ['reports']
    };
    const staffOnDeviceB = {
      ...staffOnDeviceA, sessionId: 'staff-session-b', deviceId: 'device-b'
    };

    expect(getSalesFinalHistoryScope(adminOnDeviceA)).toBe('license');
    expect(getSalesFinalHistoryScope(adminOnDeviceB)).toBe('license');
    expect(getSalesFinalHistoryScope(staffOnDeviceA)).toBe('mine');
    expect(getSalesFinalHistoryScope(staffOnDeviceB)).toBe('mine');
  });
});
