import { describe, expect, it } from 'vitest';
import {
  findInvalidModifierGroupForSave,
  findInvalidModifierOptionForSave,
  getModifierOptionKind,
  normalizeModifierGroup,
  normalizeModifierOption
} from '../restaurantModifiers';
import {
  formatSelectedModifierLabel,
  formatSelectedModifiersForDisplay,
  getSelectedModifiersTotal,
  hasInventoryTrackedModifiers
} from '../restaurantModifierDisplay';
import {
  normalizeRestaurantModifierForSnapshot,
  normalizeSelectedModifiersForPersistence,
  normalizeSelectedModifiersForSnapshot
} from '../restaurantModifierIdentity';
import { normalizeCartItems } from '../cartLineIdentity';

describe('restaurantModifiers', () => {
  it('normaliza una opción solo texto sin inventario', () => {
    const option = normalizeModifierOption({ name: 'Sin cebolla', price: 0 });

    expect(option.name).toBe('Sin cebolla');
    expect(option.price).toBe(0);
    expect(option.ingredientId).toBeNull();
    expect(option.ingredientQuantity).toBeNull();
    expect(option.tracksInventory).toBe(false);
    expect(getModifierOptionKind(option)).toBe('text_only');
  });

  it('normaliza una opción que cobra extra pero no descuenta inventario', () => {
    const option = normalizeModifierOption({ name: 'Empaque extra', price: 5 });

    expect(option.price).toBe(5);
    expect(option.ingredientId).toBeNull();
    expect(option.tracksInventory).toBe(false);
    expect(getModifierOptionKind(option)).toBe('priced_only');
  });

  it('normaliza una opción que cobra y descuenta inventario', () => {
    const option = normalizeModifierOption({
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g'
    });

    expect(option.price).toBe(10);
    expect(option.ingredientId).toBe('ing_queso');
    expect(option.ingredientQuantity).toBe(30);
    expect(option.ingredientUnit).toBe('g');
    expect(option.tracksInventory).toBe(true);
    expect(getModifierOptionKind(option)).toBe('priced_inventory');
  });

  it('marca como incompleta una opción con ingrediente pero sin cantidad', () => {
    const option = normalizeModifierOption({
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso'
    });

    expect(option.ingredientId).toBe('ing_queso');
    expect(option.ingredientQuantity).toBeNull();
    expect(option.tracksInventory).toBe(false);
    expect(option.isLegacyIncomplete).toBe(true);
    expect(getModifierOptionKind(option)).toBe('incomplete');

    const invalid = findInvalidModifierOptionForSave([
      { name: 'Extras', options: [option] }
    ]);

    expect(invalid?.reason).toBe('missing_ingredient_quantity');
  });

  it('marca inválido un grupo sin opciones', () => {
    const group = normalizeModifierGroup({ name: 'Extras', options: [] });

    expect(findInvalidModifierGroupForSave([group])?.name).toBe('Extras');
  });

  it('marca inválida una opción sin nombre', () => {
    const invalid = findInvalidModifierOptionForSave([
      { name: 'Extras', options: [{ name: ' ', price: 0 }] }
    ]);

    expect(invalid?.reason).toBe('missing_name');
  });

  it('mapea legacy quantity a ingredientQuantity sin romper compatibilidad', () => {
    const option = normalizeModifierOption({
      name: 'Tocino extra',
      price: 15,
      ingredientId: 'ing_tocino',
      quantity: 25,
      unit: 'g'
    });

    expect(option.ingredientQuantity).toBe(25);
    expect(option.ingredientUnit).toBe('g');
    expect(option.tracksInventory).toBe(true);
    expect(option.legacyQuantityMapped).toBe(true);
  });
});

