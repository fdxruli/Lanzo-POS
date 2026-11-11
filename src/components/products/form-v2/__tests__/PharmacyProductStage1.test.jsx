// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProductFormV2 from '../ProductFormV2';

vi.mock('../../../../services/database', () => ({
  queryBatchesByProductIdAndActive: vi.fn(async () => [])
}));
afterEach(() => cleanup());

const show = (props = {}) => render(<ProductFormV2
  activeRubroContext="farmacia" categories={[]} features={{ hasExpiry: true }}
  onSave={() => true} onCancel={() => {}} {...props}
/>);
const openSanitary = () => fireEvent.click(screen.getByRole('button', { name: /Datos farmacéuticos/i }));

describe('Farmacia - recorrido visual de Etapa 1', () => {
  it('guarda antibiótico IV con receta derivada y recupera datos al reabrir', async () => {
    const onSave = vi.fn(() => true);
    const view = show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Amoxicilina QA 500 mg' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '40' } });
    openSanitary();
    fireEvent.change(screen.getByLabelText('Sustancia activa'), { target: { value: 'Amoxicilina' } });
    fireEvent.change(screen.getByLabelText('Concentración'), { target: { value: '500 mg' } });
    fireEvent.change(screen.getByLabelText('Forma farmacéutica'), { target: { value: 'Cápsula' } });
    fireEvent.change(screen.getByLabelText('Presentación'), { target: { value: 'Caja con 12 cápsulas' } });
    fireEvent.change(screen.getByLabelText(/Fracción sanitaria/), { target: { value: 'IV' } });
    fireEvent.click(screen.getByLabelText(/Antibiótico sujeto/i));
    expect(screen.getByText(/Requiere receta médica y controles adicionales/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Requiere receta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({
      prescriptionType: 'antibiotic', requiresPrescription: true,
      metadata: { pharmacy: { fraction: 'IV', antibiotic: true, concentration: '500 mg' } }
    });
    view.unmount();
    show({ productToEdit: saved });
    openSanitary();
    expect(screen.getByLabelText(/Fracción sanitaria/)).toHaveValue('IV');
    expect(screen.getByLabelText('Concentración')).toHaveValue('500 mg');
    expect(screen.getByLabelText('Forma farmacéutica')).toHaveValue('Cápsula');
  });
  it('crea la fracción II inactiva y explica que no puede dispensarse', async () => {
    const onSave = vi.fn(() => true);
    show({ onSave });
    fireEvent.change(screen.getByLabelText(/Nombre del producto/i), { target: { value: 'Medicamento II QA' } });
    fireEvent.change(screen.getByLabelText(/Precio de venta/i), { target: { value: '60' } });
    openSanitary();
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
    expect(screen.getByText(/Clasificación sanitaria pendiente de confirmar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar producto/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ prescriptionType: 'antibiotic', requiresPrescription: true, stock: 3 });
    expect(saved.metadata).not.toHaveProperty('pharmacy');
  });
});
