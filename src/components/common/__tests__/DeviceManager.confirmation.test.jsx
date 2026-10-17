// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchDevices: vi.fn(),
  releaseDevice: vi.fn(),
  confirm: vi.fn(),
  message: vi.fn(),
  logout: vi.fn(),
  captureSettingsAction: vi.fn(() => ({ assertCurrent: vi.fn() })),
  settingsAccess: {
    isAdmin: true,
    canAccessSection: (section) => section === 'devices'
  }
}));

vi.mock('../../../services/licenseService', () => ({
  getLicenseDevicesSmart: mocks.fetchDevices,
  deactivateDeviceSmart: mocks.releaseDevice
}));
vi.mock('../../../services/deviceModeService', () => ({ setDeviceModeSmart: vi.fn() }));
vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => mocks.settingsAccess,
  useSettingsActionGuard: () => mocks.captureSettingsAction
}));
vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.confirm,
  showMessageModal: mocks.message
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ logout: mocks.logout })
}));

import DeviceManager from '../DeviceManager';

const device = (overrides = {}) => ({
  device_id: 'device-current',
  device_name: 'Chrome en Android',
  device_mode: 'admin_only',
  device_role: 'admin',
  is_current_device: true,
  is_active: true,
  active_admin_sessions: 1,
  active_staff_sessions: 0,
  last_used_at: '2026-10-17T12:00:00Z',
  ...overrides
});

describe('DeviceManager release explanations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(false);
    mocks.logout.mockResolvedValue(undefined);
    mocks.fetchDevices.mockResolvedValue({
      success: true,
      source: 'network',
      data: [device()]
    });
  });
  afterEach(cleanup);

  it('warns about the last Admin and points to sign-out when releasing the current device', async () => {
    render(<DeviceManager licenseKey="test-license" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }));

    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const [message, options] = mocks.confirm.mock.calls[0];
    expect(message).toContain('dejará disponible su cupo');
    expect(message).toContain('último dispositivo con acceso Admin');
    expect(message).toContain('no se transfieren automáticamente');
    expect(message).toContain('«Cerrar sesión Admin»');
    expect(message).toContain('Pulsa Cancelar');
    expect(options.confirmButtonText).toBe('Sí, liberar');
    expect(mocks.releaseDevice).not.toHaveBeenCalled();
  });

  it('explains how to close a remote session without releasing its slot', async () => {
    mocks.fetchDevices.mockResolvedValue({
      success: true,
      source: 'network',
      data: [
        device(),
        device({
          device_id: 'device-other',
          device_name: 'Edge en Windows',
          device_mode: 'staff_only',
          device_role: 'staff',
          is_current_device: false
        })
      ]
    });
    render(<DeviceManager licenseKey="test-license" />);

    const releaseButtons = await screen.findAllByRole('button', { name: 'Liberar' });
    fireEvent.click(releaseButtons[1]);
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));

    const [message] = mocks.confirm.mock.calls[0];
    expect(message).toContain('Edge en Windows');
    expect(message).toContain('Las sesiones del dispositivo que liberes dejarán de ser válidas');
    expect(message).toContain('usa «Cerrar sesión» desde ese equipo');
    expect(message).not.toContain('último dispositivo con acceso Admin');
    expect(mocks.releaseDevice).not.toHaveBeenCalled();
  });

  it('still releases the current device and signs out when confirmed', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.releaseDevice.mockResolvedValue({ success: true, released_current_device: true });
    render(<DeviceManager licenseKey="test-license" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }));

    await vi.waitFor(() => expect(mocks.releaseDevice).toHaveBeenCalledWith('device-current', 'test-license'));
    await vi.waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
  });
});
