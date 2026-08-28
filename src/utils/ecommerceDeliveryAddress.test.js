import { describe, expect, it } from 'vitest';
import {
  createEmptyEcommerceDeliveryAddress,
  formatEcommerceDeliveryAddress,
  normalizeEcommerceDeliveryAddress
} from './ecommerceDeliveryAddress';

describe('ecommerceDeliveryAddress', () => {
  it('creates the canonical empty shape', () => {
    expect(createEmptyEcommerceDeliveryAddress()).toEqual({
      street: '',
      exteriorNumber: '',
      interiorNumber: '',
      neighborhood: '',
      municipality: '',
      state: '',
      postalCode: '',
      reference: ''
    });
  });

  it('trims known fields, bounds their size and formats the legacy address', () => {
    const address = normalizeEcommerceDeliveryAddress({
      street: ' Calle Central ',
      exteriorNumber: '24',
      interiorNumber: 'B',
      neighborhood: 'Centro',
      municipality: 'Tuxtla',
      state: 'Chiapas',
      postalCode: '29000',
      reference: 'Frente al parque',
      secret: 'not-allowed'
    });

    expect(address).toEqual({
      street: 'Calle Central',
      exteriorNumber: '24',
      interiorNumber: 'B',
      neighborhood: 'Centro',
      municipality: 'Tuxtla',
      state: 'Chiapas',
      postalCode: '29000',
      reference: 'Frente al parque'
    });
    expect(formatEcommerceDeliveryAddress(address)).toBe(
      'Calle Central #24 Int. B, Centro, Tuxtla, Chiapas, CP 29000'
    );
  });

  it('does not coerce non-string fields into the payload', () => {
    expect(normalizeEcommerceDeliveryAddress({
      street: 24,
      municipality: null,
      postalCode: ['29000']
    })).toMatchObject({
      street: '',
      municipality: '',
      postalCode: ''
    });
  });
});
