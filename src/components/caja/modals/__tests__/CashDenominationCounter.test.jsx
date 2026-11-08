// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CashDenominationCounter from '../CashDenominationCounter';

afterEach(cleanup);

const setPieces = (label, value) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Cantidad de piezas: ${label}` }), {
    target: { value: String(value) }
  });
};

const ControlledCounterHarness = ({ onChange, expectedAmount, inputId }) => {
  const [value, setValue] = useState('');
  return (
    <CashDenominationCounter
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        onChange(nextValue);
      }}
      expectedAmount={expectedAmount}
      inputId={inputId}
    />
  );
};

describe('CashDenominationCounter', () => {
  it('counts MXN denominations exactly, shows a 50-cent shortage, and keeps counts editable', () => {
    const onChange = vi.fn();
    render(
      <ControlledCounterHarness
        onChange={onChange}
        expectedAmount="355.50"
        inputId="cash-count-test"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    setPieces('Billete de $200', 1);
    setPieces('Billete de $100', 1);
    setPieces('Billete de $20', 2);
    setPieces('Moneda de $10', 1);
    setPieces('Moneda de $5', 1);
    setPieces('Moneda de 50 centavos', 1);

    expect(screen.getByText('Subtotal billetes').nextElementSibling).toHaveTextContent('$340.00');
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.50');
    expect(screen.getByText('Diferencia').nextElementSibling).toHaveTextContent('$0.00');
    expect(onChange).toHaveBeenLastCalledWith('355.5');

    setPieces('Moneda de 50 centavos', '');
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.00');
    expect(screen.getByText('Faltante')).toBeVisible();
    expect(screen.getByText('Faltante').nextElementSibling).toHaveTextContent('−$0.50');
    expect(onChange).toHaveBeenLastCalledWith('355');

    fireEvent.click(screen.getByRole('radio', { name: 'Total manual' }));
    expect(screen.getByLabelText('Efectivo contado')).toHaveValue(355);
    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    expect(screen.getByLabelText('Cantidad de piezas: Billete de $200')).toHaveValue('1');
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$355.00');
  });

  it('accepts only whole non-negative piece counts', () => {
    render(
      <CashDenominationCounter
        value=""
        onChange={vi.fn()}
        expectedAmount="0"
        inputId="cash-count-validation"
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Conteo por denominaciones' }));
    fireEvent.click(screen.getByText('Más centavos (20¢, 10¢ y 5¢)'));
    const quantity = screen.getByRole('textbox', { name: 'Cantidad de piezas: Moneda de 20 centavos' });
    fireEvent.change(quantity, { target: { value: '1.5' } });
    expect(quantity).toHaveValue('');
    fireEvent.change(quantity, { target: { value: '-1' } });
    expect(quantity).toHaveValue('');
    fireEvent.change(quantity, { target: { value: '3' } });
    expect(quantity).toHaveValue('3');
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$0.60');
    fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad de piezas: Moneda de 5 centavos' }), { target: { value: '1' } });
    expect(screen.getByText('Total contado').nextElementSibling).toHaveTextContent('$0.65');
  });
});
