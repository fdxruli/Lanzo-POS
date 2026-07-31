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
    expect(receiptText).not.toContain('*Subtotal:*');
    expect(receiptText).not.toContain('*Descuento');
    expect(dependencies.Logger.error).not.toHaveBeenCalled();
  });

  it('shows subtotal, discount detail, final total, received cash and change', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: {
        folio: 'V-000038',
        subtotal: '50',
        discountTotal: '40',
        saleDiscount: {
          type: 'percent',
          value: 80,
          amount: 40,
          reason: 'Promoción'
        }
      },
      items: [{ name: 'Producto Genérico', quantity: 1, price: '50' }],
      paymentData: {
        customerId: 'customer-1',
        paymentMethod: 'efectivo',
        amountPaid: '20'
      },
      total: '10',
      ...dependencies
    });

    const [, receiptText] = dependencies.sendWhatsAppMessage.mock.calls[0];
    expect(receiptText).toContain('• Producto Genérico (x1) - $50.00');
    expect(receiptText).toContain('*Subtotal:* $50.00');
    expect(receiptText).toContain('*Descuento (80% · Promoción):* -$40.00');
    expect(receiptText).toContain('*TOTAL: $10.00*');
    expect(receiptText).toContain('Efectivo recibido: $20.00');
    expect(receiptText).toContain('Cambio: $10.00');
    expect(dependencies.Logger.error).not.toHaveBeenCalled();
  });

  it('reads aggregate discount data from metadata when needed', async () => {
    const dependencies = buildDependencies();

    await sendReceiptWhatsApp({
      sale: {
        folio: 'V-000039',
        subtotal: '100',
        metadata: { discountTotal: '15' }
      },
      items: [{ name: 'Producto', quantity: 2, price: '50' }],
      paymentData: { customerId: 'customer-1', paymentMethod: 'tarjeta' },
      total: '85',
      ...dependencies
    });

    const [, receiptText] = dependencies.sendWhatsAppMessage.mock.calls[0];
    expect(receiptText).toContain('*Subtotal:* $100.00');
    expect(receiptText).toContain('*Descuento:* -$15.00');
    expect(receiptText).toContain('*TOTAL: $85.00*');
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
    expect(receiptText).toContain('Efectivo recibido: $50.00');
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
