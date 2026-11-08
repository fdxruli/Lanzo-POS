// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashAdjustmentModal from '../CashAdjustmentModal';

afterEach(cleanup);

const setPieces = (label, value) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Cantidad de piezas: ${label}` }), {
    target: { value: String(value) }
  });
};

describe('CashAdjustmentModal assisted cash count', () => {
  it('uses the exact counted total for the existing no-adjustment confirmation', () => {
    const onConfirm = vi.fn();
    render(
      <CashAdjustmentModal
        show
        onClose={vi.fn()}
        onConfirm={onConfirm}
        totalTeorico="355.50"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    setPieces('Billete de $200', 1);
    setPieces('Billete de $100', 1);
    setPieces('Billete de $20', 2);
    setPieces('Moneda de $10', 1);
    setPieces('Moneda de $5', 1);
    setPieces('Moneda de 50 centavos', 1);

    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.50');
    expect(screen.getByText(/no se generará movimiento ni se guardará el comentario/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conteo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar', exact: true }));

    expect(onConfirm).toHaveBeenCalledWith('355.5', '');
  });

  it('shows the existing shortage and allows correcting a denomination in place', () => {
    render(
      <CashAdjustmentModal
        show
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        totalTeorico="355.50"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    setPieces('Billete de $200', 1);
    setPieces('Billete de $100', 1);
    setPieces('Billete de $20', 2);
    setPieces('Moneda de $10', 1);
    setPieces('Moneda de $5', 1);
    setPieces('Moneda de 50 centavos', 1);
    setPieces('Moneda de 50 centavos', '');

    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.00');
    expect(screen.getByText(/diferencia calculada/i).parentElement).toHaveTextContent('$0.50');
    expect(screen.getByRole('textbox', { name: /comentario/i })).toBeRequired();
    setPieces('Moneda de 50 centavos', 1);
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.50');
    expect(screen.getByRole('textbox', { name: /comentario/i })).not.toBeRequired();
  });
});
