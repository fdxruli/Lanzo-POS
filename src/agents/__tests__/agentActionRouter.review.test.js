import { describe, expect, it, vi } from 'vitest';
import {
  executeAgentAction,
  resolveAgentAction,
  resolveAgentRecordReviewAction
} from '../agentActionRouter';

describe('agentActionRouter contextual record review', () => {
  it('uses LANZO-owned product and batch routes with a stable record reference', () => {
    const product = resolveAgentRecordReviewAction({ kind: 'product', recordId: 'product-123' });
    const batches = resolveAgentRecordReviewAction({ kind: 'batches', recordId: 'product-123' });

    expect(product).toMatchObject({
      route: '/productos?tab=list',
      permission: ['products', 'inventory'],
      canNavigate: true,
      recordReference: { kind: 'product', id: 'product-123' }
    });
    expect(batches).toMatchObject({
      route: '/productos?tab=batches',
      permission: 'inventory',
      canNavigate: true,
      recordReference: { kind: 'batches', id: 'product-123' }
    });
    expect(product.route).not.toContain(product.recordReference.id);
  });

  it.each([undefined, '', '  ', 'bad\nreference', 'x'.repeat(181)])(
    'blocks malformed record references: %s',
    (recordId) => {
      const action = resolveAgentRecordReviewAction({ recordId });
      expect(action).toMatchObject({ status: 'blocked_reference', canNavigate: false, recordReference: null });
      const navigate = vi.fn();
      expect(executeAgentAction(action, navigate).success).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    }
  );

  it('passes router state through the safe action executor and rejects provider routes', () => {
    const navigate = vi.fn();
    const state = { liaProductReview: { recordReference: { kind: 'product', id: 'p-1' } } };
    const action = resolveAgentRecordReviewAction({ recordId: 'p-1' });

    expect(executeAgentAction(action, navigate, { state }).success).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/productos?tab=list', { state });

    const arbitrary = resolveAgentAction({ type: 'review', route: 'https://attacker.example/path' });
    expect(arbitrary).toMatchObject({ canNavigate: false, status: 'blocked_route' });
    expect(executeAgentAction(arbitrary, navigate).success).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
