import { describe, expect, it } from 'vitest';
import { buildBatchPayload } from '../utils/buildBatchPayload';

describe('buildBatchPayload', () => {
  it('crea payload con variantes para lote nuevo', () => {
    const payload = buildBatchPayload({
      batchToEdit: null,
      product: { id: 'prod-1' },
      values: {
        notes: 'nota',
        expiryDate: '2026-03-15',
        attribute1: 'M',
        attribute2: 'Rojo',
        location: 'A-3'
      },
      parsed: {
        nStock: 4,
        nCost: 10,
        nPrice: 20
      },
      features: { hasVariants: true },
      finalSku: 'SKU-TEST-1'
    });

    expect(typeof payload.id).toBe('string');
    expect(payload).toMatchObject({
      productId: 'prod-1',
      cost: 10,
      price: 20,
      stock: 4,
      notes: 'nota',
      trackStock: true,
      isActive: true,
      expiryDate: '2026-03-15',
      sku: 'SKU-TEST-1',
      attributes: {
        talla: 'M',
        color: 'Rojo'
      },
      location: 'A-3'
    });
  });

  it('mantiene id/createdAt de edicion y desactiva si stock es 0', () => {
    const payload = buildBatchPayload({
      batchToEdit: {
        id: 'batch-1',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      product: { id: 'prod-1' },
      values: {
        notes: '',
        expiryDate: '',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 0,
        nCost: 6,
        nPrice: 12
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload).toMatchObject({
      id: 'batch-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      trackStock: false,
      isActive: false,
      attributes: null,
      sku: null
    });
  });
});

