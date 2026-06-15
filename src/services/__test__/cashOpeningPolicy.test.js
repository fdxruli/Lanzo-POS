import { beforeEach, describe, expect, it } from 'vitest';
import {
  CASH_OPENING_POLICY,
  buildAutomaticOpeningData,
  buildManualOpeningData,
  getCashOpeningPolicy,
  setCashOpeningPolicy
} from '../cashOpeningPolicy';

describe('cashOpeningPolicy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('usa apertura manual como politica segura por defecto', () => {
    expect(getCashOpeningPolicy()).toBe(CASH_OPENING_POLICY.MANUAL);
  });

  it('persiste la autoapertura solo cuando se configura explicitamente', () => {
    setCashOpeningPolicy(CASH_OPENING_POLICY.AUTOMATIC);
    expect(getCashOpeningPolicy()).toBe(CASH_OPENING_POLICY.AUTOMATIC);
  });

  it('exige responsable y coincidencia entre fondo y conteo', () => {
    expect(() => buildManualOpeningData({
      montoInicial: '500',
      montoContado: '490',
      responsable: 'Ana'
    }, '500')).toThrow('debe coincidir');

    expect(() => buildManualOpeningData({
      montoInicial: '500',
      montoContado: '500',
      responsable: ''
    }, '500')).toThrow('responsable');
  });

  it('registra la diferencia contra el fondo sugerido', () => {
    const result = buildManualOpeningData({
      montoInicial: '480',
      montoContado: '480',
      responsable: 'Ana'
    }, '500');

    expect(result.diferenciaApertura).toBe('-20');
    expect(result.esAutoApertura).toBe(false);
  });

  it('identifica de forma explicita una apertura automatica', () => {
    const result = buildAutomaticOpeningData('300');
    expect(result.responsable).toContain('Sistema');
    expect(result.politicaApertura).toBe(CASH_OPENING_POLICY.AUTOMATIC);
    expect(result.esAutoApertura).toBe(true);
  });
});
