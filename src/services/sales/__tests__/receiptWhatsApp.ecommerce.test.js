import { describe, expect, it, vi } from 'vitest';
import { sendReceiptWhatsApp } from '../receiptWhatsApp';

const buildDependencies = () => ({
  companyName: 'Lanzo',
  features: {},
  loadData: vi.fn().mockResolvedValue({ phone: '9990000000' }),
  STORES: { CUSTOMERS: 'customers' },
  sendWhatsAppMessage: vi.fn(),
  Logger: { error: vi.fn() }
});

describe('receiptWhatsApp money formatting and ecommerce traceability', () => {
  it('formats exact-string prices and totals while preserving ecommerce references', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: {
        folio: 'V-000034',
        salesChannel: 'ecommerce',
        ecommerceOrderCode: 'EC-00000115'
      },
      items: [{ name: 'Producto', quantity: '2', price: '15.50' }],
      paymentData: { customerId: 'customer-1', paymentMethod: 'tarjeta' },
      total: '31',
      ...dependencies
    });

    expect(dependencies.sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    const [, receiptText] = dependencies.sendWhatsAppMessage.mock.calls[0];

    expect(receiptText).toContain('*Pedido online:* EC-00000115\n*Folio de venta:* V-000034');
    expect(receiptText).toContain('• Producto (x2) - $31.00');
    expect(receiptText).toContain('*TOTAL: $31.00*');
    expect(dependencies.Logger.error).not.toHaveBeenCalled();
  });

  it('calculates cash change from exact-string monetary values', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: { folio: 'V-000035' },
      items: [{ name: 'Producto', quantity: 1, price: '31' }],
      paymentData: {
        customerId: 'customer-1',
        paymentMethod: 'efectivo',
        amountPaid: '50'
      },
      total: '31',
      ...dependencies
    });

    const [, receiptText] = dependencies.sendWhatsAppMessage.mock.calls[0];
    expect(receiptText).toContain('*TOTAL: $31.00*');
    expect(receiptText).toContain('Cambio: $19.00');
    expect(dependencies.Logger.error).not.toHaveBeenCalled();
  });

  it('formats credit payment and pending balance from exact strings', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: { folio: 'V-000036' },
      items: [{ name: 'Producto', quantity: 1, price: '31' }],
      paymentData: {
        customerId: 'customer-1',
        paymentMethod: 'fiado',
        amountPaid: '10',
        saldoPendiente: '21'
      },
      total: '31',
      ...dependencies
    });

    const [, receiptText] = dependencies.sendWhatsAppMessage.mock.calls[0];
    expect(receiptText).toContain('Abono: $10.00');
    expect(receiptText).toContain('Saldo Pendiente: $21.00');
    expect(dependencies.Logger.error).not.toHaveBeenCalled();
  });

  it('does not send a malformed ticket when a monetary value is invalid', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: { folio: 'V-000037' },
      items: [{ name: 'Producto', quantity: 1, price: '31' }],
      paymentData: { customerId: 'customer-1', paymentMethod: 'tarjeta' },
      total: 'invalid-total',
      ...dependencies
    });

    expect(dependencies.sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(dependencies.Logger.error).toHaveBeenCalledWith(
      'Error enviando ticket:',
      expect.any(Error)
    );
  });
});
