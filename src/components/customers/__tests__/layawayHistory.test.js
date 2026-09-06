import { describe, expect, it } from 'vitest';
import {
  buildHistoricalLayawayFolios,
  isActionableLayaway,
  isTerminalLayaway,
  splitLayawaysForDisplay
} from '../layawayHistory';

describe('layaway history display boundary', () => {
  it('separates terminal history without turning active or ready layaways read-only', () => {
    const sections = splitLayawaysForDisplay([
      { id: 'active', status: 'active', createdAt: '2026-09-01' },
      { id: 'ready', status: 'ready', createdAt: '2026-09-02' },
      { id: 'completed', status: 'completed', createdAt: '2026-09-03' },
      { id: 'cancelled', status: 'cancelled', createdAt: '2026-09-04' }
    ]);

    expect(sections.active.map(({ id }) => id)).toEqual(['ready', 'active']);
    expect(sections.history.map(({ id }) => id)).toEqual(['cancelled', 'completed']);
    expect(isActionableLayaway({ status: 'active' })).toBe(true);
    expect(isActionableLayaway({ status: 'ready' })).toBe(true);
    expect(isTerminalLayaway({ status: 'completed' })).toBe(true);
    expect(isTerminalLayaway({ status: 'cancelled' })).toBe(true);
  });

  it('uses internal identifiers only to join the authorized sale response and exposes a folio only', () => {
    const folios = buildHistoricalLayawayFolios({
      layaways: [
        { id: 'layaway-a', conversionSaleId: 'sale-a' },
        { id: 'layaway-b', conversionSaleId: 'sale-b' }
      ],
      sales: [
        { id: 'sale-a', pos_folio: 'FG-01-000061', security_token: 'tenant-a-secret' },
        { id: 'sale-other-tenant', pos_folio: 'FG-02-000099', security_token: 'tenant-b-secret' }
      ]
    });

    expect(folios).toEqual({ 'layaway-a': 'FG-01-000061' });
    expect(JSON.stringify(folios)).not.toContain('secret');
    expect(JSON.stringify(folios)).not.toContain('sale-a');
  });

  it('does not derive a tenant B reference, payment, or inventory detail from tenant A sales', () => {
    const tenantBLayaway = { id: 'layaway-b', conversionSaleId: 'sale-b' };
    const tenantASales = [{
      id: 'sale-a', pos_folio: 'FG-01-000061',
      payments: [{ id: 'payment-a', amount: 35 }],
      inventory_movements: [{ id: 'inventory-a' }]
    }];

    const folios = buildHistoricalLayawayFolios({
      layaways: [tenantBLayaway],
      sales: tenantASales
    });

    expect(folios).toEqual({});
    expect(JSON.stringify(folios)).not.toContain('FG-01-000061');
    expect(JSON.stringify(folios)).not.toContain('payment-a');
    expect(JSON.stringify(folios)).not.toContain('inventory-a');
  });
});
