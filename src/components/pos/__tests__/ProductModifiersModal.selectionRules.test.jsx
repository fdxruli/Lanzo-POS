// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductModifiersModal from '../ProductModifiersModal';

afterEach(cleanup);

const baseProps = {
  show: true,
  onClose: vi.fn(),
  onConfirm: vi.fn()
};

describe('ProductModifiersModal selection rules', () => {
  it('permite varios extras, suma sus precios y bloquea al llegar al máximo', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const product = {
      id: 'taco-1',
      name: 'Taco al pastor',
      price: 50,
      modifiers: [{
        id: 'extras',
        name: 'Extras',
        selectionType: 'multiple',
        required: false,
        minSelect: 0,
        maxSelect: 2,
        options: [
          { id: 'queso', name: 'Queso extra', price: 10 },
          { id: 'tortillas', name: 'Orden de tortillas', price: 5 },
          { id: 'aguacate', name: 'Aguacate', price: 12 }
        ]
      }]
    };

    render(<ProductModifiersModal {...baseProps} product={product} onConfirm={onConfirm} />);

    const queso = screen.getByRole('checkbox', { name: /Queso extra/ });
    const tortillas = screen.getByRole('checkbox', { name: /Orden de tortillas/ });
    const aguacate = screen.getByRole('checkbox', { name: /Aguacate/ });

    await user.click(queso);
    await user.click(tortillas);

    expect(queso).toBeChecked();
    expect(tortillas).toBeChecked();
    expect(aguacate).toBeDisabled();
    expect(screen.getByText('$65.00', { selector: '.final-price-display' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Agregar/ }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      price: 65,
      selectedModifiers: [
        { id: 'queso', name: 'Queso extra', price: 10 },
        { id: 'tortillas', name: 'Orden de tortillas', price: 5 }
      ]
    });
  });

  it('permite desmarcar una selección única opcional', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const product = {
      id: 'papas-1',
      name: 'Papas',
      price: 35,
      modifiers: [{
        id: 'salsa',
        name: 'Salsa',
        selectionType: 'single',
        required: false,
        minSelect: 0,
        maxSelect: 1,
        options: [
          { id: 'roja', name: 'Roja', price: 0 },
          { id: 'verde', name: 'Verde', price: 0 }
        ]
      }]
    };

    render(<ProductModifiersModal {...baseProps} product={product} onConfirm={onConfirm} />);

    const roja = screen.getByRole('checkbox', { name: /Roja/ });
    await user.click(roja);
    expect(roja).toBeChecked();
    await user.click(roja);
    expect(roja).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /Agregar/ }));
    expect(onConfirm.mock.calls[0][0].selectedModifiers).toEqual([]);
  });

  it('exige el mínimo de un grupo múltiple obligatorio', async () => {
    const user = userEvent.setup();
    const product = {
      id: 'combo-1',
      name: 'Combo',
      price: 100,
      modifiers: [{
        id: 'acompanamientos',
        name: 'Acompañamientos',
        selectionType: 'multiple',
        required: true,
        minSelect: 2,
        maxSelect: 2,
        options: [
          { id: 'papas', name: 'Papas', price: 0 },
          { id: 'ensalada', name: 'Ensalada', price: 0 },
          { id: 'arroz', name: 'Arroz', price: 0 }
        ]
      }]
    };

    render(<ProductModifiersModal {...baseProps} product={product} />);

    const addButton = screen.getByRole('button', { name: /Faltan 1 grupos/ });
    expect(addButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Papas/ }));
    expect(addButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Ensalada/ }));
    expect(screen.getByRole('button', { name: /Agregar/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Arroz/ })).toBeDisabled();
  });
});
