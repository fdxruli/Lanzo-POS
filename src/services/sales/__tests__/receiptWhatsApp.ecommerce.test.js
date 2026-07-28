import { describe, expect, it, vi } from 'vitest';
import { sendReceiptWhatsApp } from '../receiptWhatsApp';

describe('receiptWhatsApp ecommerce traceability', () => {
  it('prints ecommerce and financial references on separate lines', async () => {
    const sendWhatsAppMessage = vi.fn();

    await sendReceiptWhatsApp({
      sale: {
        folio: 'V-000034',
        salesChannel: 'ecommerce',
        ecommerceOrderCode: 'EC-00000115'
      },
      items: [{ name: 'Producto', quantity: 1, price: 31 }],
      paymentData: { customerId: 'customer-1', paymentMethod: 'tarjeta' },
      total: 31,
      companyName: 'Lanzo',
      features: {},
      loadData: vi.fn().mockResolvedValue({ phone: '9990000000' }),
      STORES: { CUSTOMERS: 'customers' },
      sendWhatsAppMessage,
      Logger: { error: vi.fn() }
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      '9990000000',
      expect.stringContaining('*Pedido online:* EC-00000115\n*Folio de venta:* V-000034')
    );
  });
});
