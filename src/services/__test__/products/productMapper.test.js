import { describe, expect, it } from 'vitest';
import { cloudProductToLocal } from '../../products/productMapper';

describe('cloudProductToLocal modifiers', () => {
  it('limpia modificadores locales cuando cloud manda modifiers null', () => {
    const result = cloudProductToLocal(
      { id: 'prod_1', name: 'Hamburguesa', modifiers: null },
      { id: 'prod_1', name: 'Hamburguesa', modifiers: [{ name: 'Extras', options: [{ name: 'Queso extra', price: 10 }] }] }
    );

    expect(result.modifiers).toEqual([]);
  });

  it('conserva y normaliza fallback local cuando cloud omite modifiers', () => {
    const result = cloudProductToLocal(
      { id: 'prod_1', name: 'Hamburguesa' },
      { id: 'prod_1', name: 'Hamburguesa', modifiers: [{ name: 'Extras', options: [{ name: 'Queso extra', price: 10 }] }] }
    );

    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0].options[0]).toMatchObject({
      name: 'Queso extra',
      price: 10,
      tracksInventory: false
    });
  });

  it('normaliza modificadores nuevos enviados por cloud', () => {
    const result = cloudProductToLocal({
      id: 'prod_1',
      name: 'Hamburguesa',
      modifiers: [
        {
          name: 'Extras',
          options: [
            {
              name: 'Tocino extra',
              price: 15,
              ingredientId: 'ing_tocino',
              ingredientQuantity: 25,
              ingredientUnit: 'g'
            }
          ]
        }
      ]
    });

    expect(result.modifiers[0].options[0]).toMatchObject({
      name: 'Tocino extra',
      price: 15,
      ingredientId: 'ing_tocino',
      ingredientQuantity: 25,
      ingredientUnit: 'g',
      tracksInventory: true
    });
  });
});
