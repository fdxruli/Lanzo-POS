// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashAdjustmentModal from '../CashAdjustmentModal';

afterEach(cleanup);

describe('CashAdjustmentModal without a monetary difference', () => {
  it('confirms the count without promising to save an unused comment', () => {
    const onConfirm = vi.fn();
    render(
      <CashAdjustmentModal
        show
        onClose={vi.fn()}
        onConfirm={onConfirm}
        totalTeorico="100"
      />
    );

    fireEvent.change(screen.getByLabelText('Monto físico real'), { target: { value: '100' } });

    expect(screen.getByRole('button', { name: 'Confirmar conteo' })).toBeEnabled();
    expect(screen.getByText(/no se generará movimiento ni se guardará el comentario/i)).toBeVisible();
    expect(screen.getByLabelText(/Comentario/)).not.toBeRequired();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conteo' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/el comentario no se guardará/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar', exact: true }));

    expect(onConfirm).toHaveBeenCalledWith('100', '');
  });
});
