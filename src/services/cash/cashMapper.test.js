import { describe, expect, it } from 'vitest';
import {
  cloudCashMovementToLocal,
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

  it('projects the server station and separates a legacy local key when cloud data omits it', () => {
    const stationId = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';
    const canonical = cloudCashSessionToLocal({
      id: 'cash-canonical',
      status: 'open',
      metadata: { cash_station_id: stationId }
    });
    const legacy = cloudCashSessionToLocal({
      id: 'cash-legacy',
      status: 'open'
    }, {
      id: 'cash-legacy',
      cashStationId: null,
      localStationKey: 'local:device:fp-browser-a',
      cashIdentityState: 'deterministic-device-bound'
    });

    expect(canonical).toMatchObject({
      cashStationId: stationId,
      cashIdentityState: 'canonical'
    });
    expect(legacy).toMatchObject({
      cashStationId: null,
      localStationKey: 'local:device:fp-browser-a',
      cashIdentityState: 'deterministic-device-bound'
    });
  });

  it('preserves cloud sale and reference aliases used by Caja enrichment', () => {
    const local = cloudCashMovementToLocal({
      id: 'movement-1',
      cash_session_id: 'cash-1',
      type: 'venta',
      amount: '31',
      reference_type: 'sale',
      reference_id: 'sale-1',
      sale_id: 'sale-1',
      metadata: {
        sale_id: 'sale-1'
      }
    });

    expect(local).toMatchObject({
      saleId: 'sale-1',
      sale_id: 'sale-1',
      referenceType: 'sale',
      reference_type: 'sale',
      referenceId: 'sale-1',
      reference_id: 'sale-1'
    });
  });
});
