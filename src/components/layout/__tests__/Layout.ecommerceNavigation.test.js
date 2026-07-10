import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(new URL('../Layout.jsx', import.meta.url), 'utf8');

describe('Layout ecommerce navigation', () => {
  it('keeps the ecommerce runtime without mounting the former floating shortcut', () => {
    expect(layoutSource).toContain("import EcommerceOrdersRuntime from '../ecommerce/orders/EcommerceOrdersRuntime';");
    expect(layoutSource).toContain('<EcommerceOrdersRuntime />');
    expect(layoutSource).not.toContain('EcommerceOrdersNavShortcut');
    expect(layoutSource).not.toContain('ecommerce-orders-nav-shortcut');
  });
});
