// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('../../../services/restaurant/preparationStationsRepository', () => ({
  get FALLBACK_PREPARATION_STATIONS() { return [kitchen]; }
}));

import PreparationStationsSettings from '../PreparationStationsSettings';

const freeLicense = {
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
};

const kitchen = {
  id: 'station_kitchen',
  code: 'kitchen',
  name: 'Cocina',
  isDefault: true,
  isActive: true,
  serverVersion: 1
};

const bar = {
  id: 'station_bar',
  code: 'bar',
  name: 'Barra',
  isActive: false,
  serverVersion: 3
};

function setScenario({ dynamic = false, canManage = true, isAdmin = true } = {}) {
  state.licenseDetails = dynamic
    ? { ...freeLicense, plan_code: 'pro', features: { ...freeLicense.features, preparation_stations: true } }
    : freeLicense;
  state.settingsAccess = {
    actorKey: 'actor-1',
    generation: 1,
    isAuthorizedActor: true,
    isAdmin,
    canAccessSection: () => isAdmin
  };
  state.stationSettings = {
    stations: dynamic ? [kitchen, bar] : [kitchen],
    isLoading: false,
    error: null,
    source: dynamic ? 'cloud' : 'fallback',
    canManageStations: dynamic && canManage,
    isDynamicStationsEnabled: dynamic,
    refreshStations: vi.fn().mockResolvedValue({ success: true }),
    createStation: vi.fn().mockResolvedValue({ success: true }),
    updateStation: vi.fn().mockResolvedValue({ success: true }),
    toggleStation: vi.fn().mockResolvedValue({ success: true })
  };
}

function renderSettings() {
  const view = () => <MemoryRouter><PreparationStationsSettings /></MemoryRouter>;
  const { rerender } = render(view());
  return () => rerender(view());
}

const nameInput = () => screen.getByRole('textbox', { name: 'Nombre del área' });

