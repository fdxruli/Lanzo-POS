import { describe, expect, it } from 'vitest';
import { buildProductFormPayload } from '../../../components/products/form-v2/domain/buildProductFormPayload';
import { getProductFormDefaults } from '../../../components/products/form-v2/config/productFormDefaults';
import { cloudProductToLocal, productToCloudPayload } from '../productMapper';

const newMedication = () => ({
  ...getProductFormDefaults({ activeRubro: 'farmacia' }),
  id: 'med-qa', name: 'Amoxicilina QA 500 mg', price: 40, cost: 15,
  pharmacyKind: 'medicine',
  activeSubstance: 'Amoxicilina', concentration: '500 mg',
  dosageForm: 'capsule', presentation: 'Caja con 12 cápsulas',
  laboratory: 'Laboratorio QA', sanitaryFraction: 'IV', isAntibiotic: true
});

describe('Farmacia - payload a Cloud y de regreso', () => {
  it('persists a selected commercial category and preserves it in partial Cloud responses', () => {
    const selected = { ...newMedication(), categoryId: 'cat-medicamentos' };
    const formPayload = buildProductFormPayload(selected, { activeRubro: 'farmacia' });
    expect(formPayload.categoryId).toBe('cat-medicamentos');
    const payload = productToCloudPayload(formPayload);
    expect(payload.category_id).toBe('cat-medicamentos');
    const reloaded = cloudProductToLocal(payload);
    expect(getProductFormDefaults({ activeRubro: 'farmacia', productToEdit: reloaded }).categoryId)
      .toBe('cat-medicamentos');

    const partial = cloudProductToLocal(
      { id: 'med-qa', stock: 12, committed_stock: 0 },
      reloaded
    );
    expect(partial.categoryId).toBe('cat-medicamentos');
  });

  it('keeps an explicit choice to remove a product category', () => {
    const formPayload = buildProductFormPayload(
      { ...newMedication(), categoryId: '' },
      { activeRubro: 'farmacia' }
    );
    expect(productToCloudPayload(formPayload).category_id).toBeNull();
    expect(cloudProductToLocal(
      { id: 'med-qa', category_id: null },
      { id: 'med-qa', categoryId: 'cat-medicamentos' }
    ).categoryId).toBe('');
  });

  it('persiste metadatos y flags de antibiótico sin convertirlo en controlado', () => {
    const initial = buildProductFormPayload(newMedication(), { activeRubro: 'farmacia' });
    expect(initial.metadata.pharmacy).toMatchObject({ fraction: 'IV', antibiotic: true, concentration: '500 mg' });
    expect(initial).toMatchObject({ requiresPrescription: true, prescriptionType: 'antibiotic', isActive: true });
    const cloud = productToCloudPayload(initial);
    expect(cloud.metadata.pharmacy).toEqual(initial.metadata.pharmacy);
    const reloaded = cloudProductToLocal(cloud);
    expect(getProductFormDefaults({ activeRubro: 'farmacia', productToEdit: reloaded }))
      .toMatchObject({ sanitaryFraction: 'IV', isAntibiotic: true, concentration: '500 mg', dosageForm: 'capsule' });
  });
  it('fuerza inactivo un medicamento nuevo fracción II', () => {
    const values = { ...newMedication(), sanitaryFraction: 'II', isAntibiotic: false };
    expect(buildProductFormPayload(values, { activeRubro: 'farmacia' }))
      .toMatchObject({ isActive: false, requiresPrescription: true, prescriptionType: 'controlled' });
  });
  it('conserva restricciones y campos del histórico al editar sin clasificar', () => {
    const old = { id: 'old-med', name: 'Herencia', price: 30, cost: 20, stock: 11,
      requiresPrescription: true, prescriptionType: 'antibiotic', metadata: { custom: 'guardado' } };
    const values = getProductFormDefaults({ activeRubro: 'farmacia', productToEdit: old });
    const result = buildProductFormPayload({ ...values, price: 34 }, {
      activeRubro: 'farmacia', productToEdit: old
    });
    expect(result).toMatchObject({ price: 34, stock: 11, requiresPrescription: true,
      prescriptionType: 'antibiotic', metadata: { custom: 'guardado' } });
    expect(result.metadata).not.toHaveProperty('pharmacy');
  });
  it('separa producto no medicinal de fracciones legales', () => {
    const values = { ...newMedication(), pharmacyKind: 'other', sanitaryFraction: '', isAntibiotic: false };
    const saved = buildProductFormPayload(values, { activeRubro: 'farmacia' });
    expect(saved.metadata.pharmacy).toMatchObject({ kind: 'other', fraction: null, antibiotic: false });
  });
});
