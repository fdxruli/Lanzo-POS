import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchProductsInTable } from '../../db/productSearch';
import { buildProductSearchFields } from '../../db/productSearchIndex';
import { activeIngredientRepository } from '../../pharmacy/activeIngredientRepository';
import { cloudProductToLocal, productToCloudPayload } from '../../products/productMapper';

const createMockCollection = (rows) => {
  let currentRows = [...rows];

  return {
    distinct() {
      currentRows = [...new Map(currentRows.map((row) => [row.id, row])).values()];
      return this;
    },
    filter(predicate) {
      currentRows = currentRows.filter(predicate);
      return this;
    },
    limit(size) {
      currentRows = currentRows.slice(0, size);
      return this;
    },
    async toArray() {
      return [...currentRows];
    },
    async primaryKeys() {
      return currentRows.map((row) => row.id);
    },
    async first() {
      return currentRows[0];
    }
  };
};

const createMockTable = (rows) => ({
  bulkGet(ids) {
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    return Promise.resolve(ids.map((id) => rowsById.get(id)));
  },
  where(indexName) {
    return {
      equals(term) {
        const indexedRows = rows.filter((row) => {
          const value = row?.[indexName];
          return Array.isArray(value)
            ? value.includes(term)
            : value === term;
        });
        return createMockCollection(indexedRows);
      },
      startsWith(term) {
        const normalizedTerm = String(term || '').toLowerCase();
        const indexedRows = rows.filter((row) => {
          const value = row?.[indexName];
          if (value === null || value === undefined) return false;
          if (Array.isArray(value)) {
            return value.some((item) => String(item).startsWith(normalizedTerm));
          }
          return String(value).toLowerCase().startsWith(normalizedTerm);
        });
        return createMockCollection(indexedRows);
      }
    };
  },
  filter() {
    const predicate = arguments[0];
    return createMockCollection(rows.filter(predicate));
  }
});

const withSearchFields = (rows) =>
  rows.map((row) => ({ ...row, ...buildProductSearchFields(row) }));

describe('searchProductsInDB', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna [] cuando el termino esta vacio', async () => {
    const result = await searchProductsInTable(createMockTable([]), '   ');

    expect(result).toEqual([]);
  });

  it('usa indices y deduplica resultados repetidos por id', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'alitas bbq', barcode: 'ali-001', sku: 'ali-sku', isActive: true },
      { id: 'p2', name: 'albondigas', barcode: '12345', sku: 'alb-001', isActive: true },
      { id: 'p3', name: 'combo premium', barcode: '9988', sku: 'ali-pack', isActive: true },
      { id: 'p4', name: 'alitas ocultas', barcode: 'ali-999', sku: 'x', isActive: false }
    ]);

    const result = await searchProductsInTable(createMockTable(rows), 'ali');
    const ids = result.map((item) => item.id);

    expect(ids).toContain('p1');
    expect(ids).toContain('p3');
    expect(ids).not.toContain('p4');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('aplica categoría y estado antes del límite de resultados de búsqueda', async () => {
    const unrelatedCategory = Array.from({ length: 60 }, (_, index) => ({
      id: `food-${index}`,
      name: `agua sabor ${index}`,
      categoryId: 'food',
      isActive: true
    }));
    const selectedCategory = [
      { id: 'drink-1', name: 'agua mineral', categoryId: 'drinks', isActive: true },
      { id: 'drink-2', name: 'agua con gas', categoryId: 'drinks', isActive: true },
      { id: 'inactive-drink', name: 'agua anterior', categoryId: 'drinks', isActive: false }
    ];
    const rows = withSearchFields([...unrelatedCategory, ...selectedCategory]);

    const result = await searchProductsInTable(
      createMockTable(rows),
      'agua',
      'active',
      50,
      'drinks'
    );

    expect(result.map((product) => product.id)).toEqual(['drink-1', 'drink-2']);
  });

  it('applies the uncategorized search filter without treating it as a category ID', async () => {
    const rows = withSearchFields([
      { id: 'drink', name: 'agua mineral', categoryId: 'drinks', isActive: true },
      { id: 'uncategorized', name: 'agua natural', categoryId: '', isActive: true }
    ]);

    const result = await searchProductsInTable(
      createMockTable(rows),
      'agua',
      'active',
      50,
      { type: 'uncategorized' }
    );

    expect(result.map((product) => product.id)).toEqual(['uncategorized']);
  });

  it('aplica fallback contains cuando el indice no cubre la coincidencia', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'tortilla de maiz', barcode: '7788', sku: 'tor-01', isActive: true },
      { id: 'p2', name: 'pan integral', barcode: '3322', sku: 'pan-01', isActive: true }
    ]);

    const result = await searchProductsInTable(createMockTable(rows), 'maiz');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('normaliza acentos y resuelve SKU alfanumerico exacto primero', async () => {
    const rows = withSearchFields([
      { id: 'p1', name: 'Café molido', barcode: '7501', sku: 'CAF-001', isActive: true }
    ]);

    const byName = await searchProductsInTable(createMockTable(rows), 'cafe');
    const bySku = await searchProductsInTable(createMockTable(rows), 'caf-001');

    expect(byName.map((product) => product.id)).toEqual(['p1']);
    expect(bySku.map((product) => product.id)).toEqual(['p1']);
  });
});

