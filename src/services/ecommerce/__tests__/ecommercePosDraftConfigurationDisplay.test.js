import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeState: null,
  mapDraft: vi.fn(),
  prepareDraft: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: { getState: () => mocks.activeState }
}));

vi.mock('../ecommercePosDraftServiceBase', () => ({
  mapEcommerceOrderToPosDraft: mocks.mapDraft,
  prepareEcommerceOrderPosDraft: mocks.prepareDraft
}));

import {
  mapEcommerceOrderToPosDraft,
  prepareEcommerceOrderPosDraft
} from '../ecommercePosDraftService';

const draft = () => ({
  id: 'ecom-order-1',
  currency: 'MXN',
  origin: 'ecommerce',
  items: [{
    id: 'product-1',
    name: 'Taco al pastor',
    quantity: 1,
    price: 48,
    ecommerceOptions: {
      groups: [{
        id: 'extras',
        name: 'Extras',
        selectionType: 'multiple',
        options: [
          { id: 'cheese', name: 'Queso extra', priceDelta: 10 },
          { id: 'tortillas', name: 'Orden de tortillas', priceDelta: 6 }
        ]
      }]
    }
  }]
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeState = {
    activeOrders: new Map(),
    updateOrder: vi.fn((id, updates) => {
      const current = mocks.activeState.activeOrders.get(id);
      if (current) mocks.activeState.activeOrders.set(id, { ...current, ...updates });
    })
  };
  mocks.mapDraft.mockReturnValue({ success: true, draft: draft() });
  mocks.prepareDraft.mockImplementation(async () => {
    const prepared = draft();
    mocks.activeState.activeOrders.set(prepared.id, prepared);
    return { success: true, draftId: prepared.id, order: prepared };
  });
});

describe('ecommercePosDraftService configuration display', () => {
  it('decorates direct draft mappings with the accepted extras', () => {
    const result = mapEcommerceOrderToPosDraft({ order: { id: 'order-1' } });

    expect(result.draft.items[0]).toMatchObject({
      ecommerceBasePosName: 'Taco al pastor',
      ecommerceConfigurationSummary: expect.stringContaining('Extras: Queso extra'),
      name: expect.stringContaining('Taco al pastor — Extras: Queso extra')
    });
    expect(result.draft.items[0].name).toContain('Orden de tortillas');
  });

  it('updates the prepared draft in the active POS store without duplicating the summary', async () => {
    const first = await prepareEcommerceOrderPosDraft({ order: { id: 'order-1' } });
    const second = await prepareEcommerceOrderPosDraft({ order: { id: 'order-1' } });
    const stored = mocks.activeState.activeOrders.get('ecom-order-1');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(stored.name).toBeUndefined();
    expect(stored.items[0].name.match(/Extras:/g)).toHaveLength(1);
    expect(stored.items[0].ecommerceBasePosName).toBe('Taco al pastor');
    expect(mocks.activeState.updateOrder).toHaveBeenCalled();
  });
});
