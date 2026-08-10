// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeProduceSaleConfiguration } from '../../domain/productFormNormalization';
import ProduceSaleSetupFields from '../ProduceSaleSetupFields';

const initialValues = { saleMode: 'bulk', saleType: 'bulk', unit: 'kg' };

function ProduceSaleSetupHarness({ initial = initialValues }) {
  const [values, setValues] = useState(initial);
  const setSaleMode = (saleMode) => setValues((previous) => ({
    ...previous,
    ...normalizeProduceSaleConfiguration({ saleMode, saleType: saleMode, unit: previous.unit })
  }));

  return <ProduceSaleSetupFields
    values={values}
    onSaleMode={setSaleMode}
    onFieldChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))}
  />;
}

afterEach(cleanup);

describe('ProduceSaleSetupFields', () => {
  it('defaults to weight by kilogram and only offers kilogram or gram', () => {
    render(<ProduceSaleSetupHarness />);

    const unit = screen.getByLabelText(/Unidad de venta/i);
    expect(screen.getByRole('radio', { name: /Por peso/i })).toHaveAttribute('aria-checked', 'true');
    expect(unit).toHaveValue('kg');
    expect(Array.from(unit.options).map((option) => option.value)).toEqual(['kg', 'g']);
  });

  it('normalizes both sale-mode transitions and hides the weight unit for pieces', () => {
    render(<ProduceSaleSetupHarness />);

    fireEvent.click(screen.getByRole('radio', { name: /Por pieza/i }));
    expect(screen.getByRole('radio', { name: /Por pieza/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(/Unidad de venta/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Se venderá por pieza o unidad/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Por peso/i }));
    const unit = screen.getByLabelText(/Unidad de venta/i);
    expect(unit).toHaveValue('kg');
    fireEvent.change(unit, { target: { value: 'g' } });
    expect(unit).toHaveValue('g');

    fireEvent.click(screen.getByRole('radio', { name: /Por pieza/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Por peso/i }));
    expect(screen.getByLabelText(/Unidad de venta/i)).toHaveValue('kg');
  });
});
