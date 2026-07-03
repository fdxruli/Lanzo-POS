import { describe, expect, it } from 'vitest';
import {
  calculateDiscountedTotals,
  calculateLineDiscount,
  calculateSaleDiscount,
  validateDiscount
} from '../discounts';

const baseLine = { id: 'prod-1', name: 'Producto', price: 100, quantity: 2 };

describe('manual discounts', () => {
  it('calcula descuento por monto en línea', () => {
    const result = calculateLineDiscount({
      ...baseLine,
      discount: { type: 'amount', value: 30, reason: 'Cortesía' }
    });

    expect(result.subtotal).toBe(200);
    expect(result.discountAmount).toBe(30);
    expect(result.lineTotal).toBe(170);
  });

  it('calcula descuento por porcentaje en línea', () => {
    const result = calculateLineDiscount({
      ...baseLine,
      discount: { type: 'percent', value: 10, reason: 'Promesa comercial' }
    });

    expect(result.subtotal).toBe(200);
    expect(result.discountAmount).toBe(20);
    expect(result.lineTotal).toBe(180);
  });

  it('calcula descuento general por monto', () => {
    const result = calculateSaleDiscount(180, {
      type: 'amount',
      value: 20,
      reason: 'Ajuste manual'
    });

    expect(result.discountAmount).toBe(20);
    expect(result.total).toBe(160);
  });

  it('calcula descuento general por porcentaje sobre subtotal neto de líneas', () => {
    const result = calculateSaleDiscount(180, {
      type: 'percent',
      value: 10,
      reason: 'Cortesía por demora'
    });

    expect(result.discountAmount).toBe(18);
    expect(result.total).toBe(162);
  });

  it('combina descuento por línea y descuento general en orden correcto', () => {
    const result = calculateDiscountedTotals([
      {
        ...baseLine,
        discount: { type: 'percent', value: 10, reason: 'Descuento línea' }
      }
    ], {
      type: 'percent',
      value: 10,
      reason: 'Descuento cuenta'
    });

    expect(result.subtotal).toBe(200);
    expect(result.lineDiscountTotal).toBe(20);
    expect(result.subtotalAfterLineDiscounts).toBe(180);
    expect(result.saleDiscountAmount).toBe(18);
    expect(result.discountTotal).toBe(38);
    expect(result.total).toBe(162);
  });

  it('no permite un descuento mayor al subtotal aplicable en validación estricta', () => {
    expect(() => validateDiscount({
      type: 'amount',
      value: 250,
      reason: 'Inválido'
    }, { subtotal: 200 })).toThrow(/subtotal/);
  });

  it('no permite porcentaje mayor a 100', () => {
    expect(() => validateDiscount({
      type: 'percent',
      value: 101,
      reason: 'Inválido'
    }, { subtotal: 200 })).toThrow(/100/);
  });

  it('requiere motivo cuando el descuento es mayor a cero', () => {
    expect(() => validateDiscount({
      type: 'amount',
      value: 10,
      reason: ''
    }, { subtotal: 200 })).toThrow(/motivo/i);
  });
});
