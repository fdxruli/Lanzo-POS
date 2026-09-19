import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateSale: vi.fn(),
  loadRecentSales: vi.fn(() => Promise.resolve())
}));

vi.mock('../../database', () => ({
  db: {
    table: () => ({ update: mocks.updateSale })
  }
}));

vi.mock('../../../store/useSalesStore', () => ({
  useSalesStore: {
    getState: () => ({ loadRecentSales: mocks.loadRecentSales })
  }
}));

vi.mock('../../customerMessaging/index.js', () => ({
  notificationNotRequested: () => ({ status: 'not_requested', code: null }),
  prepareCustomerMessageOutbox: vi.fn()
}));

import { runPostSaleEffects } from '../postSaleEffects';

const makeArgs = ({
  eventType = 'sale_paid',
  sendReceipt = true,
  prepareResult = {
    ok: true,
    duplicate: false,
    record: { idempotencyKey: 'cm_sale', status: 'preparado', eventType: 'sale_paid' }
  }
} = {}) => {
  const sendReceiptWhatsApp = vi.fn(async () => ({
    status: 'ready',
    code: 'IMAGE_SHARE_USER_ACTION_REQUIRED',
    payload: {
      eventType,
      customer: { id: 'customer-tech', name: 'Cliente' },
      business: { name: 'Negocio' },
      occurredAt: '2026-09-18T20:00:00.000Z'
    }
  }));
  const prepareMessageOutbox = vi.fn(async () => prepareResult);
  const updateStatsForNewSale = vi.fn(async () => undefined);

  return {
    args: {
      sale: {
        id: 'sale-tech',
        timestamp: '2026-09-18T20:00:00.000Z',
        postEffectsCompleted: false
      },
      processedItems: [{ id: 'product-1', quantity: 1, cost: 4, price: 10 }],
      paymentData: { sendReceipt },
      total: '10.00',
      companyName: 'Negocio',
      features: {},
      STORES: { SALES: 'sales' },
      useStatsStore: { getState: () => ({ updateStatsForNewSale }) },
      roundCurrency: (value) => Math.round(value * 100) / 100,
      sendReceiptWhatsApp,
      prepareMessageOutbox,
      Logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn()
      }
    },
    sendReceiptWhatsApp,
    prepareMessageOutbox,
    updateStatsForNewSale
  };
};

describe('post-sale customer messaging outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSale.mockResolvedValue(1);
  });

  it.each(['sale_paid', 'sale_credit'])('creates the %s outbox only after receipt preparation in the successful post-effect', async (eventType) => {
    const setup = makeArgs({
      eventType,
      prepareResult: {
        ok: true,
        duplicate: false,
        record: { idempotencyKey: `cm_${eventType}`, status: 'preparado', eventType }
      }
    });

    const result = await runPostSaleEffects(setup.args);

    expect(setup.updateStatsForNewSale).toHaveBeenCalledOnce();
    expect(setup.sendReceiptWhatsApp).toHaveBeenCalledOnce();
    expect(setup.prepareMessageOutbox).toHaveBeenCalledOnce();
    expect(setup.prepareMessageOutbox).toHaveBeenCalledWith({
      payload: expect.objectContaining({ eventType })
    });
    expect(setup.sendReceiptWhatsApp.mock.invocationCallOrder[0])
      .toBeLessThan(setup.prepareMessageOutbox.mock.invocationCallOrder[0]);
    expect(result.notificationResult).toMatchObject({
      status: 'ready',
      outboxRecord: {
        status: 'preparado',
        eventType
      }
    });
    expect(setup.args.sale.postEffectsCompleted).toBe(true);
    expect(mocks.updateSale).toHaveBeenCalledWith('sale-tech', { postEffectsCompleted: true });
  });

  it('does not create an outbox when receipt preparation is not requested', async () => {
    const setup = makeArgs({ sendReceipt: false });

    const result = await runPostSaleEffects(setup.args);

    expect(result.notificationResult).toEqual({ status: 'not_requested', code: null });
    expect(setup.sendReceiptWhatsApp).not.toHaveBeenCalled();
    expect(setup.prepareMessageOutbox).not.toHaveBeenCalled();
    expect(setup.args.sale.postEffectsCompleted).toBe(true);
  });

  it('keeps the committed sale successful when outbox persistence fails', async () => {
    const setup = makeArgs({
      prepareResult: { ok: false, code: 'OUTBOX_PERSISTENCE_FAILED' }
    });

    const result = await runPostSaleEffects(setup.args);

    expect(result.notificationResult).toMatchObject({
      status: 'ready',
      outboxErrorCode: 'OUTBOX_PERSISTENCE_FAILED'
    });
    expect(setup.args.sale.postEffectsCompleted).toBe(true);
    expect(mocks.updateSale).toHaveBeenCalledOnce();
  });

  it('coalesces a repeated post-effect through the existing sale seal before messaging runs again', async () => {
    const setup = makeArgs();
    setup.args.sale.postEffectsCompleted = true;

    const result = await runPostSaleEffects(setup.args);

    expect(result).toMatchObject({
      skipped: true,
      notificationResult: { status: 'not_requested' }
    });
    expect(setup.sendReceiptWhatsApp).not.toHaveBeenCalled();
    expect(setup.prepareMessageOutbox).not.toHaveBeenCalled();
    expect(mocks.updateSale).not.toHaveBeenCalled();
  });
});
