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
      detail: { productIds: ['product-1'] }
    }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    broadcastDBChange({ action: 'product-updated' });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(channelMocks.instances[0].postMessage).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(channelMocks.instances[0].close).toHaveBeenCalledTimes(1);
    expect(getProductCatalogEventsDiagnostics().subscriberCount).toBe(0);
  });
});