describe('búsqueda farmacéutica F03', () => {
  const activeIngredients = [
    { id: 'ai-paracetamol', name: 'Paracetamol', isActive: true },
    { id: 'ai-tramadol', name: 'Tramadol', isActive: true },
    { id: 'ai-ketorolaco', name: 'Ketorolaco', isActive: true }
  ];
  const item = (id, name, amount, unit = 'mg', basisAmount = 1, basisUnit = 'tableta') => ({
    activeIngredientId: id, name, amount, unit, basisAmount, basisUnit
  });
  const medicine = (id, name, activeIngredientsForProduct, pharmacy = {}) => ({
    id,
    name,
    isActive: true,
    productType: 'sellable',
    activeSubstance: activeIngredientsForProduct.map(({ name: ingredientName }) => ingredientName).join(', '),
    presentation: 'Caja con 10 tabletas',
    metadata: { pharmacy: {
      kind: 'medicine',
      dosageFormCode: 'tablet',
      dosageForm: 'Tableta',
      commercialPresentation: { version: 1, packageType: 'box', contentAmount: 10, contentUnit: 'tableta' },
      composition: { version: 1, activeIngredients: activeIngredientsForProduct },
      ...pharmacy
    } }
  });
  const searchPharmacy = (rows, query, filters = {}) => searchProductsInTable(
    createMockTable(withSearchFields(rows)), query, 'active', 50, null,
    { pharmacySearch: true, pharmacyFilters: filters }
  );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('busca por principio activo en marcas distintas con normalización de acentos y espacios', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue(activeIngredients);
    const rows = [
      medicine('brand-a', 'Marca Uno 500 mg', [item('ai-paracetamol', 'Paracetamol', 500)]),
      medicine('brand-b', 'Marca Dos 500 mg', [item('ai-paracetamol', 'Paracetamol', 500)])
    ];

    const results = await searchPharmacy(rows, '  PARACETAMÓL   ');

    expect(results.map(({ id }) => id)).toEqual(['brand-a', 'brand-b']);
  });

  it('requiere todos los principios activos de una búsqueda combinada', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue(activeIngredients);
    const rows = [
      medicine('tramadol-solo', 'Marca Tramadol', [item('ai-tramadol', 'Tramadol', 50)]),
      medicine('combo', 'Marca combinada', [
        item('ai-tramadol', 'Tramadol', 37.5),
        item('ai-ketorolaco', 'Ketorolaco', 10)
      ])
    ];

    const results = await searchPharmacy(rows, 'Tramadol + ketorolaco');

    expect(results.map(({ id }) => id)).toEqual(['combo']);
  });

  it('aplica filtros exactos de forma y literales de concentración y presentación', async () => {
    const rows = [
      medicine('tablet-500', 'Paracetamol 500 mg', [item('ai-paracetamol', 'Paracetamol', 500)]),
      medicine('tablet-750', 'Paracetamol 750 mg', [item('ai-paracetamol', 'Paracetamol', 750)], {
        commercialPresentation: { version: 1, packageType: 'box', contentAmount: 20, contentUnit: 'tableta' }
      }),
      medicine('suspension', 'Paracetamol suspensión', [item('ai-paracetamol', 'Paracetamol', 250, 'mg', 5, 'mL')], {
        dosageFormCode: 'suspension', dosageForm: 'Suspensión',
        commercialPresentation: { version: 1, packageType: 'bottle', contentAmount: 120, contentUnit: 'mL' }
      })
    ];

    const results = await searchPharmacy(rows, '', {
      dosageFormCode: 'tablet', concentration: '500 mg', presentation: '10 tabletas'
    });

    expect(results.map(({ id }) => id)).toEqual(['tablet-500']);
  });

  it('busca concentraciones decimales literales sin convertir unidades', async () => {
    const rows = [
      medicine('decimal-mg', 'Marca decimal', [item('ai-paracetamol', 'Paracetamol', 0.5)]),
      medicine('microgram', 'Marca microgramo', [item('ai-paracetamol', 'Paracetamol', 500, 'µg')])
    ];

    const results = await searchPharmacy(rows, '', { concentration: '0.5 mg' });

    expect(results.map(({ id }) => id)).toEqual(['decimal-mg']);
  });

  it('distingue cantidades numéricas completas en filtros y búsqueda general', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue([]);
    const rows = [
      medicine('mg-500', 'Marca cinco centenas', [item('ai-paracetamol', 'Paracetamol', 500)], {
        concentration: '1500 mg'
      }),
      medicine('mg-1500', 'Marca mil quinientos', [item('ai-paracetamol', 'Paracetamol', 1500)]),
      medicine('mg-5', 'Marca cinco', [item('ai-paracetamol', 'Paracetamol', 5)]),
      medicine('mg-15', 'Marca quince', [item('ai-paracetamol', 'Paracetamol', 15)]),
      medicine('mg-0-5', 'Marca medio', [item('ai-paracetamol', 'Paracetamol', 0.5)]),
      medicine('mg-per-5-ml', 'Marca suspensión', [item('ai-paracetamol', 'Paracetamol', 250, 'mg', 5, 'mL')], {
        dosageFormCode: 'suspension', dosageForm: 'Suspensión'
      })
    ];

    expect((await searchPharmacy(rows, '500 mg')).map(({ id }) => id)).toEqual(['mg-500']);
    expect((await searchPharmacy(rows, '500mg')).map(({ id }) => id)).toEqual(['mg-500']);
    expect((await searchPharmacy(rows, '1500 mg')).map(({ id }) => id)).toEqual(['mg-1500']);
    expect((await searchPharmacy(rows, '5 mg')).map(({ id }) => id)).toEqual(['mg-5']);
    expect((await searchPharmacy(rows, '0.5 mg')).map(({ id }) => id)).toEqual(['mg-0-5']);
    expect((await searchPharmacy(rows, '', { concentration: '500 mg' })).map(({ id }) => id))
      .toEqual(['mg-500']);
    expect((await searchPharmacy(rows, '', { concentration: '5 mg' })).map(({ id }) => id))
      .toEqual(['mg-5']);
    expect((await searchPharmacy(rows, '', { concentration: '0.5 mg' })).map(({ id }) => id))
      .toEqual(['mg-0-5']);
  });

  it('distingue cantidades de presentación estructuradas frente a texto histórico conflictivo', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue([]);
    const rows = [
      {
        ...medicine('package-10', 'Marca caja chica', [item('ai-paracetamol', 'Paracetamol', 500)], {
          commercialPresentation: { version: 1, packageType: 'box', contentAmount: 10, contentUnit: 'tableta' }
        }),
        presentation: 'Caja con 110 tabletas'
      },
      medicine('package-110', 'Marca caja grande', [item('ai-paracetamol', 'Paracetamol', 500)], {
        commercialPresentation: { version: 1, packageType: 'box', contentAmount: 110, contentUnit: 'tableta' }
      })
    ];

    expect((await searchPharmacy(rows, '10 tabletas')).map(({ id }) => id)).toEqual(['package-10']);
    expect((await searchPharmacy(rows, '110 tabletas')).map(({ id }) => id)).toEqual(['package-110']);
    expect((await searchPharmacy(rows, '', { presentation: '10 tabletas' })).map(({ id }) => id))
      .toEqual(['package-10']);
    expect((await searchPharmacy(rows, '', { presentation: '110 tabletas' })).map(({ id }) => id))
      .toEqual(['package-110']);
  });

  it('mantiene localizables medicamentos históricos con texto libre y sin composición', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue(activeIngredients);
    const historical = {
      id: 'legacy', name: 'Marca Histórica 500 mg', isActive: true, productType: 'sellable',
      activeSubstance: 'Paracetamol', concentration: '500 mg', presentation: 'Caja con 10 tabletas',
      metadata: { pharmacy: { dosageForm: 'Tableta' } }
    };

    const results = await searchPharmacy([historical], 'paracetamol');

    expect(results.map(({ id }) => id)).toEqual(['legacy']);
    expect(results[0].metadata.pharmacy).not.toHaveProperty('composition');
  });

  it('conserva prioridad por código de barras exacto y deduplica coincidencias múltiples', async () => {
    const rows = [
      medicine('barcode-hit', 'Paracetamol 500 mg', [item('ai-paracetamol', 'Paracetamol', 500)], {
        concentration: '500 mg'
      }),
      medicine('other', 'Paracetamol 500 mg', [item('ai-paracetamol', 'Paracetamol', 500)])
    ].map((product, index) => ({ ...product, barcode: index === 0 ? '7501234567893' : '7500000000002' }));

    const exact = await searchPharmacy(rows, '7501234567893');
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue(activeIngredients);
    const repeated = await searchPharmacy(rows, 'paracetamol');

    expect(exact.map(({ id }) => id)).toEqual(['barcode-hit']);
    expect(repeated.map(({ id }) => id)).toEqual(['barcode-hit', 'other']);
    expect(new Set(repeated.map(({ id }) => id)).size).toBe(repeated.length);
  });

  it('usa los mismos campos después de la proyección Cloud y respeta elegibilidad existente', async () => {
    vi.spyOn(activeIngredientRepository, 'list').mockResolvedValue(activeIngredients);
    const local = medicine('local-paracetamol', 'Paracetamol local', [item('ai-paracetamol', 'Paracetamol', 500)]);
    const cloudProjected = cloudProductToLocal(productToCloudPayload(
      medicine('cloud-paracetamol', 'Marca Cloud', [item('ai-paracetamol', 'Paracetamol', 750)])
    ));
    const blocked = {
      ...medicine('inactive-paracetamol', 'Paracetamol inactivo', [item('ai-paracetamol', 'Paracetamol', 250)]),
      isActive: false
    };
    const results = await searchProductsInTable(
      createMockTable(withSearchFields([local, cloudProjected, blocked])),
      'paracetamol', 'all', 50, null,
      { pharmacySearch: true, eligible: (product) => product.isActive !== false }
    );

    expect(results.map(({ id }) => id)).toEqual(['local-paracetamol', 'cloud-paracetamol']);
    expect(results[1].metadata.pharmacy.composition.activeIngredients[0].activeIngredientId)
      .toBe('ai-paracetamol');
  });
});


