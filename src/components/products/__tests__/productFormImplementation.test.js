import { describe, expect, it } from 'vitest';
import { PRODUCT_FORM_IMPLEMENTATION, PRODUCT_FORM_IMPLEMENTATIONS } from '../productFormImplementation';

describe('product form implementation authority', () => {
  it('defaults to V2 and retains the only supported technical rollback value', () => {
    expect(PRODUCT_FORM_IMPLEMENTATION).toBe(PRODUCT_FORM_IMPLEMENTATIONS.V2);
    expect(Object.values(PRODUCT_FORM_IMPLEMENTATIONS)).toEqual(['v2', 'legacy']);
  });
});
