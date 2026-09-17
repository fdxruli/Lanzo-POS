import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_MESSAGE_CONTRACTS,
  CUSTOMER_MESSAGE_EVENT_TYPES,
  buildCustomerMessagePayload,
  getCustomerMessageContract,
  validateCustomerMessageFields
} from '../index';

const common = {
  customer: { id: 'customer-1', name: 'María Cliente', phone: '55 1234 5678' },
  business: { name: 'Lanzo Pruebas', phone: '55 8765 4321' },
  occurredAt: '2026-09-17T18:30:00.000Z',
  currency: 'MXN',
  reference: 'REF-001',
  timeZone: 'UTC'
};

const sale = {
  id: 'sale-1',
  folio: 'V-000001',
  items: [{ id: 'line-1', name: 'Producto', quantity: 1, price: '100.00' }],
  subtotal: '100.00',
  discount: '0',
  total: '100.00',
  paymentMethod: 'efectivo',
  amountPaid: '100.00',
  balanceDue: '0'
};

const payment = {
  id: 'payment-1',
  reference: 'AB-000001',
  occurredAt: '2026-09-17T18:30:00.000Z',
  method: 'efectivo',
  previousBalance: '100.00',
  amount: '40.00',
  newBalance: '60.00',
  allocations: [{ saleId: 'sale-1', amountApplied: '40.00' }]
};

const account = {
  cutoffAt: '2026-09-17T18:30:00.000Z',
  totalBalance: '100.00',
  totalPayments: '40.00',
  pendingNotes: [{ id: 'sale-1' }],
  noteDetails: [{ id: 'sale-1', amount: '100.00' }]
};

const layaway = {
  id: 'layaway-1',
  reference: 'AP-000001',
  items: [{ id: 'line-1', name: 'Producto', quantity: 1, price: '100.00' }],
  total: '100.00',
  initialPayment: '20.00',
  previousPaid: '20.00',
  paymentAmount: '30.00',
  totalPaid: '50.00',
  balanceDue: '50.00',
  deadline: '2026-10-05',
  status: 'active'
};

const validInputByEvent = {
  sale_paid: { sale },
  sale_credit: { sale: { ...sale, paymentMethod: 'credit', balanceDue: '80.00', amountPaid: '20.00' } },
  account_statement: { account },
  payment_partial: { payment },
  account_settled: { payment: { ...payment, amount: '100.00', newBalance: '0' } },
  layaway_created: { layaway },
  layaway_payment: { layaway },
  layaway_settled: { layaway: { ...layaway, totalPaid: '100.00', balanceDue: '0', status: 'ready' } },
  layaway_delivered: { layaway: { ...layaway, saleFolio: 'V-000002', deliveryDate: '2026-09-17T18:30:00.000Z', status: 'completed' } },
  layaway_cancelled: { layaway: { ...layaway, status: 'cancelled' } },
  debt_reminder: { account }
};

const build = (eventType, overrides = {}) => buildCustomerMessagePayload({
  ...common,
  eventType,
  ...validInputByEvent[eventType],
  ...overrides
});

