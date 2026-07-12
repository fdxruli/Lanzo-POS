import { describe, expect, it } from 'vitest';
import {
  ECOMMERCE_CHECKOUT_TARGET_CHANGED,
  ECOMMERCE_STALE_CHECKOUT_ATTEMPT,
  POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER,
  buildCheckoutAlreadyActiveResult,
  buildStaleCheckoutAttemptResult,
  ownsCheckoutSnapshot,
  resolveCheckoutTarget
} from '../checkoutTargetIdentity';

const orderA = { id: 'ecom-order-a', origin: 'ecommerce' };
const orderB = { id: 'ecom-order-b', origin: 'ecommerce' };

const makeState = (currentOrderId, orders = [orderA, orderB]) => ({
  currentOrderId,
  activeOrders: new Map(orders.map((order) => [order.id, order]))
});

describe('checkoutTargetIdentity', () => {
  it('resolves the expected ecommerce order while A remains current', () => {
    expect(resolveCheckoutTarget({
      state: makeState(orderA.id),
      expectedOrderId: orderA.id,
      expectedOrigin: 'ecommerce'
    })).toMatchObject({
      success: true,
      orderId: orderA.id,
      activeOrder: orderA
    });
  });

  it('returns controlled target change when currentOrderId moves from A to B', () => {
    expect(resolveCheckoutTarget({
      state: makeState(orderB.id),
      expectedOrderId: orderA.id,
      expectedOrigin: 'ecommerce'
    })).toMatchObject({
      success: false,
      aborted: true,
      targetChanged: true,
      code: ECOMMERCE_CHECKOUT_TARGET_CHANGED,
      orderId: orderA.id
    });
  });

  it('returns controlled target change when A disappears', () => {
    expect(resolveCheckoutTarget({
      state: makeState(orderB.id, [orderB]),
      expectedOrderId: orderA.id,
      expectedOrigin: 'ecommerce'
    })).toMatchObject({
      success: false,
      code: ECOMMERCE_CHECKOUT_TARGET_CHANGED
    });
  });

  it('requires exact order and attempt ownership for a snapshot', () => {
    const snapshot = {
      orderId: orderB.id,
      checkoutAttemptId: 'attempt-b',
      origin: 'ecommerce'
    };

    expect(ownsCheckoutSnapshot({
      snapshot,
      expectedOrderId: orderB.id,
      expectedCheckoutAttemptId: 'attempt-b'
    })).toBe(true);
    expect(ownsCheckoutSnapshot({
      snapshot,
      expectedOrderId: orderA.id,
      expectedCheckoutAttemptId: 'attempt-a'
    })).toBe(false);
  });

  it('reports the active B checkout without invalidating it', () => {
    expect(buildCheckoutAlreadyActiveResult({
      orderId: orderB.id,
      checkoutAttemptId: 'attempt-b'
    })).toEqual({
      success: false,
      ignored: true,
      code: POS_CHECKOUT_ALREADY_ACTIVE_FOR_ANOTHER_ORDER,
      orderId: orderB.id,
      checkoutAttemptId: 'attempt-b',
      message: 'Ya existe otro cobro activo en esta pestaña.'
    });
  });

  it('treats stale owner actions as successful no-ops', () => {
    expect(buildStaleCheckoutAttemptResult()).toEqual({
      success: true,
      ignored: true,
      staleAttempt: true,
      code: ECOMMERCE_STALE_CHECKOUT_ATTEMPT
    });
  });
});
