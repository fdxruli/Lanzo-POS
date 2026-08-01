// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

const tickerMock = vi.hoisted(() => vi.fn());

vi.mock('../../tickerAlertEvents', () => ({
  dispatchTickerInventoryAlert: tickerMock
}));
vi.mock('../../Logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn() }
}));
vi.mock('../../db/databaseRecoveryState', () => ({
  isDatabaseRecoveryPending: () => false
}));

import { notifyProductsChanged } from '../productEvents';

describe('product mutation event contract', () => {
  it('dispatches product id, operation, source and timestamp for local mutations', () => {
    const listener = vi.fn();
    window.addEventListener('lanzo:products-sync-updated', listener);

    notifyProductsChanged({
      productId: 'product-1',
      operation: 'created',
      source: 'productRepository.saveProduct.local',
      timestamp: 100
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      productId: 'product-1',
      productIds: ['product-1'],
      operation: 'created',
      source: 'productRepository.saveProduct.local',
      timestamp: 100
    });
    expect(tickerMock).toHaveBeenCalledWith(['product-1'], {
      reason: 'productRepository.saveProduct.local'
    });

    window.removeEventListener('lanzo:products-sync-updated', listener);
  });
});
