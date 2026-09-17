import { describe, expect, it } from 'vitest';
import {
  buildAccountStatementMessagePayload,
  buildPaymentMessagePayload,
  hasConfirmedPaymentReceipt,
  selectCreditNotes
} from '../index';

const customer = { id: 'customer-1', name: 'María', phone: '55 1234 5678', debt: '999.99' };
const business = { name: 'Lanzo' };
const occurredAt = '2026-09-17T18:30:00.000Z';

describe('customer messaging financial adapters', () => {
  it('prefers synchronized cloud notes and recognizes all required credit aliases', () => {
    const notes = selectCreditNotes({
      customerId: 'customer-1',
      cloudSummary: {
        noteDetails: [],
        note_details: [
          { id: 'cloud-fiado', customer_id: 'customer-1', payment_method: 'fiado', balance_due: '20.10' },
          { id: 'cloud-credit', customer_id: 'customer-1', payment_method: 'credit', balance_due: '30.20' },
          { id: 'cloud-mixed', customer_id: 'customer-1', payment_method: 'mixed_credit', balance_due: '40.30' },
          { id: 'cloud-customer', customer_id: 'customer-1', payment_method: 'customer_credit', balance_due: '50.40' },
          { id: 'cloud-paid', customer_id: 'customer-1', payment_method: 'efectivo', balance_due: '60.50' }
        ]
      },
      localSales: [{ id: 'local-only', customerId: 'customer-1', paymentMethod: 'credit', saldoPendiente: '123.45' }]
    });

    expect(notes.map((note) => note.id)).toEqual([
      'cloud-fiado',
      'cloud-credit',
      'cloud-mixed',
      'cloud-customer'
    ]);
    expect(notes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'local-only' })]));
  });

  it('uses a cloud customer balance instead of a stale local customer debt and accepts string amounts', () => {
    const result = buildAccountStatementMessagePayload({
      customer,
      business,
      cloudSummary: {
        customer: { current_debt: '70.25', updated_at: occurredAt },
        note_details: [{ id: 'cloud-credit', customer_id: 'customer-1', payment_method: 'credit', balance_due: '70.25' }],
        payments_total: '29.75'
      },
      localSales: [{ id: 'stale-local', customerId: 'customer-1', paymentMethod: 'credit', saldoPendiente: '999.99' }],
      occurredAt,
      timeZone: 'UTC'
    });

    expect(result).toMatchObject({ ok: true });
    expect(result.payload.account).toMatchObject({
      totalBalance: '70.25',
      totalPayments: '29.75',
      cutoffAt: '17/09/2026 18:30'
    });
    expect(result.payload.account.noteDetails.map((note) => note.id)).toEqual(['cloud-credit']);
    expect(result.payload.internalContext.source).toBe('cloud_credit_summary');
  });

  it('uses the confirmed receipt to distinguish a partial payment from a settled account', () => {
    const partial = buildPaymentMessagePayload({
      customer,
      business,
      previousBalance: '100',
      occurredAt,
      receipt: {
        ledger_id: 'ledger-partial',
        amount: '25.25',
        previous_debt: '100.00',
        new_debt: '74.75',
        payment_method: 'efectivo',
        created_at: occurredAt
      },
      timeZone: 'UTC'
    });
    const settled = buildPaymentMessagePayload({
      customer,
      business,
      previousBalance: '74.75',
      occurredAt,
      receipt: {
        ledger_id: 'ledger-settled',
        amount: '74.75',
        previous_debt: '74.75',
        new_debt: '0',
        payment_method: 'efectivo',
        created_at: occurredAt
      },
      timeZone: 'UTC'
    });

    expect(partial).toMatchObject({ ok: true });
    expect(partial.payload.eventType).toBe('payment_partial');
    expect(partial.payload.payment).toMatchObject({ id: 'ledger-partial', previousBalance: '100', amount: '25.25', newBalance: '74.75' });
    expect(settled).toMatchObject({ ok: true });
    expect(settled.payload.eventType).toBe('account_settled');
    expect(settled.payload.payment.newBalance).toBe('0');
  });

  it('does not let a zero-value receipt placeholder override the confirmed operation result', () => {
    const placeholderReceipt = { amount: '0', previousDebt: '0', newDebt: '0' };
    const result = buildPaymentMessagePayload({
      customer,
      business,
      receipt: placeholderReceipt,
      financialResult: { ledgerId: 'ledger-local', amount: '10', newBalance: '40' },
      previousBalance: '50',
      occurredAt,
      timeZone: 'UTC'
    });

    expect(hasConfirmedPaymentReceipt(placeholderReceipt)).toBe(false);
    expect(result).toMatchObject({ ok: true });
    expect(result.payload.eventType).toBe('payment_partial');
    expect(result.payload.payment).toMatchObject({ id: 'ledger-local', amount: '10', previousBalance: '50', newBalance: '40' });
    expect(result.payload.internalContext.source).toBe('customer_credit_confirmed_local_result');
  });
});
