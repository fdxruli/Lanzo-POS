import { describe, expect, it } from 'vitest';
import {
  getSaleDisplayReference,
  getSaleSecondaryReference,
  normalizeSaleTraceability,
  saleMatchesReference
} from '../saleReference';

describe('saleReference', () => {
  it('keeps the financial folio as the primary reference for local sales', () => {
    const sale = { folio: 'V-000035' };
    expect(getSaleDisplayReference(sale)).toBe('V-000035');
    expect(getSaleSecondaryReference(sale)).toBe('Venta local');
    expect(normalizeSaleTraceability(sale)).toEqual({
      salesChannel: 'local',
      ecommerceOrderId: null,
      ecommerceOrderCode: null
    });
  });

  it('uses the ecommerce code as primary and the financial folio as secondary', () => {
    const sale = {
      folio: 'V-000034',
      sales_channel: 'ecommerce',
      ecommerce_order_id: '11111111-1111-4111-8111-111111111111',
      ecommerce_order_code: 'EC-00000115'
    };
    expect(getSaleDisplayReference(sale)).toBe('EC-00000115');
    expect(getSaleSecondaryReference(sale)).toBe('Venta V-000034 · Ecommerce');
    expect(saleMatchesReference(sale, 'EC-00000115')).toBe(true);
    expect(saleMatchesReference(sale, 'V-000034')).toBe(true);
  });

  it('matches every persisted local/cloud sale identity alias', () => {
    const sale = {
      id: 'sale-primary',
      cloud_sale_id: 'sale-cloud',
      localSaleId: 'sale-local',
      metadata: { sale_id: 'sale-metadata' }
    };

    expect(saleMatchesReference(sale, 'sale-primary')).toBe(true);
    expect(saleMatchesReference(sale, 'sale-cloud')).toBe(true);
    expect(saleMatchesReference(sale, 'sale-local')).toBe(true);
    expect(saleMatchesReference(sale, 'sale-metadata')).toBe(true);
  });

  it('accepts legacy metadata without inventing an ecommerce code', () => {
    const legacy = {
      folio: 'V-000010',
      metadata: { ecommerceOrderId: '22222222-2222-4222-8222-222222222222' }
    };
    expect(normalizeSaleTraceability(legacy).salesChannel).toBe('ecommerce');
    expect(getSaleDisplayReference(legacy)).toBe('V-000010');
    expect(getSaleSecondaryReference(legacy)).toBe('Venta V-000010 · Ecommerce');
  });
});
