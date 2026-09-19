import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_MESSAGE_CLOUD_OUTBOX_STATUSES,
  buildPaymentMessagePayload,
  isCloudCustomerMessagingEnabled,
  mergeCustomerMessageOutboxRecords,
  payloadContainsTechnicalIds,
  sanitizeCustomerMessageOutboxPayload,
  toCloudCustomerMessageOutboxStatus,
  toLocalCustomerMessageOutboxStatus
} from '../index';
import {
  cancelCustomerMessageReminder,
  getCustomerMessageReminderErrorCopy,
  listCustomerMessageReminders,
  rescheduleCustomerMessageReminder,
  scheduleCustomerMessageReminder
} from '../reminders';

const cloudLicense = {
  plan_code: 'pro_monthly',
  features: { cloud_pos_sync: true, customerMessageTemplates: true }
};

describe('customer messaging phase 5 automation contracts', () => {
  it('separates Local/Free from the cloud messaging entitlement', () => {
    expect(isCloudCustomerMessagingEnabled({ plan_code: 'free_trial', features: {} })).toBe(false);
    expect(isCloudCustomerMessagingEnabled({ plan_code: 'basic_monthly', features: { cloud_pos_sync: false } })).toBe(false);
    expect(isCloudCustomerMessagingEnabled(cloudLicense)).toBe(true);
  });

  it('maps legacy local statuses to honest provider-neutral cloud statuses', () => {
    expect(CUSTOMER_MESSAGE_CLOUD_OUTBOX_STATUSES).toEqual([
      'preparado', 'pendiente', 'compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'
    ]);
    expect(toCloudCustomerMessageOutboxStatus('descarga_generada')).toBe('descargado');
    expect(toCloudCustomerMessageOutboxStatus('cancelado_por_usuario')).toBe('cancelado');
    expect(toLocalCustomerMessageOutboxStatus('descargado')).toBe('descarga_generada');
    expect(toLocalCustomerMessageOutboxStatus('sent')).toBe('error');
  });

  it('merges a newer cloud state without allowing a stale local device to regress it', () => {
    const local = {
      idempotencyKey: 'cm_operation_1',
      status: 'preparado',
      updatedAt: '2026-09-19T10:00:00.000Z',
      attemptCount: 0,
      shareAttemptCount: 0
    };
    const cloud = {
      idempotency_key: 'cm_operation_1',
      status: 'compartido',
      updated_at: '2026-09-19T10:01:00.000Z',
      attempt_count: 1,
      share_attempt_count: 1
    };
    expect(mergeCustomerMessageOutboxRecords(local, cloud)).toMatchObject({
      status: 'compartido',
      cloudStatus: 'compartido',
      cloudSyncStatus: 'synced',
      attemptCount: 1,
      shareAttemptCount: 1
    });
  });

  it('does not permit technical ids or image base64 in a cloud snapshot', () => {
    expect(payloadContainsTechnicalIds({ eventType: 'debt_reminder', account: { totalBalance: '20.00' } })).toBe(false);
    expect(payloadContainsTechnicalIds({ account: { customer_id: 'customer-1' } })).toBe(true);
  });

  it('keeps every applicable human sale reference when a payment covers several notes', () => {
    const result = buildPaymentMessagePayload({
      customer: { id: 'customer-1', name: 'María', phone: '5512345678' },
      business: { name: 'Lanzo' },
      previousBalance: '100.00',
      occurredAt: '2026-09-19T10:00:00.000Z',
      receipt: {
        reference: 'AB-0008',
        amount: '100.00',
        previous_debt: '100.00',
        new_debt: '0.00',
        payment_method: 'efectivo',
        created_at: '2026-09-19T10:00:00.000Z'
      },
      allocations: [
        { saleId: 'sale-1', saleFolio: 'V-0007', amountApplied: '60.00' },
        { saleId: 'sale-2', sale: { folio: 'V-0008' }, amountApplied: '40.00' }
      ],
      timeZone: 'UTC'
    });

    expect(result.ok).toBe(true);
    expect(result.payload.reference).toBe('AB-0008 · V-0007 · V-0008');
    const snapshot = sanitizeCustomerMessageOutboxPayload(result.payload);
    expect(snapshot.payment.reference).toBe('AB-0008 · V-0007 · V-0008');
    expect(snapshot.payment.allocations).toEqual([
      { reference: 'V-0007', amount: '60' },
      { reference: 'V-0008', amount: '40' }
    ]);
    expect(payloadContainsTechnicalIds(snapshot)).toBe(false);
  });

  it('keeps reminders unavailable for Local and never claims a provider send', async () => {
    const repository = {
      listReminders: async () => ({ ok: true, reminders: [{ status: 'programado', provider_configured: false }] }),
      scheduleReminder: async () => ({ ok: true, reminder: { status: 'programado', provider_configured: false } })
    };
    const local = await listCustomerMessageReminders({ repository, licenseDetails: { plan_code: 'free_trial', features: {} } });
    const cloud = await listCustomerMessageReminders({ repository, licenseDetails: cloudLicense });
    const scheduled = await scheduleCustomerMessageReminder('customer-a', { repository, licenseDetails: cloudLicense });

    expect(local).toMatchObject({ ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' });
    expect(cloud.reminders[0]).toMatchObject({ status: 'programado', provider_configured: false });
    expect(scheduled.reminder).toMatchObject({ status: 'programado', provider_configured: false });
  });

  it('does not call the cloud repository for any reminder mutation in Free/Local', async () => {
    const repository = {
      scheduleReminder: vi.fn(async () => ({ ok: true })),
      cancelReminder: vi.fn(async () => ({ ok: true })),
      rescheduleReminder: vi.fn(async () => ({ ok: true }))
    };

    const localSchedule = await scheduleCustomerMessageReminder('customer-a', {
      repository,
      licenseDetails: { plan_code: 'free_trial', features: {} }
    });
    const localCancel = await cancelCustomerMessageReminder('reminder-a', {
      repository,
      licenseDetails: { plan_code: 'free_trial', features: {} }
    });
    const localReschedule = await rescheduleCustomerMessageReminder(
      'reminder-a',
      '2026-09-21T10:00:00.000Z',
      { repository, licenseDetails: { plan_code: 'free_trial', features: {} } }
    );

    expect(localSchedule).toMatchObject({ ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' });
    expect(localCancel).toMatchObject({ ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' });
    expect(localReschedule).toMatchObject({ ok: false, code: 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' });
    expect(repository.scheduleReminder).not.toHaveBeenCalled();
    expect(repository.cancelReminder).not.toHaveBeenCalled();
    expect(repository.rescheduleReminder).not.toHaveBeenCalled();
  });

  it('keeps RPC failures in Spanish and provider-neutral', () => {
    expect(getCustomerMessageReminderErrorCopy('REMINDER_CANCEL_FAILED'))
      .toBe('No se pudo cancelar el recordatorio. Intenta de nuevo.');
    expect(getCustomerMessageReminderErrorCopy('REMINDER_DATE_INVALID'))
      .toBe('La fecha del recordatorio debe ser futura.');
  });
});
