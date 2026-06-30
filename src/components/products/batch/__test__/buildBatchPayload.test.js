import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBatchPayload } from '../utils/buildBatchPayload';

describe('buildBatchPayload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
      expiryDate: '2026-03-15T00:00:00.000Z',
      alertTargetDate: '2026-03-15T00:00:00.000Z',
      alertType: 'CADUCIDAD_LEGAL',
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

  it('usa la fecha manual de SHELF_LIFE como caducidad final sin sumar vida util otra vez', () => {
    const payload = buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-shelf',
        expirationMode: 'SHELF_LIFE',
        shelfLifeValue: 7,
        shelfLifeUnit: 'days'
      },
      values: {
        notes: '',
        expiryDate: '2026-03-15',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 5,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload.expiryDate).toBe('2026-03-15T00:00:00.000Z');
    expect(payload.alertTargetDate).toBe('2026-03-15T00:00:00.000Z');
    expect(payload.alertType).toBe('CADUCIDAD_LEGAL');
  });

  it('calcula caducidad automatica de SHELF_LIFE desde hoy cuando no hay fecha manual', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const payload = buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-shelf',
        expirationMode: 'SHELF_LIFE',
        shelfLifeValue: 7,
        shelfLifeUnit: 'days'
      },
      values: {
        notes: '',
        expiryDate: '',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 5,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload.expiryDate).toBe('2026-03-08T00:00:00.000Z');
    expect(payload.alertTargetDate).toBe('2026-03-08T00:00:00.000Z');
    expect(payload.alertType).toBe('VIDA_UTIL_ESTIMADA');
  });

  it('calcula caducidad automatica de SHELF_LIFE con unidades en espanol', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T00:00:00.000Z'));

    const payload = buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-shelf-months',
        expirationMode: 'SHELF_LIFE',
        shelfLifeValue: 7,
        shelfLifeUnit: 'meses'
      },
      values: {
        notes: '',
        expiryDate: '',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 2,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload.expiryDate).toBe('2027-01-24T00:00:00.000Z');
    expect(payload.alertTargetDate).toBe('2027-01-24T00:00:00.000Z');
    expect(payload.alertType).toBe('VIDA_UTIL_ESTIMADA');
  });

  it('mantiene CADUCIDAD_LEGAL para STRICT con fecha explicita y lote fabricante', () => {
    const payload = buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-strict',
        expirationMode: 'STRICT'
      },
      values: {
        notes: '',
        expiryDate: '2026-04-10',
        manufacturerBatchId: 'FAB-001',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 3,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload.expiryDate).toBe('2026-04-10T00:00:00.000Z');
    expect(payload.alertTargetDate).toBe('2026-04-10T00:00:00.000Z');
    expect(payload.alertType).toBe('CADUCIDAD_LEGAL');
    expect(payload.manufacturerBatchId).toBe('FAB-001');
  });

  it('mantiene validacion de lote fabricante obligatorio para STRICT', () => {
    expect(() => buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-strict',
        expirationMode: 'STRICT'
      },
      values: {
        notes: '',
        expiryDate: '2026-04-10',
        manufacturerBatchId: '',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 3,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    })).toThrow('El Lote de Fabricante es obligatorio bajo el modo Estricto.');
  });

  it('mantiene fechas y alertType nulos para NONE sin fecha', () => {
    const payload = buildBatchPayload({
      batchToEdit: null,
      product: {
        id: 'prod-none',
        expirationMode: 'NONE'
      },
      values: {
        notes: '',
        expiryDate: '',
        attribute1: '',
        attribute2: '',
        location: ''
      },
      parsed: {
        nStock: 3,
        nCost: 10,
        nPrice: 15
      },
      features: { hasVariants: false },
      finalSku: null
    });

    expect(payload.expiryDate).toBeNull();
    expect(payload.alertTargetDate).toBeNull();
    expect(payload.alertType).toBeNull();
  });
});
