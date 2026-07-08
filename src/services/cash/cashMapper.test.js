import { describe, expect, it } from 'vitest';
import {
  cloudCashSessionToLocal,
  localOpeningToCloudPayload
} from './cashMapper.js';

describe('cashMapper cloud opening contract', () => {
  it('does not send local auto-opening flags to Supabase', () => {
    const payload = localOpeningToCloudPayload({
      montoInicial: '100',
      montoContado: '100',
      montoSugerido: '100',
      diferenciaApertura: '0',
      politicaApertura: 'automatic',
      esAutoApertura: true,
      origen: 'operation_requires_cash',
      responsable: 'Sistema'
    });

    expect(payload).toEqual({
      opening_amount: '100',
      opening_counted_amount: '100',
      opening_suggested_amount: '100',
      opening_difference: '0',
      opening_origin: 'operation_requires_cash',
      responsible_name: 'Sistema',
      metadata: {}
    });
    expect(payload).not.toHaveProperty('opening_policy');
    expect(payload).not.toHaveProperty('is_auto_opening');
  });

  it('maps cloud sessions as manual/audited local copies', () => {
    const local = cloudCashSessionToLocal({
      id: 'cash-1',
      status: 'open',
      opened_at: '2026-07-08T00:00:00.000Z',
      opening_amount: '100',
      opening_counted_amount: '100',
      opening_suggested_amount: '100',
      opening_difference: '0',
      opening_policy: 'automatic',
      is_auto_opening: true,
      opening_origin: 'manual',
      responsible_name: 'Cajero'
    });

    expect(local.politica_apertura).toBeNull();
    expect(local.es_auto_apertura).toBe(false);
    expect(local.apertura_origen).toBe('manual');
  });
});
