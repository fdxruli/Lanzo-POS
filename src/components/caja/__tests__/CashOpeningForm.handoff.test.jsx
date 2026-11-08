// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashOpeningForm from '../CashOpeningForm';

afterEach(cleanup);

describe('CashOpeningForm shift receipt', () => {
  it('requires a fresh physical count and records a difference from the previous declared fund', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    render(
      <CashOpeningForm
        suggestedAmount="50"
        hasSuggestedAmount
        requirePhysicalCount
        responsibleName="Staff B"
        lockResponsible
        onConfirm={onConfirm}
        submitLabel="Confirmar y abrir turno"
      />
    );

    const [openingAmount, countedAmount] = screen.getAllByRole('spinbutton');
    expect(openingAmount).toHaveValue(50);
    expect(countedAmount).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Confirmar y abrir turno' })).toBeDisabled();

    fireEvent.change(countedAmount, { target: { value: '45' } });
    expect(screen.getByText(/Ajusta el fondo confirmado/)).toBeVisible();
    fireEvent.change(openingAmount, { target: { value: '45' } });
    expect(screen.getByText(/diferencia de apertura de \$-5.00 contra el fondo de referencia/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y abrir turno' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      montoInicial: '45',
      montoContado: '45',
      responsable: 'Staff B'
    })));
  });

  it('does not label a missing prior-close reference as a zero-dollar handoff', () => {
    render(
      <CashOpeningForm
        suggestedAmount="0"
        hasSuggestedAmount={false}
        requirePhysicalCount
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Cuenta el efectivo físico que recibes/)).toBeVisible();
    expect(screen.queryByText('Fondo sugerido por el cierre anterior')).not.toBeInTheDocument();
  });
});
