import { describe, expect, it } from 'vitest';
import { getProductRubroConfig } from '../productRubroConfig';

describe('productRubroConfig', () => {
  it('exposes the shared sale modes with hardware-specific copy', () => {
    expect(getProductRubroConfig('hardware').productTypeOptions.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'unit', label: 'Por pieza' },
      { value: 'bulk', label: 'Por medida o peso' },
      { value: 'fractioned', label: 'Fraccionado' }
    ]);
  });

  it('keeps produce details focused on duration after sale mode moves into the primary flow', () => {
    expect(getProductRubroConfig('verduleria/fruteria').detailTitle).toBe('Duración y conservación');
  });
});
