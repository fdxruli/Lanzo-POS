import { describe, expect, it, vi } from 'vitest';
import {
  buildCustomerMessagePayload,
  createFinancialNotificationResult,
  getNotificationReadiness,
  notificationNotRequested,
  openCustomerNotification
} from '../index';

const buildSalePayload = ({ phone = '55 1234 5678' } = {}) => {
  const result = buildCustomerMessagePayload({
    eventType: 'sale_paid',
    customer: { id: 'customer-1', name: 'María Cliente', phone },
    business: { name: 'Lanzo Pruebas' },
    occurredAt: '2026-09-17T18:30:00.000Z',
    currency: 'MXN',
    sale: {
      id: 'sale-1',
      folio: 'V-000001',
      items: [{ id: 'line-1', name: 'Producto', quantity: 1, price: '100.00' }],
      total: '100.00',
      paymentMethod: 'efectivo',
      amountPaid: '100.00'
    },
    timeZone: 'UTC'
  });

  if (!result.ok) throw new Error(`Test fixture payload was invalid: ${JSON.stringify(result.errors)}`);
  return result.payload;
};

describe('customer notification results', () => {
  it('reports not_requested without evaluating a phone or opening WhatsApp', async () => {
    const opener = vi.fn();
    const payload = buildSalePayload({ phone: null });

    expect(notificationNotRequested()).toEqual({ status: 'not_requested', code: null });
    expect(getNotificationReadiness(payload, { requested: false })).toEqual({ status: 'not_requested', code: null });
    await expect(openCustomerNotification({ payload, requested: false, openWhatsApp: opener }))
      .resolves.toEqual({ status: 'not_requested', code: null });
    expect(opener).not.toHaveBeenCalled();
  });

  it('returns controlled readiness statuses for absent, invalid, and invalid payload data', async () => {
    const missing = buildSalePayload({ phone: null });
    const invalid = buildSalePayload({ phone: 'not-a-phone' });

    expect(getNotificationReadiness(undefined)).toEqual({ status: 'payload_invalid', code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(getNotificationReadiness(missing)).toEqual({ status: 'missing_phone', code: 'CUSTOMER_PHONE_MISSING' });
    expect(getNotificationReadiness(invalid)).toEqual({ status: 'invalid_phone', code: 'CUSTOMER_PHONE_INVALID' });
    await expect(openCustomerNotification({ payload: missing })).resolves.toEqual({ status: 'missing_phone', code: 'CUSTOMER_PHONE_MISSING' });
    await expect(openCustomerNotification({ payload: invalid })).resolves.toEqual({ status: 'invalid_phone', code: 'CUSTOMER_PHONE_INVALID' });
  });

  it('opens a prepared customer message with a normalized E.164 phone', async () => {
    const opener = vi.fn().mockResolvedValue(undefined);
    const result = await openCustomerNotification({ payload: buildSalePayload(), openWhatsApp: opener });

    expect(result).toEqual({ status: 'opened', code: null, phone: '+525512345678' });
    expect(opener).toHaveBeenCalledOnce();
    expect(opener).toHaveBeenCalledWith(
      '+525512345678',
      expect.stringContaining('*--- TICKET DE VENTA ---*')
    );
    expect(result.status).not.toBe('sent');
  });

  it('returns unsupported when no opener is available and failed when the browser blocks a window', async () => {
    const payload = buildSalePayload();

    await expect(openCustomerNotification({ payload })).resolves.toEqual({
      status: 'unsupported',
      code: 'WHATSAPP_OPENER_UNAVAILABLE'
    });
    await expect(openCustomerNotification({ payload, openWhatsApp: vi.fn().mockResolvedValue(false) })).resolves.toEqual({
      status: 'failed',
      code: 'WHATSAPP_WINDOW_BLOCKED'
    });
  });

  it('passes through an explicit user cancellation without treating it as financial failure', async () => {
    const cancelled = { status: 'cancelled', code: 'CUSTOMER_CANCELLED' };
    const result = await openCustomerNotification({
      payload: buildSalePayload(),
      openWhatsApp: vi.fn().mockResolvedValue(cancelled)
    });

    expect(result).toBe(cancelled);
  });

  it('converts an unsupported opener status into a controlled failure', async () => {
    const result = await openCustomerNotification({
      payload: buildSalePayload(),
      openWhatsApp: vi.fn().mockResolvedValue({ status: 'sent', code: null })
    });

    expect(result).toEqual({ status: 'failed', code: 'NOTIFICATION_RESULT_INVALID' });
    expect(result.status).not.toBe('sent');
  });

  it('keeps a successful financial result when WhatsApp throws and a retry only opens messaging', async () => {
    const executeFinancialOperation = vi.fn(() => ({ status: 'success', saleId: 'sale-1' }));
    const financialResult = executeFinancialOperation();
    const payload = buildSalePayload();
    const openingError = Object.assign(new Error('Popup blocked'), { code: 'POPUP_BLOCKED' });

    const failedNotification = await openCustomerNotification({
      payload,
      openWhatsApp: vi.fn().mockRejectedValue(openingError)
    });
    const initialResult = createFinancialNotificationResult({ financialResult, notificationResult: failedNotification });

    expect(initialResult).toEqual({
      financialResult: { status: 'success', saleId: 'sale-1' },
      notificationResult: { status: 'failed', code: 'POPUP_BLOCKED', message: 'Popup blocked' }
    });
    expect(executeFinancialOperation).toHaveBeenCalledTimes(1);

    const retryOpener = vi.fn().mockResolvedValue(undefined);
    const retryNotification = await openCustomerNotification({ payload, openWhatsApp: retryOpener });
    const retryResult = createFinancialNotificationResult({ financialResult, notificationResult: retryNotification });

    expect(retryResult.financialResult).toBe(financialResult);
    expect(retryResult.notificationResult).toMatchObject({ status: 'opened', code: null });
    expect(retryOpener).toHaveBeenCalledOnce();
    expect(executeFinancialOperation).toHaveBeenCalledTimes(1);
  });
});
