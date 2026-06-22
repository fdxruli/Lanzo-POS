import { describe, expect, it } from 'vitest';
import {
  getOrderQuantityInputProps,
  getQuantityStepByUnit,
  normalizeQuantityUnit
} from './quantityInputStep';

describe('quantityInputStep', () => {
  it('normaliza unidades antes de resolver el step', () => {
    expect(normalizeQuantityUnit(' KG ')).toBe('kg');
    expect(getQuantityStepByUnit(' KG ')).toBe('0.001');
  });

  it('usa precision de tres decimales para kg y litros', () => {
    expect(getQuantityStepByUnit('kg')).toBe('0.001');
    expect(getQuantityStepByUnit('lt')).toBe('0.001');
    expect(getQuantityStepByUnit('l')).toBe('0.001');
  });

  it('usa enteros para gramos, mililitros y piezas', () => {
    expect(getQuantityStepByUnit('gr')).toBe('1');
    expect(getQuantityStepByUnit('g')).toBe('1');
    expect(getQuantityStepByUnit('ml')).toBe('1');
    expect(getQuantityStepByUnit('pza')).toBe('1');
  });

  it('resuelve props del input desde la unidad de venta del item', () => {
    expect(
      getOrderQuantityInputProps({
        saleType: 'bulk',
        bulkData: { purchase: { unit: 'kg' } }
      })
    ).toMatchObject({
      step: '0.001',
      inputMode: 'decimal',
      unit: 'kg'
    });

    expect(
      getOrderQuantityInputProps({
        saleType: 'bulk',
        unit: 'ml'
      })
    ).toMatchObject({
      step: '1',
      inputMode: 'numeric',
      unit: 'ml'
    });
  });
});
