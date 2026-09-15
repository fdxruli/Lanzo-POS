// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataSafetyModal from './DataSafetyModal';

const appState = {
  licenseDetails: null,
  currentDeviceRole: 'admin',
  currentStaffUser: null
};

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

vi.mock('../../services/utils', () => ({
  tryEnablePersistence: vi.fn(() => Promise.resolve())
}));

describe('DataSafetyModal', () => {
  const LocationProbe = () => {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}{location.search}</output>;
  };

  const renderModal = () => render(
    <MemoryRouter>
      <DataSafetyModal />
      <LocationProbe />
    </MemoryRouter>
  );

  beforeEach(() => {
    localStorage.clear();
    Object.assign(appState, {
      licenseDetails: {
        plan_code: 'free',
        features: { cloud_pos_sync: false }
      },
      currentDeviceRole: 'admin',
      currentStaffUser: null
    });
  });

  it('shows the local data warning for a new FREE admin device', async () => {
    renderModal();

    expect(await screen.findByRole('heading', { name: 'Protege la información de tu negocio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument();
    expect(screen.queryByText(/advertencia cr.tica/i)).toBeNull();
  });

  it('does not show the warning for a PRO license', async () => {
    appState.licenseDetails = {
      plan_code: 'pro',
      features: { cloud_pos_sync: true }
    };

    renderModal();

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Protege la información de tu negocio' })).toBeNull();
    });
  });

  it('does not show the warning for a staff session', async () => {
    Object.assign(appState, {
      licenseDetails: {
        plan_code: 'free',
        device_role: 'staff',
        features: { cloud_pos_sync: false }
      },
      currentDeviceRole: 'staff',
      currentStaffUser: { id: 'staff-1', username: 'caja' }
    });

    renderModal();

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Protege la información de tu negocio' })).toBeNull();
    });
  });

  it('keeps the acknowledgement and exposes the backup route as a secondary action', async () => {
    renderModal();

    expect(await screen.findByRole('button', { name: 'Ver cómo respaldar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entendido' })).toHaveClass('ui-button--primary');
    expect(screen.getByRole('button', { name: 'Ver cómo respaldar' })).toHaveClass('ui-button--secondary');

    screen.getByRole('button', { name: 'Entendido' }).click();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Protege la información de tu negocio' })).toBeNull());
    expect(localStorage.getItem('lanzo_data_safety_ack')).toBe('true');
  });

  it('navigates through React Router when the backup action is selected', async () => {
    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver cómo respaldar' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/configuracion?tab=maintenance');
    });
  });
});

afterEach(() => {
  cleanup();
});
