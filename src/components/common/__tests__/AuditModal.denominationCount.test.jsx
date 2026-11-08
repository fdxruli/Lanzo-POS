// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditModal from '../AuditModal';

afterEach(cleanup);

const setPieces = (label, value) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Cantidad de piezas: ${label}` }), {
    target: { value: String(value) }
  });
};

describe('AuditModal assisted cash count', () => {
  it('passes the exact denomination total into the existing close confirmation', async () => {
    const onConfirmAudit = vi.fn();
    const calcularTeorico = vi.fn().mockResolvedValue('355.50');
    render(
      <AuditModal
        show
        onClose={vi.fn()}
        onConfirmAudit={onConfirmAudit}
        caja={{ id: 'cash-owner' }}
        calcularTeorico={calcularTeorico}
      />
    );

    await waitFor(() => expect(calcularTeorico).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    setPieces('Billete de $200', 1);
    setPieces('Billete de $100', 1);
    setPieces('Billete de $20', 2);
    setPieces('Moneda de $10', 1);
    setPieces('Moneda de $5', 1);
    setPieces('Moneda de 50 centavos', 1);

    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.50');
    expect(screen.getByText('Diferencia')).toBeVisible();
    expect(screen.getByText('Diferencia').nextElementSibling).toHaveTextContent('$0.00');
    fireEvent.change(screen.getByLabelText(/Fondo declarado para el siguiente turno/), {
      target: { value: '0.00' }
    });
    fireEvent.click(screen.getByRole('button', { name: /verificar cuadre/i }));

    expect(screen.getByText('✓ CAJA CUADRADA')).toBeVisible();
    expect(screen.getByText('Total Físico').nextElementSibling).toHaveTextContent('$355.50');
    fireEvent.click(screen.getByRole('button', { name: /confirmar y cerrar caja/i }));

    expect(onConfirmAudit).toHaveBeenCalledWith('355.5', '0', '');
  });

  it('keeps the denomination draft available when returning from the close review', async () => {
    const calcularTeorico = vi.fn().mockResolvedValue('355.50');
    render(
      <AuditModal
        show
        onClose={vi.fn()}
        onConfirmAudit={vi.fn()}
        caja={{ id: 'cash-owner' }}
        calcularTeorico={calcularTeorico}
      />
    );

    await waitFor(() => expect(calcularTeorico).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    setPieces('Billete de $200', 1);
    setPieces('Billete de $100', 1);
    setPieces('Billete de $20', 2);
    setPieces('Moneda de $10', 1);
    setPieces('Moneda de $5', 1);
    setPieces('Moneda de 50 centavos', 1);
    fireEvent.change(screen.getByLabelText(/Fondo declarado para el siguiente turno/), {
      target: { value: '0.00' }
    });
    fireEvent.click(screen.getByRole('button', { name: /verificar cuadre/i }));
    fireEvent.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByRole('radio', { name: 'Conteo por denominaciones' })).toBeChecked();
    expect(screen.getByLabelText('Cantidad de piezas: Moneda de 50 centavos')).toHaveValue('1');
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.50');
  });
});
