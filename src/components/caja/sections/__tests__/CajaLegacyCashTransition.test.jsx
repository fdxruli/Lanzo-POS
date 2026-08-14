// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaLegacyCashTransition from '../CajaLegacyCashTransition';

afterEach(cleanup);

const legacy = {
  id: 'cash-legacy-a',
  responsible_name: 'Administrador',
  expected_cash_total: '75',
  opened_at: '2026-08-01T12:00:00.000Z',
  opened_by_device_id: 'device-android',
  server_version: 4
};

describe('CajaLegacyCashTransition', () => {
  it('keeps every legacy session visible and lets the admin select exactly one', () => {
    const onAdopt = vi.fn();
    const onReview = vi.fn();
    render(<CajaLegacyCashTransition sessions={[legacy, { ...legacy, id: 'cash-legacy-b', expected_cash_total: '1196' }]} onAdopt={onAdopt} onReview={onReview} />);

    expect(screen.getByText('Encontramos cajas administrativas anteriores')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Continuar esta caja' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Continuar esta caja' })[0]);
    expect(onAdopt).toHaveBeenCalledWith(legacy);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onReview).not.toHaveBeenCalled();
  });

  it('does not allow adoption while cloud cash is read-only', () => {
    render(<CajaLegacyCashTransition sessions={[legacy]} isReadOnly onAdopt={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continuar esta caja' })).toBeDisabled();
  });
});
