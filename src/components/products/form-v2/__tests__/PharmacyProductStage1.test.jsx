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
const openSanitary = () => {
  const toggle = screen.getByRole('button', { name: /Datos farmacéuticos/i });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
};
const selectStandardPresentation = () => {
  fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'tablet' } });
  fireEvent.change(screen.getByLabelText('Tipo de envase'), { target: { value: 'box' } });
  fireEvent.change(screen.getByLabelText('Contenido'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Unidad del contenido'), { target: { value: 'tableta' } });
};
const ingredientNames = { 'ai-amoxicilina': 'Amoxicilina', 'ai-clavulanato': 'Ácido clavulánico' };
const addIngredient = async (id, amount) => {
  await waitFor(() => expect(screen.getByLabelText('Principio activo').querySelectorAll('option')).toHaveLength(3));
  fireEvent.change(screen.getByLabelText('Principio activo'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar al medicamento' }));
  const name = ingredientNames[id];
  fireEvent.change(screen.getByLabelText(`Cantidad de ${name}`), { target: { value: String(amount) } });
  fireEvent.change(screen.getByLabelText(`Unidad de concentración de ${name}`), { target: { value: 'mg' } });
  fireEvent.change(screen.getByLabelText(`Cantidad base de ${name}`), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText(`Unidad base de ${name}`), { target: { value: 'tableta' } });
};

describe('Farmacia - recorrido visual de Etapa 1', () => {
  it('abre Datos farmacéuticos y no muestra un estado configurado en un formulario vacío', () => {
    show();
    const toggle = screen.getByRole('button', { name: /Datos farmacéuticos/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.closest('.product-form-v2__accordion')).toHaveTextContent('Opcional');
    expect(screen.queryByText('Configurado')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Medicamento · clasificación sanitaria pendiente')).toBeInTheDocument();
    expect(screen.getByText('Agrega los principios activos y sus concentraciones.')).toBeInTheDocument();
  });

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

    const select = screen.getByLabelText('Principio activo');
    await waitFor(() => expect(select.querySelectorAll('option')).toHaveLength(2));
    const option = screen.getByRole('option', { name: 'Paracetamol' });
    expect(option).toHaveValue('ai-paracetamol');
    expect(screen.queryByRole('option', { name: 'Paracetamól' })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'ai-paracetamol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al medicamento' }));
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
    fireEvent.click(screen.getByText('Crear un principio activo'));
    fireEvent.change(screen.getByLabelText('Nombre del nuevo principio activo'), { target: { value: 'Paracetamol' } });

    const createButton = screen.getByRole('button', { name: 'Crear y agregar' });
    fireEvent.click(createButton);
    fireEvent.click(createButton);
    expect(activeIngredientRepository.create).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Guardando/i })).toBeDisabled();
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
    await addIngredient('ai-amoxicilina', '500.5');
    await addIngredient('ai-clavulanato', '125.25');
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
    expect(screen.getByLabelText('Cantidad de Amoxicilina')).toHaveValue(500.5);
    expect(screen.getByLabelText('Cantidad de Ácido clavulánico')).toHaveValue(125.25);
    expect(screen.getByLabelText('Unidad de concentración de Amoxicilina')).toHaveValue('mg');
    expect(screen.getByLabelText('Unidad de concentración de Ácido clavulánico')).toHaveValue('mg');
    expect(screen.getByLabelText('Unidad base de Amoxicilina')).toHaveValue('tableta');
    expect(screen.getByLabelText('Unidad base de Ácido clavulánico')).toHaveValue('tableta');
    expect(screen.getByLabelText('Forma farmacéutica')).toHaveValue('tablet');
    expect(screen.getByLabelText('Tipo de envase')).toHaveValue('box');
    expect(screen.getByLabelText('Contenido')).toHaveValue(10);
    fireEvent.change(screen.getByLabelText('Laboratorio'), { target: { value: 'Muse QA' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onEditSave).toHaveBeenCalledTimes(1));
    expect(onEditSave.mock.calls[0][0].metadata.pharmacy).toMatchObject(saved.metadata.pharmacy);
    expect(onEditSave.mock.calls[0][0]).toMatchObject({ unit: 'pza', stock: 0, cost: 25.5, price: 40 });
  });

  it('usa la forma como unidad base inicial y no cambia una concentración ya capturada', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'suspension' } });
    await waitFor(() => expect(screen.getByLabelText('Principio activo').querySelectorAll('option')).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Principio activo'), { target: { value: 'ai-amoxicilina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al medicamento' }));
    expect(screen.getByLabelText('Unidad base de Amoxicilina')).toHaveValue('mL');

    fireEvent.change(screen.getByLabelText('Cantidad de Amoxicilina'), { target: { value: '250.5' } });
    fireEvent.change(screen.getByLabelText('Unidad de concentración de Amoxicilina'), { target: { value: 'mg' } });
    fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'tablet' } });
    expect(screen.getByLabelText('Unidad base de Amoxicilina')).toHaveValue('mL');
    expect(screen.getByText('Amoxicilina 250.5 mg por mL')).toBeInTheDocument();
  });

  it('guarda una concentración líquida simple con decimales y resumen comprensible', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Amoxicilina suspensión QA' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'suspension' } });
    fireEvent.change(screen.getByLabelText('Tipo de envase'), { target: { value: 'bottle' } });
    fireEvent.change(screen.getByLabelText('Contenido'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Unidad del contenido'), { target: { value: 'mL' } });
    await waitFor(() => expect(screen.getByLabelText('Principio activo').querySelectorAll('option')).toHaveLength(3));
    fireEvent.change(screen.getByLabelText('Principio activo'), { target: { value: 'ai-amoxicilina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al medicamento' }));
    fireEvent.change(screen.getByLabelText('Cantidad de Amoxicilina'), { target: { value: '250.5' } });
    fireEvent.change(screen.getByLabelText('Unidad de concentración de Amoxicilina'), { target: { value: 'mg' } });
    fireEvent.change(screen.getByLabelText('Cantidad base de Amoxicilina'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Fracción sanitaria/), { target: { value: 'IV' } });

    expect(screen.getByText('Amoxicilina 250.5 mg por 5 mL')).toBeInTheDocument();
    expect(screen.getByText('Suspensión · Frasco con 120 mL')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].metadata.pharmacy).toMatchObject({
      concentration: '250.5 mg por 5 mL',
      commercialPresentation: { version: 1, packageType: 'bottle', contentAmount: 120, contentUnit: 'mL' },
      composition: { version: 1, activeIngredients: [{
        activeIngredientId: 'ai-amoxicilina', name: 'Amoxicilina', amount: 250.5, unit: 'mg', basisAmount: 5, basisUnit: 'mL'
      }] }
    });
  });

  it('mantiene los datos históricos plegados, editables y sin asumir una unidad base', () => {
    show({ productToEdit: {
      id: 'legacy-concentration', rubroContext: 'farmacia', name: 'Medicamento anterior',
      activeSubstance: 'Paracetamol', price: 30, stock: 2,
      metadata: { pharmacy: { kind: 'medicine', concentration: '500 mg por 1' } }
    } });
    expect(screen.getByText('Datos anteriores del medicamento')).toBeInTheDocument();
    const legacyDetails = screen.getByText('Datos anteriores del medicamento').closest('details');
    expect(legacyDetails).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Datos anteriores del medicamento'));
    expect(screen.getByLabelText('Sustancia activa anterior')).toHaveValue('Paracetamol');
    expect(screen.getByLabelText('Concentración anterior')).toHaveValue('500 mg por 1');
    expect(screen.getByText('Dato anterior: Paracetamol · 500 mg por 1')).toBeInTheDocument();
    expect(screen.queryByText(/500 mg por tableta/i)).not.toBeInTheDocument();
  });

  it('mantiene visible la concentración histórica al reemplazarla y guarda el valor nuevo', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave, productToEdit: {
      id: 'legacy-replace-concentration', rubroContext: 'farmacia', name: 'Medicamento anterior',
      activeSubstance: 'Paracetamol', price: 30, stock: 2,
      metadata: { pharmacy: { kind: 'medicine', concentration: '500 mg por 1' } }
    } });
    fireEvent.click(screen.getByText('Datos anteriores del medicamento'));

    fireEvent.change(screen.getByLabelText('Concentración anterior'), { target: { value: '' } });
    expect(screen.getByLabelText('Concentración anterior')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Concentración anterior'), { target: { value: '250 mg por 5 mL' } });
    expect(screen.getByLabelText('Concentración anterior')).toHaveValue('250 mg por 5 mL');

    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].metadata.pharmacy.concentration).toBe('250 mg por 5 mL');
  });

  it('conserva los datos históricos al editar un campo ajeno', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave, productToEdit: {
      id: 'legacy-preserve-fields', rubroContext: 'farmacia', name: 'Medicamento anterior',
      activeSubstance: 'Paracetamol', laboratory: 'Laboratorio anterior', presentation: 'Caja histórica',
      price: 30, cost: 10, stock: 2,
      metadata: { pharmacy: { kind: 'medicine', concentration: '500 mg por 1' } }
    } });
    fireEvent.change(screen.getByLabelText('Laboratorio'), { target: { value: 'Laboratorio actualizado' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      activeSubstance: 'Paracetamol',
      presentation: 'Caja histórica',
      laboratory: 'Laboratorio actualizado',
      metadata: { pharmacy: { concentration: '500 mg por 1' } }
    });
  });

  it('crea la fracción II inactiva y explica que no puede dispensarse', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Medicamento II QA' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '60' } });
    openSanitary();
    fireEvent.change(screen.getByLabelText('Tipo de artículo'), { target: { value: 'medicine' } });
    selectStandardPresentation();
    await addIngredient('ai-amoxicilina', '500');
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
