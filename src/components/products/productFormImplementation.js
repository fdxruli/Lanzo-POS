// This is deliberately the only product-form rollout switch.  It is not
// user-configurable: changing it is the supported technical rollback path.
export const PRODUCT_FORM_IMPLEMENTATION = 'v2';

export const PRODUCT_FORM_IMPLEMENTATIONS = Object.freeze({
  V2: 'v2',
  LEGACY: 'legacy'
});
