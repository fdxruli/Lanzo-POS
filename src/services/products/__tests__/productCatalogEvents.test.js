// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const channelMocks = vi.hoisted(() => ({ instances: [] }));

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    this.postMessage = vi.fn();
    this.close = vi.fn();
    channelMocks.instances.push(this);
  }

  addEventListener(_name, listener) {
    this.listeners.add(listener);
  }

  removeEventListener(_name, listener) {
    this.listeners.delete(listener);
  }
}

vi.mock('../../Logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn() }
}));
vi.mock('../../db/databaseRecoveryState', () => ({
  isDatabaseRecoveryPending: () => false
}));

import {
  broadcastDBChange,
  getProductCatalogEventsDiagnostics,
  resetProductCatalogEventsForTests,
  subscribeProductCatalogEvents
} from '../productCatalogEvents';

beforeEach(() => {
  channelMocks.instances.length = 0;
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  resetProductCatalogEventsForTests();
});
afterEach(() => {
  resetProductCatalogEventsForTests();
  vi.unstubAllGlobals();
});

describe('product catalog event infrastructure', () => {
  it('shares one BroadcastChannel and cleans it after the last subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeProductCatalogEvents(first);
    const unsubscribeSecond = subscribeProductCatalogEvents(second);

    expect(channelMocks.instances).toHaveLength(1);
    expect(getProductCatalogEventsDiagnostics()).toMatchObject({
      subscriberCount: 2,
      infrastructureInstalled: true,
      hasBroadcastChannel: true
    });

    window.dispatchEvent(new CustomEvent('lanzo:products-sync-updated', {
      detail: {
        productId: 'product-1',
        productIds: ['product-1'],
        operation: 'updated',
        source: 'productRepository.saveProduct',
        timestamp: 123
      }
    }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      productIds: ['product-1'],
      operation: 'updated',
      source: 'productRepository.saveProduct',
      timestamp: 123
    }));

    broadcastDBChange({
      action: 'product-updated',
      productId: 'product-1',
      source: 'ProductsPage',
      timestamp: 456
    });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(channelMocks.instances[0].postMessage).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-1',
      operation: 'updated',
      source: 'ProductsPage',
      timestamp: 456
    }));

    for (const listener of channelMocks.instances[0].listeners) {
      listener({
        data: {
          type: 'db-changed',
          timestamp: 789,
          metadata: {
            productId: 'product-2',
            operation: 'synced',
            source: 'productSyncHandler.pullCatalogChanges',
            timestamp: 789
          }
        }
      });
    }
    expect(first).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: 'product-2',
      operation: 'synced',
      timestamp: 789
    }));

    unsubscribeFirst();
    unsubscribeSecond();
    expect(channelMocks.instances[0].close).toHaveBeenCalledTimes(1);
    expect(getProductCatalogEventsDiagnostics().subscriberCount).toBe(0);
  });
});
