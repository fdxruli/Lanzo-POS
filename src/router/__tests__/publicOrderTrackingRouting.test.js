import { describe, expect, it } from 'vitest';
import { isPublicStorePath } from '../isPublicStorePath';

describe('public order tracking routing', () => {
  it('recognizes the tracking path as a public-only route', () => {
    expect(isPublicStorePath(`/tienda/mi-tienda/pedido/trk1_${'A'.repeat(43)}`)).toBe(true);
  });

  it('does not classify arbitrary nested store paths as public tracking', () => {
    expect(isPublicStorePath('/tienda/mi-tienda/admin/secreto')).toBe(false);
  });
});
