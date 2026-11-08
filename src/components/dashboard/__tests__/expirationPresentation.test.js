import { describe, expect, it } from 'vitest';
import {
  getExpirationCategory,
  getExpirationStatus,
  getExpirationDateTitle,
  formatExpirationDate
} from '../expirationPresentation';

describe('presentación operativa de caducidad', () => {
  it('separa stock sin lote de vencidos y por vencer', () => {
    expect(getExpirationCategory({ recordType: 'product', daysRemaining: -5 })).toBe('unbatched');
    expect(getExpirationCategory({ type: 'Producto', alertType: 'REGULARIZACION_STOCK' })).toBe('unbatched');
    expect(getExpirationCategory({ type: 'Lote', daysRemaining: -1 })).toBe('expired');
    expect(getExpirationCategory({ type: 'Lote', daysRemaining: 4, alertType: 'CADUCIDAD_LEGAL' })).toBe('upcoming');
    expect(getExpirationCategory({ recordType: 'product', operationalCategory: 'vida_util_vencida', daysRemaining: -3 })).toBe('expired');
  });

  it('reconoce vida útil vencida incluso sin días negativos', () => {
    expect(getExpirationCategory({ alertType: 'VIDA_UTIL_VENCIDA', daysRemaining: 0 })).toBe('expired');
    expect(getExpirationStatus({ alertType: 'VIDA_UTIL_VENCIDA', daysRemaining: 0 })).toBe('Vida útil vencida');
    expect(getExpirationStatus({ recordType: 'product', operationalCategory: 'vida_util_vencida', daysRemaining: -2 })).toBe('Vida útil vencida');
  });

  it('no marca como vencido cualquier lote legal vigente', () => {
    expect(getExpirationStatus({ alertType: 'CADUCIDAD_LEGAL', daysRemaining: 2 })).toBe('Vence en 2 días');
  });

  it('describe hoy, mañana y días anteriores con precisión', () => {
    expect(getExpirationStatus({ daysRemaining: 0 })).toBe('Vence hoy');
    expect(getExpirationStatus({ daysRemaining: 1 })).toBe('Vence mañana');
    expect(getExpirationStatus({ daysRemaining: -1 })).toBe('Venció hace 1 día');
    expect(getExpirationStatus({ daysRemaining: -4 })).toBe('Venció hace 4 días');
  });

  it('distingue revisión de merma y stock sin lote', () => {
    expect(getExpirationStatus({ recordType: 'product' })).toBe('Stock sin lote');
    expect(getExpirationStatus({ alertType: 'REVISION_MERMA', daysRemaining: 8 })).toBe('Revisar merma');
    expect(getExpirationCategory({ alertType: 'REVISION_MERMA', daysRemaining: -3 })).toBe('upcoming');
    expect(getExpirationDateTitle({ alertType: 'REVISION_MERMA' })).toBe('Fecha de revisión');
    expect(getExpirationDateTitle({ alertType: 'VIDA_UTIL_ESTIMADA' })).toBe('Vida útil estimada');
  });

  it('presenta fechas civiles sin desplazar días por zona horaria', () => {
    expect(formatExpirationDate('2026-11-08T00:00:00.000Z')).toBe('08/11/2026');
    expect(formatExpirationDate('2026-11-08')).toBe('08/11/2026');
    expect(formatExpirationDate(null)).toBe('Sin fecha');
  });
});
