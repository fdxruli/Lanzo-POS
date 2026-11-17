// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuickVariantEntry from '../QuickVariantEntry';

const existingVariants = [{
  id: 'variant-1',
  talla: 'S',
  color: 'Negro',
  sku: '',
  stock: 2,
  cost: 100,
  price: 200
}];

afterEach(cleanup);

describe('QuickVariantEntry mobile accessibility', () => {
  it('labels the fields in each variant and retains add/remove controls', async () => {
    const onVariantsChange = vi.fn();
    render(<QuickVariantEntry basePrice="200" baseCost="100" initialData={existingVariants} onVariantsChange={onVariantsChange} />);

    expect(screen.getByRole('textbox', { name: 'Color de la variante 1' })).toHaveValue('Negro');
    expect(screen.getByRole('textbox', { name: 'Talla de la variante 1' })).toHaveValue('S');
    expect(screen.getByRole('spinbutton', { name: 'Existencias de la variante 1' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: 'Costo de la variante 1' })).toHaveValue(100);
    expect(screen.getByRole('spinbutton', { name: 'Precio de la variante 1' })).toHaveValue(200);
    expect(screen.getByRole('textbox', { name: 'SKU de la variante 1' })).toHaveValue('');

    fireEvent.change(screen.getByRole('textbox', { name: 'Color de la variante 1' }), { target: { value: 'Azul' } });
    await waitFor(() => expect(onVariantsChange).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ color: 'Azul', talla: 'S' })
    ])));

    fireEvent.click(screen.getByRole('button', { name: /Agregar variante manual/i }));
    expect(screen.getByRole('textbox', { name: 'Talla de la variante 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar variante 2' }));
    expect(screen.queryByRole('textbox', { name: 'Talla de la variante 2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar variante 1' })).toBeInTheDocument();
  });
});
