// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  licenseDetails: null,
  settingsAccess: null,
  stationSettings: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ licenseDetails: state.licenseDetails })
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.settingsAccess
}));

vi.mock('../../../hooks/restaurant/usePreparationStations', () => ({
  usePreparationStations: () => state.stationSettings
}));

import PreparationStationsSettings from '../PreparationStationsSettings';

const freeLicense = () => ({
  valid: true,
  is_entitled: true,
  is_lifetime: true,
  status: 'active',
  plan_code: 'free',
  license_type: 'free',
  expires_at: null,
  features: {
    preparation_stations: false,
    staff_roles: false,
    realtime_license_sync: false,
    cloud_pos_sync: false
  }
});

const kitchenStation = {
  id: 'station_kitchen',
  code: 'kitchen',
  name: 'Cocina',
  isDefault: true,
  isActive: true
};

function setScenario({ dynamic = false, canManage = true, isAdmin = true } = {}) {
  state.licenseDetails = dynamic
    ? {
      ...freeLicense(),
      plan_code: 'pro',
      features: { ...freeLicense().features, preparation_stations: true }
    }
    : freeLicense();
  state.settingsAccess = {
    isAuthorizedActor: true,
    isAdmin,
    canAccessSection: () => isAdmin
  };
  state.stationSettings = {
    stations: [kitchenStation],
    isLoading: false,
    error: null,
    canManageStations: dynamic && canManage,
    isDynamicStationsEnabled: dynamic,
    refreshStations: vi.fn(),
    createStation: vi.fn(),
    updateStation: vi.fn(),
    toggleStation: vi.fn()
  };
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <PreparationStationsSettings />
    </MemoryRouter>
  );
}

describe('PreparationStationsSettings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows Cocina before the Nube capabilities for an authorized Local admin', () => {
    setScenario();

    renderSettings();

    expect(screen.getByRole('heading', { level: 2, name: 'Áreas de preparación' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Organiza tus comandas por áreas' })).toBeInTheDocument();
    expect(screen.getByText('Cocina')).toBeInTheDocument();
    expect(screen.getByText('Tu estación actual · Disponible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Múltiples áreas de preparación' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comandas dirigidas por producto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Control de estaciones' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lleva la preparación al siguiente nivel' })).toBeInTheDocument();

    const sectionHeading = screen.getByRole('heading', { level: 2, name: 'Áreas de preparación' });
    const showcaseHeading = screen.getByRole('heading', { name: 'Organiza tus comandas por áreas' });
    const intro = screen.getByText(/Con tu plan actual, las comandas se dirigen a Cocina/);
    const kitchen = screen.getByText('Tu estación actual · Disponible');
    const features = screen.getByRole('heading', { name: 'Lo que puedes explorar' });
    const offer = screen.getByRole('heading', { name: 'Lleva la preparación al siguiente nivel' });
    const link = screen.getByRole('link', { name: /Conocer Lanzo Nube/ });

    expect(sectionHeading.compareDocumentPosition(showcaseHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(showcaseHeading.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(intro.compareDocumentPosition(kitchen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kitchen.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(features.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(offer.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link).toHaveAttribute('href', '/acerca-de');
    expect(screen.getByText('Consultar esta información no modifica tu plan ni tu licencia.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the dynamic station manager for an Admin with the capability', () => {
    setScenario({ dynamic: true, canManage: true });

    renderSettings();

    expect(screen.getByRole('button', { name: /Actualizar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar area/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nombre de Cocina' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /Conocer Lanzo Nube/ })).not.toBeInTheDocument();
  });

  it('keeps a Staff actor in the dynamic read-only view and hides plan discovery', () => {
    setScenario({ dynamic: true, canManage: false, isAdmin: false });

    renderSettings();

    expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nombre de Cocina' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Conocer Lanzo Nube/ })).not.toBeInTheDocument();
  });

  it('does not show plan discovery to Staff when the dynamic station capability is unavailable', () => {
    setScenario({ dynamic: false, isAdmin: false });

    renderSettings();

    expect(screen.getByText('Cocina')).toBeInTheDocument();
    expect(screen.getByText('Tu estación actual · Disponible')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Conocer Lanzo Nube/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
