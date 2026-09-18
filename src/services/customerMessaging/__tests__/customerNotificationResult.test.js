import { describe, expect, it, vi } from 'vitest';
import {
  buildCustomerMessagePayload,
  createFinancialNotificationResult,
  notificationNotRequested,
  openCustomerNotification
} from '../index';

const buildSalePayload = (phone = '5512345678') => buildCustomerMessagePayload({
  eventType: 'sale_paid',
  customer: { id: 'customer-1', name: 'Ana', phone },
  business: { name: 'Lanzo' },
  occurredAt: '2026-09-17T18:30:00.000Z',
  sale: {
    id: 'sale-1',
    folio: 'V-001',
    items: [{ name: 'Producto', quantity: 1, price: '20' }],
    total: '20',
    paymentMethod: 'efectivo',
    amountPaid: '20'
  }
}).payload;

describe('customer notification result separation', () => {
  it('opens a valid prepared notification without changing the financial result', async () => {
    const financialResult = { status: 'success', saleId: 'sale-1' };
    const opener = vi.fn(() => ({ status: 'opened', code: null }));
    const notificationResult = await openCustomerNotification({ payload: buildSalePayload(), openWhatsApp: opener });
    expect(notificationResult).toMatchObject({ status: 'opened' });
    expect(opener).toHaveBeenCalledWith('+525512345678', expect.stringContaining('TICKET DE VENTA'));
    expect(createFinancialNotificationResult({ financialResult, notificationResult })).toEqual({ financialResult, notificationResult });
  });

  it('returns missing and invalid phone states instead of opening an empty chat', async () => {
    const opener = vi.fn();
    expect(await openCustomerNotification({ payload: buildSalePayload(null), openWhatsApp: opener })).toMatchObject({
      status: 'missing_phone',
      code: 'CUSTOMER_PHONE_MISSING'
    });
    expect(await openCustomerNotification({ payload: buildSalePayload('123'), openWhatsApp: opener })).toMatchObject({
      status: 'invalid_phone',
      code: 'CUSTOMER_PHONE_INVALID'
    });
    expect(opener).not.toHaveBeenCalled();
  });

  it('reports a browser failure separately and supports a notification-only retry', async () => {
    const financialMutation = vi.fn();
    const failed = await openCustomerNotification({
      payload: buildSalePayload(),
      openWhatsApp: () => {
        throw new Error('blocked');
      }
    });
    expect(failed).toMatchObject({ status: 'failed', code: 'WHATSAPP_OPEN_FAILED' });

    const retryOpener = vi.fn(() => true);
    const retried = await openCustomerNotification({ payload: buildSalePayload(), openWhatsApp: retryOpener });
    expect(retried).toMatchObject({ status: 'opened' });
    expect(financialMutation).not.toHaveBeenCalled();
  });

  it('uses only phase-one notification statuses', async () => {
    expect(notificationNotRequested()).toEqual({ status: 'not_requested', code: null });
    expect(await openCustomerNotification({ payload: buildSalePayload(), requested: false })).toEqual({ status: 'not_requested', code: null });
    expect(await openCustomerNotification({ payload: buildSalePayload() })).toMatchObject({ status: 'unsupported' });
  });
});
