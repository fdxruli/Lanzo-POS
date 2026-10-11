import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRestaurantOrderPayloadFromOpenSale as transition } from '../restaurantOrderMapper';
import { buildRestaurantOrderPayloadFromOpenSale as production } from './fixtures/productionRestaurantOrderMapper';
import { buildRestaurantOrderPayloadFromOpenSale as pr338 } from './fixtures/pr338RestaurantOrderMapper';

describe('transition matrix uses real mapper outputs', () => {
  it('exports exact Production, PR338 and candidate payloads for the disposable SQL matrix', () => {
    const sale = { id: 'matrix-table', tableData: 'Mesa matriz', total: 50, subtotal: 50,
      cloudRestaurantOrderUpdatedAt: '2026-10-01T00:00:00Z',
      items: [{ id: 'pizza', lineId: 'matrix-line', name: 'Pizza', quantity: 1, price: 50 }] };
    const payloads = Object.fromEntries(Object.entries({ production, pr338, transition })
      .map(([name, mapper]) => [name, mapper({ sale })]));
    expect(payloads.production.order).not.toHaveProperty('expectedParentVersion');
    expect(payloads.pr338.order).not.toHaveProperty('expectedParentVersion');
    expect(payloads.transition.order.expectedParentVersion).toBe(sale.cloudRestaurantOrderUpdatedAt);
    expect(payloads.transition.items[0]).toMatchObject({ localLineId: 'matrix-line', quantity: 1, unitPrice: 50 });
    writeFileSync('.tmp-transition-mapper-payloads.json', JSON.stringify({
      provenance: { production: 'a8547bfc34f483d1d72020114510c8ebea74aace',
        pr338: 'fb17e9a43929d54087ab937cb760a8cd6e087c36', transition: 'working-tree' }, payloads
    }, null, 2));
  });
});