describe('customer messaging contracts and payloads', () => {
  it('defines all eleven stable event contracts with reusable field metadata', () => {
    expect(CUSTOMER_MESSAGE_EVENT_TYPES).toEqual([
      'sale_paid',
      'sale_credit',
      'account_statement',
      'payment_partial',
      'account_settled',
      'layaway_created',
      'layaway_payment',
      'layaway_settled',
      'layaway_delivered',
      'layaway_cancelled',
      'debt_reminder'
    ]);

    for (const eventType of CUSTOMER_MESSAGE_EVENT_TYPES) {
      const contract = getCustomerMessageContract(eventType);
      expect(contract).toBe(CUSTOMER_MESSAGE_CONTRACTS[eventType]);
      expect(contract.eventType).toBe(eventType);
      expect(contract.defaultStatus).toBe('ready');
      expect(contract.requiredFields).toContain('eventType');
      expect(contract.requiredFields).toContain('customer.name');
      expect(contract.allowedFields).toEqual(expect.arrayContaining(contract.requiredFields));
      expect(contract.allowedFields).toEqual(expect.arrayContaining(contract.optionalFields));
    }
  });

  it.each(CUSTOMER_MESSAGE_EVENT_TYPES)('builds a valid normalized payload for %s', (eventType) => {
    const result = build(eventType);
    expect(result.ok).toBe(true);
    expect(result.payload.eventType).toBe(eventType);
    expect(result.payload.customer).toMatchObject({ name: 'María Cliente', phone: '55 1234 5678' });
    expect(result.payload.business).toMatchObject({ name: 'Lanzo Pruebas' });
    expect(result.payload.messageData).toMatchObject({
      eventType,
      occurredAt: '17/09/2026 18:30',
      occurredAtIso: '2026-09-17T18:30:00.000Z',
      currency: 'MXN'
    });
  });

  it('rejects an unsupported template variable instead of accepting unknown data', () => {
    expect(validateCustomerMessageFields('sale_paid', ['sale.id', 'sale.unknownField'])).toMatchObject({
      ok: false,
      code: 'MESSAGE_FIELD_UNSUPPORTED',
      unknownFields: ['sale.unknownField']
    });
    expect(validateCustomerMessageFields('unknown_event', ['sale.id'])).toMatchObject({
      ok: false,
      code: 'MESSAGE_EVENT_UNSUPPORTED'
    });
  });

  it('returns a controlled payload error when a required field is missing', () => {
    const result = build('sale_paid', { sale: { ...sale, id: null } });

    expect(result).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(result.errors).toContainEqual({ path: 'sale.id', code: 'MESSAGE_REQUIRED_FIELD_MISSING' });
  });

  it('keeps confirmed decimal values and a credit alias normalized without recalculation', () => {
    const result = build('sale_credit', {
      sale: {
        ...sale,
        payment_method: 'mixed_credit',
        total: '100.50',
        abono: '25.25',
        saldoPendiente: '75.25'
      }
    });

    expect(result.ok).toBe(true);
    expect(result.payload.sale).toMatchObject({
      total: '100.5',
      amountPaid: '25.25',
      balanceDue: '75.25',
      paymentMethod: 'credit',
      originalPaymentMethod: 'mixed_credit'
    });
    expect(result.payload.internalContext).toMatchObject({
      originalPaymentMethod: 'mixed_credit',
      isCredit: true
    });
  });

  it('requires a zero balance for a settled account', () => {
    expect(build('account_settled').ok).toBe(true);

    const invalid = build('account_settled', { payment: { ...payment, newBalance: '0.01' } });
    expect(invalid).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(invalid.errors).toContainEqual({ path: 'payment.newBalance', code: 'ACCOUNT_SETTLED_BALANCE_INVALID' });
  });

  it('keeps a partial payment distinct from an account settlement', () => {
    expect(build('payment_partial').ok).toBe(true);

    const invalid = build('payment_partial', { payment: { ...payment, newBalance: '0' } });
    expect(invalid).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(invalid.errors).toContainEqual({ path: 'payment.newBalance', code: 'PAYMENT_PARTIAL_BALANCE_INVALID' });
  });

  it.each(['layaway_created', 'layaway_payment', 'layaway_settled', 'layaway_cancelled'])('forbids a sale folio before delivery for %s', (eventType) => {
    const result = build(eventType, { layaway: { ...layaway, saleFolio: 'V-TOO-EARLY', status: eventType === 'layaway_cancelled' ? 'cancelled' : layaway.status } });

    expect(result).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(result.errors).toContainEqual({ path: 'layaway.saleFolio', code: 'LAYAWAY_SALE_FOLIO_EARLY' });
  });

  it('requires the final sale folio only when a layaway is delivered', () => {
    const missingFolio = build('layaway_delivered', { layaway: { ...layaway, saleFolio: null } });
    expect(missingFolio).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(missingFolio.errors).toContainEqual({ path: 'layaway.saleFolio', code: 'LAYAWAY_SALE_FOLIO_REQUIRED' });

    const delivered = build('layaway_delivered');
    expect(delivered.ok).toBe(true);
    expect(delivered.payload.layaway).toMatchObject({ reference: 'AP-000001', saleFolio: 'V-000002' });
  });
});
