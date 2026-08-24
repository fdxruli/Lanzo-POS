import { describe, expect, it } from 'vitest';
import {
  canPerformRefunds,
  canReadSalesReports,
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
});
