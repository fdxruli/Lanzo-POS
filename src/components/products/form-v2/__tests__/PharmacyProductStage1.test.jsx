// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductFormV2 from '../ProductFormV2';
import PharmacyCompositionEditor from '../rubros/PharmacyCompositionEditor';
import { activeIngredientRepository } from '../../../../services/pharmacy/activeIngredientRepository';

vi.mock('../../../../services/pharmacy/activeIngredientRepository', () => ({
  activeIngredientRepository: {
    list: vi.fn(async () => [
      { id: 'ai-amoxicilina', name: 'Amoxicilina', isActive: true },
      { id: 'ai-clavulanato', name: 'Ácido clavulánico', isActive: true }
    ]),
    create: vi.fn(async (name) => ({ id: 'ai-created', name: String(name).trim(), isActive: true }))
  }
}));
vi.mock('../../../../services/database', () => ({
  queryBatchesByProductIdAndActive: vi.fn(async () => [])
}));
afterEach(() => cleanup());

const show = (props = {}) => render(<ProductFormV2
  activeRubroContext="farmacia" categories={[]} features={{ hasExpiry: true }}
  onSave={() => true} onCancel={() => {}} {...props}
/>);
const openSanitary = () => fireEvent.click(screen.getByRole('button', { name: /Datos farmacéuticos/i }));
const selectStandardPresentation = () => {
  fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'tablet' } });
  fireEvent.change(screen.getByLabelText('Tipo de envase'), { target: { value: 'box' } });
  fireEvent.change(screen.getByLabelText('Contenido'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Unidad del contenido'), { target: { value: 'tableta' } });
};
const addIngredient = async (id, amount, index) => {
  await waitFor(() => expect(screen.getByLabelText('Principio activo registrado').querySelectorAll('option')).toHaveLength(3));
  fireEvent.change(screen.getByLabelText('Principio activo registrado'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar a la composición' }));
  fireEvent.change(screen.getAllByLabelText('Cantidad')[index], { target: { value: String(amount) } });
  fireEvent.change(screen.getAllByLabelText('Unidad de medida')[index], { target: { value: 'mg' } });
  fireEvent.change(screen.getAllByLabelText('Por cantidad base')[index], { target: { value: '1' } });
  fireEvent.change(screen.getAllByLabelText('Unidad base')[index], { target: { value: 'tableta' } });
};

describe('Farmacia - recorrido visual de Etapa 1', () => {
  it('selects the canonical stable ID when legacy accent-equivalent rows are present', async () => {
    activeIngredientRepository.list.mockResolvedValueOnce([
      {
        id: 'ai-accent-legacy', name: 'Paracetamól', nameKey: 'paracetamól',
        createdAt: '2026-11-27T23:19:00.000Z'
      },
      {
        id: 'ai-paracetamol', name: 'Paracetamol', nameKey: 'paracetamol',
        createdAt: '2026-11-27T18:40:00.000Z'
      }
    ]);
    const onCompositionChange = vi.fn();
    render(<PharmacyCompositionEditor
      values={{ compositionIngredients: [], dosageFormCode: 'tablet' }}
      onCompositionChange={onCompositionChange}
    />);

    const select = screen.getByLabelText('Principio activo registrado');
    await waitFor(() => expect(select.querySelectorAll('option')).toHaveLength(2));
    const option = screen.getByRole('option', { name: 'Paracetamol' });
    expect(option).toHaveValue('ai-paracetamol');
    expect(screen.queryByRole('option', { name: 'Paracetamól' })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'ai-paracetamol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a la composición' }));
    expect(onCompositionChange).toHaveBeenCalledWith([
      expect.objectContaining({ activeIngredientId: 'ai-paracetamol', name: 'Paracetamol' })
    ]);
  });

  it('blocks duplicate submission while a new identity is being saved', async () => {
    let resolveCreate;
    activeIngredientRepository.create.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onCompositionChange = vi.fn();
    render(<PharmacyCompositionEditor
      values={{ compositionIngredients: [], dosageFormCode: 'tablet' }}
      onCompositionChange={onCompositionChange}
    />);
    fireEvent.change(screen.getByLabelText('Crear principio activo'), { target: { value: 'Paracetamol' } });

    const createButton = screen.getByRole('button', { name: 'Crear y agregar' });
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    expect(activeIngredientRepository.create).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByLabelText('Crear y agregar')).toBeDisabled();
      expect(screen.getByLabelText('Crear y agregar')).toHaveTextContent('Guardando');
    });

    resolveCreate({ id: 'ai-paracetamol', name: 'Paracetamol', isActive: true });
    await waitFor(() => expect(onCompositionChange).toHaveBeenCalledTimes(1));
  });

  it('crea un medicamento combinado normalizado y recupera los mismos datos al editar', async () => {
    const onSave = vi.fn(() => true);
    const view = show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Amoxicilina + ácido clavulánico QA' } });
    fireEvent.change(screen.getByLabelText(/Costo/i), { target: { value: '25.5' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '40' } });
    openSanitary();
    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    selectStandardPresentation();
    await addIngredient('ai-amoxicilina', '500.5', 0);
    await addIngredient('ai-clavulanato', '125.25', 1);
    fireEvent.change(screen.getByLabelText(/Fracción sanitaria/), { target: { value: 'IV' } });
    fireEvent.click(screen.getByLabelText(/Antibiótico sujeto/i));
    expect(screen.getByText(/Requiere receta médica y controles adicionales/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Requiere receta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({
      prescriptionType: 'antibiotic', requiresPrescription: true,
      activeSubstance: 'Amoxicilina, Ácido clavulánico',
      unit: 'pza', stock: 0, cost: 25.5, price: 40,
      presentation: 'Caja con 10 tabletas',
      metadata: { pharmacy: {
        fraction: 'IV', antibiotic: true, dosageFormCode: 'tablet', dosageForm: 'Tableta',
        concentration: '500.5 mg por tableta; 125.25 mg por tableta',
        commercialPresentation: { version: 1, packageType: 'box', contentAmount: 10, contentUnit: 'tableta' },
        composition: { version: 1, activeIngredients: [
          { activeIngredientId: 'ai-amoxicilina', name: 'Amoxicilina', amount: 500.5, unit: 'mg', basisAmount: 1, basisUnit: 'tableta' },
          { activeIngredientId: 'ai-clavulanato', name: 'Ácido clavulánico', amount: 125.25, unit: 'mg', basisAmount: 1, basisUnit: 'tableta' }
        ] }
      } }
    });
    view.unmount();
    const onEditSave = vi.fn(() => true);
    show({ productToEdit: saved, onSave: onEditSave });
    openSanitary();
    expect(screen.getByLabelText(/Fracción sanitaria/)).toHaveValue('IV');
    expect(screen.getAllByLabelText('Cantidad').map((input) => input.value)).toEqual(['500.5', '125.25']);
    expect(screen.getAllByLabelText('Unidad de medida').map((input) => input.value)).toEqual(['mg', 'mg']);
    expect(screen.getAllByLabelText('Unidad base').map((input) => input.value)).toEqual(['tableta', 'tableta']);
    expect(screen.getByLabelText('Forma farmacéutica')).toHaveValue('tablet');
    expect(screen.getByLabelText('Tipo de envase')).toHaveValue('box');
    expect(screen.getByLabelText('Contenido')).toHaveValue(10);
    fireEvent.change(screen.getByLabelText('Laboratorio'), { target: { value: 'Muse QA' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onEditSave).toHaveBeenCalledTimes(1));
    expect(onEditSave.mock.calls[0][0].metadata.pharmacy).toMatchObject(saved.metadata.pharmacy);
    expect(onEditSave.mock.calls[0][0]).toMatchObject({ unit: 'pza', stock: 0, cost: 25.5, price: 40 });
  });
  it('crea la fracción II inactiva y explica que no puede dispensarse', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Medicamento II QA' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '60' } });
    openSanitary();
    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    selectStandardPresentation();
    await addIngredient('ai-amoxicilina', '500', 0);
    fireEvent.change(screen.getByLabelText(/Fracción sanitaria/), { target: { value: 'II' } });
    expect(screen.getByText(/No habilita dispensación/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      isActive: false, prescriptionType: 'controlled', requiresPrescription: true
    });
  });
  it('conserva los indicadores históricos al editar sin asignarles fracción automática', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave, productToEdit: {
      id: 'legacy-medicine', rubroContext: 'farmacia', name: 'Producto heredado',
      price: 32, cost: 12, stock: 3, prescriptionType: 'antibiotic', requiresPrescription: true
    } });
    openSanitary();
    expect(screen.getByText(/Los datos antiguos de receta se conservan\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ prescriptionType: 'antibiotic', requiresPrescription: true, stock: 3 });
    expect(saved.metadata).not.toHaveProperty('pharmacy');
  });

  it('exige clasificar artículos nuevos y permite activar los marcados como otro producto', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Termómetro QA' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '120' } });
    openSanitary();
    expect(screen.getByLabelText('Tipo de artículo')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    expect(await screen.findByText(/Selecciona si se trata de un medicamento u otro producto de farmacia/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      isActive: true, requiresPrescription: false, prescriptionType: 'otc',
      metadata: { pharmacy: { kind: 'other', status: 'confirmed' } }
    });
  });
});
