import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CAPABILITY_REASON,
  BUSINESS_CAPABILITY_STATUS,
  resolveBusinessCapabilities,
  resolveEcommerceBusinessPolicy
} from '../businessCapabilities';

describe('business capability policy', () => {
  it('resolves a single grocery business', () => {
    const result = resolveBusinessCapabilities({ businessTypes: ['abarrotes'] });
    expect(result).toMatchObject({
      supportsWholesalePricing: true,
      supportsRestaurantModifiers: false,
      supportsBulkSales: true,
      unknownBusinessType: false
    });
  });

  it('uses the union for multiple business types', () => {
    const result = resolveBusinessCapabilities({
      businessTypes: ['abarrotes', 'restaurante']
    });
    expect(result.supportsWholesalePricing).toBe(true);
    expect(result.supportsRestaurantModifiers).toBe(true);
  });

  it('fails closed for unknown business types', () => {
    const result = resolveBusinessCapabilities({
      businessTypes: ['desconocido'],
      product: { modifiers: [{ id: 'extras' }] }
    });
    expect(result.unknownBusinessType).toBe(true);
    expect(result.incompatibilities).toContain(
      BUSINESS_CAPABILITY_REASON.BUSINESS_TYPE_UNKNOWN
    );
  });

  it('marks grocery modifiers for review without deleting them', () => {
    const product = { modifiers: [{ id: 'extras' }] };
    const policy = resolveEcommerceBusinessPolicy({
      businessTypes: ['abarrotes'],
      product
    });
    expect(policy.status).toBe(BUSINESS_CAPABILITY_STATUS.REQUIRES_REVIEW);
    expect(policy.exposeConfiguration).toBe(false);
    expect(product.modifiers).toHaveLength(1);
  });

  it('allows restaurant modifiers', () => {
    const policy = resolveEcommerceBusinessPolicy({
      businessTypes: ['food_service'],
      product: { modifiers: [{ id: 'extras' }] }
    });
    expect(policy.status).toBe(BUSINESS_CAPABILITY_STATUS.COMPATIBLE);
    expect(policy.exposeConfiguration).toBe(true);
  });

  it('allows an explicit simple override', () => {
    const policy = resolveEcommerceBusinessPolicy({
      businessTypes: ['abarrotes'],
      product: { modifiers: [{ id: 'extras' }] },
      publicConfigurationMode: 'simple_override'
    });
    expect(policy.status).toBe(BUSINESS_CAPABILITY_STATUS.SIMPLE_OVERRIDE);
    expect(policy.publiclyAvailable).toBe(true);
    expect(policy.exposeConfiguration).toBe(false);
  });
});
