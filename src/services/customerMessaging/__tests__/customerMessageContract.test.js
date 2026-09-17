import { describe, expect, it } from 'vitest';
import {
  buildCustomerMessagePayload,
  CUSTOMER_MESSAGE_EVENT_TYPES,
  validateCustomerMessageFields
} from '../index';

const common = {
  customer: { id: 'customer-1', name: 'Ana', phone: '5512345678' },
  business: { name: 'Lanzo', phone: '5511111111' },
  occurredAt: '2026-09-17T18:30:00.000Z',
  currency: 'MXN',
  sale: {
    id: 'sale-1',
    folio: 'V-001',
    items: [{ id: 'item-1', name: 'Producto', quantity: 1, price: '100', exactTotal: '100' }],
    subtotal: '100',
    discount: '0',
    total: '100',
    paymentMethod: 'credit',
    amountPaid: '20',
    balanceDue: '80',
    dueDate: '2026-09-25',
    creditStatus: 'VIGENTE'
  },
  payment: {
    id: 'ledger-1',
    reference: 'ledger-1',
    occurredAt: '2026-09-17T18:30:00.000Z',
    method: 'efectivo',
    previousBalance: '80',
    amount: '20',
    newBalance: '60',
    allocations: []
  },
  account: {
    cutoffAt: '2026-09-17T18:30:00.000Z',
    totalBalance: '60',
    totalPayments: '20',
    pendingNotes: [],
    noteDetails: []
  },
  layaway: {
    id: 'layaway-1',
    reference: 'APA-001',
    items: [{ id: 'item-1', name: 'Producto', quantity: 1, price: '100' }],
    total: '100',
    initialPayment: '20',
    previousPaid: '20',
    paymentAmount: '30',
    totalPaid: '50',
    balanceDue: '50',
    deadline: '2026-09-30',
    status: 'active'
  }
};

const eventInput = (eventType) => {
  const input = structuredClone(common);
  input.eventType = eventType;
  if (eventType === 'sale_paid') {
    input.sale.paymentMethod = 'efectivo';
    input.sale.balanceDue = '0';
  }
  if (eventType === 'account_settled') {
    input.payment.newBalance = '0';
    input.account.totalBalance = '0';
  }
  if (eventType === 'layaway_settled') {
    input.layaway.totalPaid = '100';
    input.layaway.balanceDue = '0';
    input.layaway.status = 'ready';
  }
  if (eventType === 'layaway_delivered') {
    input.layaway.totalPaid = '100';
    input.layaway.balanceDue = '0';
    input.layaway.status = 'completed';
    input.layaway.saleFolio = 'V-DELIVERED-1';
  }
  if (eventType === 'layaway_cancelled') input.layaway.status = 'cancelled';
  return input;
};

describe('customer message contracts', () => {
  it('defines and builds valid payloads for every supported event', () => {
    expect(CUSTOMER_MESSAGE_EVENT_TYPES).toHaveLength(11);
    CUSTOMER_MESSAGE_EVENT_TYPES.forEach((eventType) => {
      const result = buildCustomerMessagePayload(eventInput(eventType));
      expect(result.ok, eventType).toBe(true);
      expect(result.payload.eventType).toBe(eventType);
      expect(result.payload.financialData).toBeDefined();
      expect(result.payload.customerData.name).toBe('Ana');
      expect(result.payload.businessData.name).toBe('Lanzo');
    });
  });

  it('rejects missing required fields and unknown template variables in a controlled way', () => {
    const invalid = eventInput('sale_paid');
    invalid.customer.name = '';
    expect(buildCustomerMessagePayload(invalid)).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
    expect(validateCustomerMessageFields('sale_paid', ['sale.total', 'customer.favoriteColor'])).toMatchObject({
      ok: false,
      code: 'MESSAGE_FIELD_UNSUPPORTED',
      unknownFields: ['customer.favoriteColor']
    });
  });

  it('does not permit an early layaway sale folio and requires one at delivery', () => {
    const early = eventInput('layaway_payment');
    early.layaway.saleFolio = 'V-EARLY';
    expect(buildCustomerMessagePayload(early)).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });

    const delivery = eventInput('layaway_delivered');
    delete delivery.layaway.saleFolio;
    expect(buildCustomerMessagePayload(delivery)).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
  });

  it('distinguishes settled accounts from partial payments', () => {
    const settled = eventInput('account_settled');
    expect(buildCustomerMessagePayload(settled)).toMatchObject({ ok: true });
    settled.payment.newBalance = '1';
    expect(buildCustomerMessagePayload(settled)).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });

    const partial = eventInput('payment_partial');
    expect(buildCustomerMessagePayload(partial)).toMatchObject({ ok: true });
    partial.payment.newBalance = '0';
    expect(buildCustomerMessagePayload(partial)).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });
  });
});
