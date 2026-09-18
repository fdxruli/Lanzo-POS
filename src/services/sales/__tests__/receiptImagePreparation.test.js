import { describe, expect, it, vi } from 'vitest';
import { sendReceiptWhatsApp } from '../receiptWhatsApp';

describe('sale receipt image preparation', () => {
  it('prepares a normalized payload without opening text or depending on phone', async () => {
    const textOpener = vi.fn();
    const result = await sendReceiptWhatsApp({
      sale: {
        id: 'sale-1',
        folio: 'V-001',
        timestamp: '2026-09-18T12:30:00.000Z',
        total: '250.00',
        paymentMethod: 'efectivo',
        customerName: 'Cliente sin telefono'
      },
      items: [{ id: 'p-1', name: 'Producto', quantity: 1, total: '250.00' }],
      paymentData: { sendReceipt: true },
      total: '250.00',
      companyName: 'Mi negocio',
      sendWhatsAppMessage: textOpener
    });

    expect(result).toMatchObject({
      status: 'ready',
      code: 'IMAGE_SHARE_USER_ACTION_REQUIRED',
      payload: { eventType: 'sale_paid' }
    });
    expect(textOpener).not.toHaveBeenCalled();
  });

  it('keeps the not-requested compatibility outcome', async () => {
    const result = await sendReceiptWhatsApp({ paymentData: { sendReceipt: false } });
    expect(result).toEqual({ status: 'not_requested', code: null });
  });
});

