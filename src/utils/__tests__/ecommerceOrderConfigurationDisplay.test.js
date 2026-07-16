import { describe, expect, it } from 'vitest';
import {
  buildEcommerceOrderDisplayName,
  formatEcommerceOrderConfigurationSummary,
  normalizeEcommerceOrderConfiguration
} from '../ecommerceOrderConfigurationDisplay';

const configuredOptions = {
  version: 1,
  configurationVersion: 2,
  configurationRevision: 'a'.repeat(64),
  configurationType: 'configurable',
  variant: null,
  groups: [
    {
      id: 'size',
      name: 'Tamaño',
      selectionType: 'single',
      options: [{ id: 'regular', name: 'Regular', priceDelta: 0 }]
    },
    {
      id: 'extras',
      name: 'Extras',
      selectionType: 'multiple',
      options: [
        { id: 'cheese', name: 'Queso extra', priceDelta: 10 },
        { id: 'onion', name: 'Sin cebolla', priceDelta: 0 }
      ]
    }
  ],
  pricing: { baseUnitPrice: 32, optionsAdjustment: 10, finalUnitPrice: 42 }
};

describe('ecommerceOrderConfigurationDisplay', () => {
  it('formats the immutable order snapshot without exposing technical revision fields', () => {
    const summary = formatEcommerceOrderConfigurationSummary(configuredOptions, { currency: 'MXN' });

    expect(summary).toContain('Tamaño: Regular');
    expect(summary).toContain('Extras: Queso extra');
    expect(summary).toContain('Sin cebolla');
    expect(summary).toContain('$10.00');
    expect(summary).not.toContain('configurationRevision');
    expect(summary).not.toContain('a'.repeat(64));
    expect(buildEcommerceOrderDisplayName('Taco al pastor', configuredOptions)).toBe(
      `Taco al pastor — ${summary}`
    );
  });

  it('supports legacy primitive option objects while ignoring internal metadata', () => {
    const normalized = normalizeEcommerceOrderConfiguration({
      salsa: 'BBQ',
      configurationVersion: 1,
      pricing: { finalUnitPrice: 80 }
    });

    expect(normalized.groups).toEqual([
      expect.objectContaining({
        name: 'Salsa',
        options: [expect.objectContaining({ name: 'BBQ' })]
      })
    ]);
    expect(formatEcommerceOrderConfigurationSummary({ salsa: 'BBQ' })).toBe('Salsa: BBQ');
  });

  it('keeps simple products unchanged', () => {
    expect(formatEcommerceOrderConfigurationSummary({})).toBe('');
    expect(buildEcommerceOrderDisplayName('Producto simple', {})).toBe('Producto simple');
  });
});
