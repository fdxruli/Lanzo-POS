import { describe, expect, it, vi } from 'vitest';
import { buildLayawayMessagePayload } from '../index';

const common = {
  customer: { id: 'customer-1', name: 'Ana', phone: '5512345678' },
  business: { name: 'Lanzo' },
  occurredAt: '2026-09-17T18:30:00.000Z',
  layaway: {
    id: 'layaway-1',
    reference: 'APA-001',
    items: [{ name: 'Producto', quantity: 1, price: '100' }],
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

describe('layaway message contract adapter', () => {
  it.each(['layaway_created', 'layaway_payment', 'layaway_cancelled'])('uses only the layaway reference for %s', (eventType) => {
    const result = buildLayawayMessagePayload({
      ...common,
      eventType,
      layaway: { ...common.layaway, status: eventType === 'layaway_cancelled' ? 'cancelled' : 'active' }
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.payload.reference).toBe('APA-001');
    expect(result.payload.layaway.saleFolio).toBeNull();
  });

  it('requires zero remaining balance when a layaway is settled', () => {
    const invalid = buildLayawayMessagePayload({ ...common, eventType: 'layaway_settled' });
    expect(invalid).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID' });

    const valid = buildLayawayMessagePayload({
      ...common,
      eventType: 'layaway_settled',
      layaway: { ...common.layaway, totalPaid: '100', balanceDue: '0', status: 'ready' }
    });
    expect(valid).toMatchObject({ ok: true });
    expect(valid.payload.layaway.saleFolio).toBeNull();
  });

  it('permits a final sale folio only on confirmed delivery and performs no financial action', () => {
    const financialService = vi.fn();
    const result = buildLayawayMessagePayload({
      ...common,
      eventType: 'layaway_delivered',
      layaway: {
        ...common.layaway,
        totalPaid: '100',
        balanceDue: '0',
        status: 'completed',
        saleFolio: 'V-DELIVERED-001',
        deliveryDate: '2026-09-18T12:00:00.000Z'
      }
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.payload.layaway.saleFolio).toBe('V-DELIVERED-001');
    expect(financialService).not.toHaveBeenCalled();
  });
});