describe('restaurantModifierIdentity', () => {
  it('normaliza snapshot conservando identidad completa del extra', () => {
    const modifier = normalizeRestaurantModifierForSnapshot({
      id: 'opt_queso_extra',
      optionId: 'opt_queso_extra',
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g',
      tracksInventory: true
    });

    expect(modifier).toEqual({
      id: 'opt_queso_extra',
      optionId: 'opt_queso_extra',
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g',
      tracksInventory: true,
      quantity: null,
      unit: null
    });
  });

  it('diferencia extras con mismo ingrediente pero distinta cantidad/precio', () => {
    const modifiers = normalizeSelectedModifiersForSnapshot([
      {
        id: 'opt_doble_queso',
        name: 'Queso extra',
        price: 18,
        ingredientId: 'ing_queso',
        ingredientQuantity: 60,
        ingredientUnit: 'g',
        tracksInventory: true
      },
      {
        id: 'opt_queso_extra',
        name: 'Queso extra',
        price: 10,
        ingredientId: 'ing_queso',
        ingredientQuantity: 30,
        ingredientUnit: 'g',
        tracksInventory: true
      }
    ]);

    expect(new Set(modifiers.map((modifier) => JSON.stringify(modifier))).size).toBe(2);
    expect(modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'opt_queso_extra', ingredientQuantity: 30, price: 10 }),
      expect.objectContaining({ id: 'opt_doble_queso', ingredientQuantity: 60, price: 18 })
    ]));
  });

  it('mantiene quantity legacy y lo deriva a ingredientQuantity para compatibilidad', () => {
    const [modifier] = normalizeSelectedModifiersForPersistence([
      {
        name: 'Tocino extra',
        ingredientId: 'ing_tocino',
        quantity: 25,
        unit: 'g'
      }
    ]);

    expect(modifier).toMatchObject({
      name: 'Tocino extra',
      ingredientId: 'ing_tocino',
      ingredientQuantity: 25,
      ingredientUnit: 'g',
      quantity: 25,
      unit: 'g',
      tracksInventory: true
    });
  });

  it('corrige tracksInventory false cuando hay ingrediente y cantidad válida', () => {
    const [modifier] = normalizeSelectedModifiersForPersistence([
      {
        name: 'Queso extra',
        ingredientId: 'ing_queso',
        ingredientQuantity: 30,
        ingredientUnit: 'g',
        tracksInventory: false
      }
    ]);

    expect(modifier).toMatchObject({
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g',
      tracksInventory: true
    });
  });

  it('corrige tracksInventory true cuando falta ingrediente', () => {
    const [modifier] = normalizeSelectedModifiersForPersistence([
      {
        name: 'Extra raro',
        price: 10,
        tracksInventory: true
      }
    ]);

    expect(modifier).toMatchObject({
      ingredientId: null,
      ingredientQuantity: null,
      ingredientUnit: null,
      tracksInventory: false
    });
  });

  it('corrige tracksInventory true cuando falta cantidad válida', () => {
    const [modifier] = normalizeSelectedModifiersForPersistence([
      {
        name: 'Queso extra',
        ingredientId: 'ing_queso',
        ingredientUnit: 'g',
        tracksInventory: true
      }
    ]);

    expect(modifier).toMatchObject({
      ingredientId: 'ing_queso',
      ingredientQuantity: null,
      ingredientUnit: 'g',
      tracksInventory: false
    });
  });

  it('corrige legacy quantity aunque tracksInventory venga false', () => {
    const [modifier] = normalizeSelectedModifiersForPersistence([
      {
        name: 'Tocino extra',
        ingredientId: 'ing_tocino',
        quantity: 25,
        unit: 'g',
        tracksInventory: false
      }
    ]);

    expect(modifier).toMatchObject({
      ingredientId: 'ing_tocino',
      ingredientQuantity: 25,
      ingredientUnit: 'g',
      quantity: 25,
      unit: 'g',
      tracksInventory: true
    });
  });

  it('normaliza líneas de carrito sin perder selectedModifiers al guardar/reabrir mesa', () => {
    const [line] = normalizeCartItems([
      {
        id: 'prod_hamburguesa',
        lineId: 'line_hamb_1',
        name: 'Hamburguesa',
        quantity: 1,
        selectedModifiers: [
          {
            id: 'opt_queso_extra',
            name: 'Queso extra',
            price: 10,
            ingredientId: 'ing_queso',
            ingredientQuantity: 30,
            ingredientUnit: 'g',
            tracksInventory: true
          }
        ]
      }
    ]);

    expect(line.lineId).toBe('line_hamb_1');
    expect(line.selectedModifiers[0]).toMatchObject({
      id: 'opt_queso_extra',
      name: 'Queso extra',
      price: 10,
      ingredientId: 'ing_queso',
      ingredientQuantity: 30,
      ingredientUnit: 'g',
      tracksInventory: true
    });
  });
});

describe('restaurantModifierDisplay', () => {
  it('devuelve seguro cuando no hay modificadores seleccionados', () => {
    expect(formatSelectedModifiersForDisplay(null)).toEqual([]);
    expect(formatSelectedModifiersForDisplay(undefined)).toEqual([]);
    expect(formatSelectedModifiersForDisplay([])).toEqual([]);
  });

  it('muestra extra con precio de forma amigable', () => {
    expect(formatSelectedModifierLabel({ name: 'Queso extra', price: 10 })).toBe('Queso extra +$10');
  });

  it('muestra extra sin precio sin signo extra', () => {
    expect(formatSelectedModifierLabel({ name: 'Sin cebolla', price: 0 })).toBe('Sin cebolla');
  });

  it('oculta campos técnicos de inventario para cliente y cocina', () => {
    const label = formatSelectedModifierLabel({
      name: 'Tocino extra',
      price: 15,
      ingredientId: 'ing_tocino',
      ingredientQuantity: 25,
      ingredientUnit: 'g',
      tracksInventory: true
    });

    expect(label).toBe('Tocino extra +$15');
    expect(label).not.toContain('ing_tocino');
    expect(label).not.toContain('25');
    expect(label).not.toContain('tracksInventory');
  });

  it('detecta total e inventario sin exponerlo en el label', () => {
    const modifiers = [
      { name: 'Queso extra', price: 10, ingredientId: 'ing_queso', ingredientQuantity: 30, ingredientUnit: 'g', tracksInventory: true },
      { name: 'Sin cebolla', price: 0 }
    ];

    expect(formatSelectedModifiersForDisplay(modifiers)).toEqual(['Queso extra +$10', 'Sin cebolla']);
    expect(getSelectedModifiersTotal(modifiers)).toBe(10);
    expect(hasInventoryTrackedModifiers(modifiers)).toBe(true);
  });

  it('soporta legacy quantity para detección administrativa sin mostrarlo por defecto', () => {
    const modifier = { name: 'Queso extra', price: 10, ingredientId: 'ing_queso', quantity: 30, unit: 'g' };

    expect(formatSelectedModifierLabel(modifier)).toBe('Queso extra +$10');
    expect(formatSelectedModifierLabel(modifier, { showInventoryDetail: true })).toBe('Queso extra +$10 (30 g)');
    expect(hasInventoryTrackedModifiers([modifier])).toBe(true);
  });
});
