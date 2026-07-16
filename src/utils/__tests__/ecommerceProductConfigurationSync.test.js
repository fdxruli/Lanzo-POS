import { describe, expect, it } from 'vitest';
import { normalizeEcommerceProductConfiguration } from '../ecommerceProductConfiguration';
import { resolveEcommerceProductAvailability } from '../ecommerceProductAvailability';
import {
  ECOMMERCE_CONFIGURATION_SYNC_KEYS,
  ECOMMERCE_OPTION_GROUP_SYNC_KEYS,
  ECOMMERCE_OPTION_SYNC_KEYS,
  ECOMMERCE_VARIANT_SYNC_KEYS,
  buildEcommerceProductConfigurationSyncPayload,
  serializeEcommerceProductConfigurationForSync
} from '../ecommerceProductConfigurationSync';

const sortedKeys = (value) => Object.keys(value).sort();

describe('ecommerceProductConfigurationSync', () => {
  it.each([
    [true, true, false, true],
    [true, true, true, false],
    [false, true, false, false],
    [true, false, false, false],
    [false, false, true, false]
  ])(
    'separa disponibilidad manual=%s fuente=%s configuracion=%s',
    (manualAvailable, sourceAvailable, requiresConfiguration, expected) => {
      expect(resolveEcommerceProductAvailability({
        manualAvailable,
        sourceAvailable,
        requiresConfiguration
      })).toBe(expected);
    }
  );

  it('serializa el payload completo con allowlists exactas y sin IDs internos', () => {
    const normalized = normalizeEcommerceProductConfiguration({ id: 'burger' }, {
      variants: [{
        id: 'local-variant-id',
        sourceVariantRef: 'burger-double',
        sourceProductId: 'sku-burger-double',
        sku: 'burger-double',
        publicName: 'Doble',
        optionValues: { tamaño: 'Doble' },
        priceMode: 'delta',
        priceValue: 25,
        metadata: { label: 'visible', cost: 12, securityToken: 'secret' }
      }],
      optionGroups: [{
        id: 'local-group-id',
        sourceGroupRef: 'extras',
        publicName: 'Extras',
        selectionType: 'multiple',
        required: true,
        minSelect: 1,
        maxSelect: 2,
        options: [{
          id: 'local-option-one',
          sourceOptionRef: 'queso-extra',
          publicName: 'Queso extra',
          priceDelta: 15,
          sourceIngredientId: 'ingredient-cheese',
          ingredientQuantity: 1,
          ingredientUnit: 'pza',
          tracksInventory: true
        }, {
          id: 'local-option-two',
          sourceOptionRef: 'sin-cebolla',
          publicName: 'Sin cebolla',
          priceDelta: 0,
          tracksInventory: false
        }]
      }]
    });

    const payload = serializeEcommerceProductConfigurationForSync({
      ...normalized,
      availabilitySource: 'variant_aggregate',
      availabilityReasonCode: 'CONFIGURATION_REQUIRED',
      limitingSource: { productId: 'ingredient-cheese', name: 'Queso' }
    });

    expect(sortedKeys(payload)).toEqual([...ECOMMERCE_CONFIGURATION_SYNC_KEYS].sort());
    expect(sortedKeys(payload.variants[0])).toEqual([...ECOMMERCE_VARIANT_SYNC_KEYS].sort());
    expect(sortedKeys(payload.optionGroups[0])).toEqual([...ECOMMERCE_OPTION_GROUP_SYNC_KEYS].sort());
    expect(sortedKeys(payload.optionGroups[0].options[0])).toEqual([...ECOMMERCE_OPTION_SYNC_KEYS].sort());
    expect(JSON.stringify(payload)).not.toMatch(/local-variant-id|local-group-id|local-option-one/);
    expect(JSON.stringify(payload)).not.toMatch(/securityToken|secret|"cost"/);
    expect(payload.variants[0]).toMatchObject({
      sourceVariantRef: 'burger-double',
      sourceProductId: 'sku-burger-double',
      sku: 'BURGER-DOUBLE',
      priceMode: 'delta',
      priceValue: 25,
      optionValues: { tamaño: 'Doble' }
    });
    expect(payload.optionGroups[0].options[0]).toMatchObject({
      sourceOptionRef: 'queso-extra',
      priceDelta: 15,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true
    });
  });

  it('construye referencias semanticas estables sin depender del indice', () => {
    const product = {
      id: 'shoes',
      variants: [{
        sourceProductId: 'sku-black-26',
        optionValues: { color: 'Negro', talla: '26' }
      }],
      modifiers: [{
        name: 'Extras',
        options: [{ name: 'Plantilla', price: 20 }]
      }]
    };

    const first = buildEcommerceProductConfigurationSyncPayload(product);
    const second = buildEcommerceProductConfigurationSyncPayload(product);

    expect(first).toEqual(second);
    expect(first.variants[0].sourceVariantRef).toBe('sku-black-26');
    expect(first.optionGroups[0].sourceGroupRef).toMatch(/^group-ref_/);
    expect(first.optionGroups[0].options[0].sourceOptionRef).toMatch(/^option-ref_/);
  });

  it('no envia undefined, funciones, costos ni contexto administrativo privado', () => {
    const payload = buildEcommerceProductConfigurationSyncPayload({
      id: 'simple',
      name: 'Simple',
      recipe: [],
      modifiers: [],
      metadata: {
        cost: 20,
        licenseId: 'license-private',
        deviceFingerprint: 'device-private',
        staffSessionToken: 'staff-private',
        safeLabel: 'visible',
        callback: () => true,
        undefinedValue: undefined
      }
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/undefined|cost|license-private|device-private|staff-private|callback/);
    expect(payload).toMatchObject({
      type: 'simple',
      hasRecipe: false,
      variants: [],
      optionGroups: []
    });
  });
});
