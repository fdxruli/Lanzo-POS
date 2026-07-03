import { describe, expect, it } from 'vitest';
import {
  findInvalidModifierGroupForSave,
  findInvalidModifierOptionForSave,
  getModifierOptionKind,
  normalizeModifierGroup,
  normalizeModifierOption
} from '../restaurantModifiers';

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