describe('PreparationStationsSettings', () => {
  beforeEach(() => {
    // jsdom exposes the element but does not implement its modal methods.
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  });

  afterEach(() => {
    cleanup();
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.close;
  });

  it('shows only the default row and the compact discovery link for a Local admin', () => {
    setScenario();
    // A capability transition can leave Cloud data in the hook until the next read.
    state.stationSettings.stations = [kitchen, bar];
    renderSettings();

    expect(screen.getByRole('heading', { name: 'Áreas de preparación' })).toBeInTheDocument();
    expect(screen.getByText('Cocina')).toBeInTheDocument();
    expect(screen.getByText('Predeterminada · Siempre activa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Más áreas con Lanzo Nube' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conocer Lanzo Nube' })).toHaveAttribute('href', '/acerca-de');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('hides Local discovery from Staff', () => {
    setScenario({ isAdmin: false });
    renderSettings();

    expect(screen.getByText('Cocina')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Conocer Lanzo Nube' })).not.toBeInTheDocument();
  });

  it('shows counts, refreshes on demand and marks cached and fallback data', async () => {
    setScenario({ dynamic: true });
    const rerender = renderSettings();
    const user = userEvent.setup();

    expect(screen.getByText('2 áreas · 1 activa')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actualizar áreas de preparación' }));
    expect(state.stationSettings.refreshStations).toHaveBeenCalledWith({ force: true });

    Object.assign(state.stationSettings, { source: 'cache', error: 'Sin conexión.' });
    rerender();
    expect(screen.getByText('2 áreas · 1 activa · Copia local')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión.');

    Object.assign(state.stationSettings, { source: 'fallback', stations: [kitchen] });
    rerender();
    expect(screen.getByText('Mostrando el área predeterminada')).toBeInTheDocument();
    expect(screen.queryByText('1 área · 1 activa')).not.toBeInTheDocument();
  });

  it('creates an area once while pending and restores focus after confirmed success', async () => {
    setScenario({ dynamic: true });
    let resolveSave;
    state.stationSettings.createStation.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    renderSettings();
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Nueva área' });

    await user.click(opener);
    expect(nameInput()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Crear área' })).toBeDisabled();
    await user.type(nameInput(), '  Bebidas  ');
    await user.click(screen.getByRole('button', { name: 'Crear área' }));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form'));
    expect(state.stationSettings.createStation).toHaveBeenCalledExactlyOnceWith({ name: 'Bebidas' });
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();

    await act(async () => resolveSave({ success: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Área creada.')).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not expose a switch for Cocina and allows its existing rename operation', async () => {
    setScenario({ dynamic: true });
    renderSettings();
    const user = userEvent.setup();

    expect(screen.queryByRole('switch', { name: /Cocina/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar Cocina' }));
    expect(nameInput()).toHaveValue('Cocina');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Cocina principal');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(state.stationSettings.updateStation).toHaveBeenCalledExactlyOnceWith(kitchen, { name: 'Cocina principal' });
  });

  it('restores focus when the native dialog is cancelled', async () => {
    setScenario({ dynamic: true });
    renderSettings();
    const opener = screen.getByRole('button', { name: 'Editar Barra' });

    await userEvent.setup().click(opener);
    expect(nameInput()).toHaveFocus();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('uses confirmed hook data for switches and prevents duplicate activation', async () => {
    setScenario({ dynamic: true });
    let resolveToggle;
    state.stationSettings.toggleStation.mockImplementation(() => new Promise((resolve) => { resolveToggle = resolve; }));
    const rerender = renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Activación de Barra' });

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(state.stationSettings.toggleStation).toHaveBeenCalledExactlyOnceWith(bar, true);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      state.stationSettings.stations = [kitchen, { ...bar, isActive: true }];
      resolveToggle({ success: true });
    });
    rerender();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Área activada.')).toBeInTheDocument();
  });

  it('keeps the draft after rejected responses and exceptions', async () => {
    setScenario({ dynamic: true });
    state.stationSettings.createStation
      .mockResolvedValueOnce({ success: false, code: 'DUPLICATE_PREPARATION_STATION', message: 'El área ya existe.' })
      .mockRejectedValueOnce(new Error('Sin conexión.'));
    renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Nueva área' }));
    await user.type(nameInput(), 'Bebidas');
    await user.click(screen.getByRole('button', { name: 'Crear área' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El área ya existe.');
    expect(nameInput()).toHaveValue('Bebidas');

    await user.click(screen.getByRole('button', { name: 'Crear área' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión.');
    expect(nameInput()).toHaveValue('Bebidas');
    expect(screen.queryByText('Área creada.')).not.toBeInTheDocument();
  });

  it('requires reviewing the refreshed version before retrying a VERSION_CONFLICT', async () => {
    setScenario({ dynamic: true });
    const currentBar = { ...bar, name: 'Barra central', serverVersion: 4 };
    state.stationSettings.updateStation.mockResolvedValueOnce({
      success: false,
      code: 'VERSION_CONFLICT',
      station: currentBar
    });
    const rerender = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Editar Barra' }));
    state.stationSettings.stations = [kitchen, currentBar];
    rerender();
    await user.clear(nameInput());
    await user.type(nameInput(), 'Bebidas');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(state.stationSettings.updateStation).toHaveBeenNthCalledWith(1, bar, { name: 'Bebidas' });
    expect(screen.getByRole('alert')).toHaveTextContent('El área cambió en otro dispositivo.');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(nameInput()).toHaveValue('Bebidas');

    await user.click(screen.getByRole('button', { name: 'Usar versión actual' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(state.stationSettings.updateStation).toHaveBeenNthCalledWith(2, currentBar, { name: 'Bebidas' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('discards the editor on revocation and hides write actions from read-only Staff', async () => {
    setScenario({ dynamic: true, isAdmin: false });
    const rerender = renderSettings();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Editar Barra' }));
    state.stationSettings.canManageStations = false;
    rerender();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Áreas de preparación' })).toHaveFocus();
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
    expect(screen.getByText('Barra')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva área' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(state.stationSettings.updateStation).not.toHaveBeenCalled();
  });
});