describe('F-04 eligibility before the result limit', () => {
  const valid = Array.from({ length: 5 }, (_, i) => ({
    id: `valid-${i}`, name: `qa agua z${i}`, isActive: true,
    productType: 'sellable', categoryId: 'B', stock: 5
  }));
  it.each(['ingredient', 'category', 'inactive', 'outOfStock', 'expired'])(
    'continues past 60 excluded %s candidates', async (kind) => {
      const excluded = Array.from({ length: 60 }, (_, i) => ({
        ...valid[0], id: `excluded-${i}`, name: `qa agua a${String(i).padStart(2, '0')}`,
        ...(kind === 'ingredient' ? { productType: 'ingredient' } : {}),
        ...(kind === 'category' ? { categoryId: 'A' } : {}),
        ...(kind === 'inactive' ? { isActive: false } : {}),
        ...(kind === 'outOfStock' ? { stock: 0 } : {}),
        ...(kind === 'expired' ? { expired: true } : {})
      }));
      const eligible = (p) => p.productType !== 'ingredient' && p.categoryId === 'B' && p.stock > 0;
      const filterBatch = vi.fn(async (items) => items.filter((p) => !p.expired));
      const result = await searchProductsInTable(createMockTable(withSearchFields([...excluded, ...valid])),
        'qa agua', 'active', 50, null, { eligible, filterBatch });
      expect(result.map((p) => p.id)).toEqual(valid.map((p) => p.id));
    }
  );
});


it.each(['barcode', 'sku'])('skips an excluded exact %s and continues indexed partial matches', async (field) => {
  const rows = withSearchFields([
    { id: 'excluded', name: 'hidden', [field]: 'agua', productType: 'ingredient', isActive: true },
    { id: 'valid', name: 'agua mineral', isActive: true },
    { id: 'partial', name: 'superaguafresca', isActive: true }
  ]);
  const result = await searchProductsInTable(createMockTable(rows), 'agua', 'active', 50, null,
    { eligible: (p) => p.productType !== 'ingredient' });
  expect(result.map((p) => p.id)).toEqual(['valid', 'partial']);
  const exact = await searchProductsInTable(createMockTable(rows), 'agua');
  expect(exact.map((p) => p.id)).toEqual(['excluded']);
});
