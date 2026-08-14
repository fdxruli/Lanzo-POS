// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CajaLegacyCashTransition from '../CajaLegacyCashTransition';
import { buildLegacyCashAdoptionConfirmation } from '../../../../services/cash/cashDeviceLabel';

afterEach(cleanup);

const legacy = {
  id: 'cash-legacy-a',
  responsible_name: 'Administrador',
  expected_cash_total: '75',
  opened_at: '2026-08-01T12:00:00.000Z',
  opened_by_device_id: 'device-android',
  opened_by_device_name: 'Chrome en Android',
  server_version: 4
};

const legacyB = {
  ...legacy,
  id: 'cash-legacy-b',
  expected_cash_total: '1196',
  opened_by_device_id: 'device-linux',
  opened_by_device_name: 'Chrome en Linux'
};

describe('CajaLegacyCashTransition', () => {
  it('keeps every legacy session visible and lets the admin select exactly one', () => {
    const onAdopt = vi.fn();
    const onReview = vi.fn();
    render(<CajaLegacyCashTransition sessions={[legacy, legacyB]} onAdopt={onAdopt} onReview={onReview} />);

    expect(screen.getByText('Encontramos cajas administrativas anteriores')).toBeInTheDocument();
    expect(screen.getByText(/Dispositivo original: Chrome en Android/)).toBeInTheDocument();
    expect(screen.getByText(/Dispositivo original: Chrome en Linux/)).toBeInTheDocument();
    expect(screen.getByText(/\$75\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1196\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/device-android/)).not.toBeInTheDocument();
    expect(screen.queryByText(/device-linux/)).not.toBeInTheDocument();
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

  it('uses a neutral fallback instead of exposing a technical device identifier', () => {
    render(<CajaLegacyCashTransition sessions={[{ ...legacy, opened_by_device_name: null }]} />);
    expect(screen.getByText(/Dispositivo original: Dispositivo registrado/)).toBeInTheDocument();
    expect(screen.queryByText(/device-android/)).not.toBeInTheDocument();
  });

  it('renders each legacy device label independently', () => {
    render(<CajaLegacyCashTransition sessions={[
      legacy,
      legacyB
    ]} />);
    expect(screen.getByText(/Chrome en Android/)).toBeInTheDocument();
    expect(screen.getByText(/Chrome en Linux/)).toBeInTheDocument();
  });

  it('uses the same readable device label in the adoption confirmation', () => {
    expect(buildLegacyCashAdoptionConfirmation(legacy)).toContain('Dispositivo original: Chrome en Android');
    expect(buildLegacyCashAdoptionConfirmation(legacy)).not.toContain('device-android');
  });
});
