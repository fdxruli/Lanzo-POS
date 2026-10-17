import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildPosSyncAuthContext: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc: mocks.rpc },
}));

vi.mock('../../sync/posSyncClient', () => ({
  buildPosSyncAuthContext: mocks.buildPosSyncAuthContext,
}));

vi.mock('../../notifications/notificationCapabilities', () => ({
  getNotificationCapabilities: () => ({ support_tickets: true }),
  getSupportChannel: () => 'in_app',
  isSupportCenterEnabled: () => true,
}));

import {
  createSupportTicket,
  getSupportTicketThread,
} from '../supportTicketService';

const licenseDetails = { license_key: 'full-license-sent-only-as-rpc-auth' };

describe('support ticket service privacy boundary', () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: { success: true, ticket: { id: 'ticket-1' } } });
    mocks.buildPosSyncAuthContext.mockReset().mockResolvedValue({
      licenseKey: 'full-license-sent-only-as-rpc-auth',
      deviceFingerprint: 'device-fingerprint-auth-only',
      securityToken: 'support-token-auth-only',
      staffSessionToken: null,
    });
  });

  it('sends only the known support source in ticket metadata', async () => {
    await createSupportTicket({
      licenseDetails,
      subject: 'Help',
      message: 'Please review this support request.',
      metadata: {
        source: 'notification_center',
        customerName: 'Customer Private Name',
        transactionTotal: 741.25,
        deviceId: 'device-identifier-private',
      },
    });

    const [, payload] = mocks.rpc.mock.calls[0];
    expect(payload.p_metadata).toEqual({ source: 'notification_center' });
    expect(JSON.stringify(payload.p_metadata)).not.toContain('Customer Private Name');
    expect(JSON.stringify(payload.p_metadata)).not.toContain('741.25');
    expect(JSON.stringify(payload.p_metadata)).not.toContain('device-identifier-private');
    expect(payload.p_license_key).toBe('full-license-sent-only-as-rpc-auth');
    expect(payload.p_security_token).toBe('support-token-auth-only');
  });

  it('does not expose device fingerprints or arbitrary response metadata in normalized messages', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        success: true,
        ticket: { id: 'ticket-1', subject: 'Support request' },
        messages: [{
          id: 'message-1',
          sender_type: 'staff',
          sender_staff_user_id: 'staff-user-private-id',
          sender_device_fingerprint: 'device-fingerprint-private-id',
          message: 'Support reply text.',
          attachments_metadata: [{ path: 'private/customer-document.pdf' }],
          metadata: { license: 'full-license-private', total: 741.25 },
          created_at: '2026-10-15T12:00:00.000Z',
        }],
        internal_trace: 'private-server-detail',
      },
    });

    const result = await getSupportTicketThread({ licenseDetails, ticketId: 'ticket-1' });
    const serialized = JSON.stringify(result);

    expect(result.success).toBe(true);
    expect(result.messages[0]).toMatchObject({ id: 'message-1', sender_type: 'staff', message: 'Support reply text.' });
    expect(serialized).not.toContain('sender_device_fingerprint');
    expect(serialized).not.toContain('device-fingerprint-private-id');
    expect(serialized).not.toContain('staff-user-private-id');
    expect(serialized).not.toContain('private/customer-document.pdf');
    expect(serialized).not.toContain('full-license-private');
    expect(serialized).not.toContain('private-server-detail');
  });
});
