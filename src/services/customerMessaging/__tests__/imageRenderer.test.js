import { describe, expect, it, vi } from 'vitest';
import { buildCustomerMessagePayload } from '../payloadBuilder';
import {
  buildImageReceiptModel,
  renderCustomerMessageImage,
  sanitizeImageFilename
} from '../imageRenderer';

const base = {
  customer: { id: 'c-1', name: 'Cliente con un nombre suficientemente largo para probar saltos seguros', phone: null },
  business: { name: 'Negocio de Prueba' },
  occurredAt: '2026-09-18T12:30:00.000Z',
  currency: 'MXN',
  reference: 'FOLIO / 001'
};

const eventData = {
  sale_paid: { sale: { id: 's-1', total: '1234.50', paymentMethod: 'efectivo', receivedAmount: '1500', items: [{ name: 'Producto con nombre muy largo '.repeat(8), quantity: 2, total: '1234.50' }] } },
  sale_credit: { sale: { id: 's-2', total: '900', paymentMethod: 'fiado', balanceDue: '700', amountPaid: '200', dueDate: '2026-10-01' } },
  account_statement: { account: { totalBalance: '700', totalPayments: '200', cutoffAt: '2026-09-18', noteDetails: Array.from({ length: 20 }, (_, index) => ({ id: `n-${index}`, saldoPendiente: '35' })) } },
  payment_partial: { payment: { amount: '200', previousBalance: '900', newBalance: '700', method: 'efectivo' } },
  account_settled: { payment: { amount: '900', previousBalance: '900', newBalance: '0', method: 'efectivo' } },
  layaway_created: { layaway: { id: 'l-1', reference: 'A-1', total: '1000', initialPayment: '200', balanceDue: '800' } },
  layaway_payment: { layaway: { id: 'l-1', reference: 'A-1', paymentAmount: '200', totalPaid: '400', balanceDue: '600' } },
  layaway_settled: { layaway: { id: 'l-1', reference: 'A-1', totalPaid: '1000', balanceDue: '0' } },
  layaway_delivered: { layaway: { id: 'l-1', reference: 'A-1', saleFolio: 'V-1' } },
  layaway_cancelled: { layaway: { id: 'l-1', reference: 'A-1', status: 'cancelled' } },
  debt_reminder: { account: { totalBalance: '700', cutoffAt: '2026-09-18' } }
};

const canvasFactory = () => {
  const context = {
    font: '', fillStyle: '', textBaseline: '',
    measureText: (value) => ({ width: String(value).length * 18 }),
    fillRect: vi.fn(), fillText: vi.fn()
  };
  return {
    width: 0, height: 0,
    getContext: () => context,
    toBlob: (callback) => callback(new Blob(['png-bytes'], { type: 'image/png' }))
  };
};

class TestFile extends Blob {
  constructor(parts, name, options) {
    super(parts, options);
    this.name = name;
  }
}

describe('customer message PNG renderer', () => {
  for (const [eventType, data] of Object.entries(eventData)) {
    it(`renders ${eventType} from a normalized Phase 1 payload`, async () => {
      const payloadResult = buildCustomerMessagePayload({ ...base, eventType, ...data });
      expect(payloadResult.ok).toBe(true);
      const result = await renderCustomerMessageImage(payloadResult.payload, { canvasFactory, FileCtor: TestFile });
      expect(result).toMatchObject({ ok: true, eventType, mimeType: 'image/png' });
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.filename).toMatch(/^[a-z0-9_-]+\.png$/);
      expect(result.file.type).toBe('image/png');
    });
  }

  it('rejects incomplete payloads without throwing', async () => {
    const result = await renderCustomerMessageImage({ eventType: 'sale_paid' }, { canvasFactory, FileCtor: TestFile });
    expect(result).toMatchObject({ ok: false, code: 'MESSAGE_PAYLOAD_INVALID', eventType: 'sale_paid' });
  });

  it('creates safe filenames', () => {
    expect(sanitizeImageFilename('../../Recibo José ?text=<script>')).toBe('recibo-jose-text-script.png');
  });

  it('returns a controlled canvas error in Node/SSR', async () => {
    const payloadResult = buildCustomerMessagePayload({ ...base, eventType: 'sale_paid', ...eventData.sale_paid });
    const result = await renderCustomerMessageImage(payloadResult.payload, { canvasFactory: () => null });
    expect(result).toMatchObject({ ok: false, code: 'IMAGE_CANVAS_UNAVAILABLE' });
  });

  it('builds a model without HTML execution or financial recalculation', () => {
    const payloadResult = buildCustomerMessagePayload({ ...base, eventType: 'sale_paid', ...eventData.sale_paid });
    payloadResult.payload.customer.name = '<img src=x onerror=alert(1)>';
    const result = buildImageReceiptModel(payloadResult.payload);
    expect(result.ok).toBe(true);
    expect(result.model.rows[0].value).toContain('<img');
    expect(result.model.rows.some((row) => row.label === 'Total' && row.value === '$1,234.50')).toBe(true);
  });
});

