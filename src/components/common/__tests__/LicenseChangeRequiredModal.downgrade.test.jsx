// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  licensePlanBlockInfo: null,
  confirmLicenseChangeRequired: vi.fn(),
  recoverDowngradedOwnerDevice: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(store)
}));

import LicenseChangeRequiredModal from '../LicenseChangeRequiredModal';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('LicenseChangeRequiredModal downgrade recovery routing', () => {
  it('offers owner recovery only for the exact Lanzo Local one-device downgrade', () => {
    store.licensePlanBlockInfo = {
      reason: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
      license_key: 'LANZO-SENSITIVE-KEY-12345678',
      plan_code: 'free_trial',
      plan_name: 'Lanzo Local',
      product_name: 'Lanzo POS Free',
      max_devices: 1,
      device_role: 'admin'
    };

    render(<LicenseChangeRequiredModal />);

    expect(screen.getByRole('heading', { name: 'Tu plan cambió a Lanzo Local' })).toBeInTheDocument();
    expect(screen.getByText(/propietario puede elegir usar este dispositivo/i)).toBeInTheDocument();
    expect(screen.queryByText(/12345678/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recuperar este dispositivo' }));
    expect(store.recoverDowngradedOwnerDevice).toHaveBeenCalledTimes(1);
  });

  it('keeps Staff downgrade blocked without offering owner takeover', () => {
    store.licensePlanBlockInfo = {
      reason: 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
      license_key: 'LANZO-STAFF-BLOCKED',
      plan_code: 'free_trial',
      plan_name: 'Lanzo Local',
      max_devices: 1,
      device_role: 'staff'
    };

    render(<LicenseChangeRequiredModal />);

    expect(screen.getByRole('heading', { name: /dispositivo staff ya no está permitido/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recuperar este dispositivo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar licencia' })).toBeInTheDocument();
  });

  it('does not convert a PRO device-limit condition into the Free takeover UX', () => {
    store.licensePlanBlockInfo = {
      reason: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
      license_key: 'LANZO-PRO-LIMIT',
      plan_code: 'pro_monthly',
      plan_name: 'Lanzo Nube',
      max_devices: 5,
      device_role: 'admin'
    };

    render(<LicenseChangeRequiredModal />);

    expect(screen.queryByRole('button', { name: 'Recuperar este dispositivo' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /excede el límite del nuevo plan/i })).toBeInTheDocument();
  });
});
