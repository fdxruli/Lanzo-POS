// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLicenseDevicesSmart: vi.fn(),
  deactivateDeviceSmart: vi.fn(),
  setDeviceModeSmart: vi.fn(),
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn(),
  logout: vi.fn(),
  captureSettingsAction: vi.fn(),
  assertCurrent: vi.fn(),
  access: null
}));

vi.mock('../../../services/licenseService', () => ({
  getLicenseDevicesSmart: mocks.getLicenseDevicesSmart,
  deactivateDeviceSmart: mocks.deactivateDeviceSmart
}));

vi.mock('../../../services/deviceModeService', () => ({
  setDeviceModeSmart: mocks.setDeviceModeSmart
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: mocks.showConfirmModal,
  showMessageModal: mocks.showMessageModal
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ logout: mocks.logout })
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => mocks.access,
  useSettingsActionGuard: () => mocks.captureSettingsAction
}));

import DeviceManager from '../DeviceManager';

const makeDevice = (id, name, overrides = {}) => ({
  device_id: id,
  device_name: name,
  device_mode: 'shared',
  device_role: 'admin',
  is_active: true,
  is_current_device: false,
  last_used_at: '2026-08-27T00:00:00.000Z',
  active_admin_sessions: 1,
  active_staff_sessions: 0,
  ...overrides
});

const renderManager = async (devices, source = 'network') => {
  mocks.getLicenseDevicesSmart.mockResolvedValue({
    success: true,
    data: devices,
    source
  });

  render(<DeviceManager licenseKey="LIC-1" />);
  await screen.findByText(devices[0].device_name);
};

const rowFor = (name) => screen.getByText(name).closest('li');

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
};

describe('DeviceManager administrative controls', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    mocks.access = {
      isAdmin: true,
      canAccessSection: (section) => section === 'devices'
    };
    mocks.captureSettingsAction.mockReturnValue({
      assertCurrent: mocks.assertCurrent
    });
    mocks.getLicenseDevicesSmart.mockResolvedValue({
      success: true,
      data: [],
      source: 'network'
    });
    mocks.showConfirmModal.mockResolvedValue(true);
    mocks.deactivateDeviceSmart.mockResolvedValue({
      success: true,
      released_current_device: false
    });
    mocks.setDeviceModeSmart.mockResolvedValue({
      success: true,
      device_mode: 'shared',
      requester_session_revoked: false
    });
    mocks.logout.mockResolvedValue(undefined);
  });

  it('releases a remote device once, refreshes once, and keeps the requester logged in', async () => {
    await renderManager([
      makeDevice('device-a', 'Device A', { is_current_device: true }),
      makeDevice('device-b', 'Device B', { device_mode: 'staff_only' })
    ]);

    fireEvent.click(within(rowFor('Device B')).getByRole('button', { name: 'Liberar' }));

    await waitFor(() => expect(mocks.deactivateDeviceSmart).toHaveBeenCalledTimes(1));
    expect(mocks.deactivateDeviceSmart).toHaveBeenCalledWith('device-b', 'LIC-1');
    await waitFor(() => expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(2));
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('releases the current device and logs out only after the service succeeds', async () => {
    mocks.deactivateDeviceSmart.mockResolvedValue({
      success: true,
      released_current_device: true
    });
    await renderManager([makeDevice('device-a', 'Device A', { is_current_device: true })]);

    fireEvent.click(within(rowFor('Device A')).getByRole('button', { name: 'Liberar' }));

    await waitFor(() => expect(mocks.deactivateDeviceSmart).toHaveBeenCalledWith('device-a', 'LIC-1'));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(1);
  });

  it('keeps the target visible and avoids logout when release fails', async () => {
    mocks.deactivateDeviceSmart.mockResolvedValue({
      success: false,
      message: 'ADMIN_SESSION_INVALID'
    });
    await renderManager([
      makeDevice('device-a', 'Device A', { is_current_device: true }),
      makeDevice('device-b', 'Device B')
    ]);

    fireEvent.click(within(rowFor('Device B')).getByRole('button', { name: 'Liberar' }));

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Error: ADMIN_SESSION_INVALID',
      null,
      { type: 'error' }
    ));
    expect(screen.getByText('Device B')).toBeInTheDocument();
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(1);
  });

  it('blocks remote release offline without calling the service', async () => {
    await renderManager([
      makeDevice('device-a', 'Device A', { is_current_device: true }),
      makeDevice('device-b', 'Device B')
    ]);
    setOnline(false);

    fireEvent.click(within(rowFor('Device B')).getByRole('button', { name: 'Liberar' }));

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'Se requiere internet para liberar un dispositivo.',
      null,
      { type: 'error' }
    ));
    expect(mocks.deactivateDeviceSmart).not.toHaveBeenCalled();
  });

  it.each([
    ['admin_only', 'shared'],
    ['staff_only', 'shared'],
    ['shared', 'admin_only']
  ])('sends canonical remote mode %s exactly once', async (nextMode, currentMode) => {
    await renderManager([
      makeDevice('device-a', 'Device A', { is_current_device: true }),
      makeDevice('device-b', 'Device B', { device_mode: currentMode })
    ]);
    const select = within(rowFor('Device B')).getByRole('combobox');

    fireEvent.change(select, { target: { value: nextMode } });

    await waitFor(() => expect(mocks.setDeviceModeSmart).toHaveBeenCalledTimes(1));
    expect(mocks.setDeviceModeSmart).toHaveBeenCalledWith('device-b', nextMode, 'LIC-1');
    await waitFor(() => expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(2));
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('logs out when the current device changes to staff_only and the server revokes the requester session', async () => {
    mocks.setDeviceModeSmart.mockResolvedValue({
      success: true,
      device_mode: 'staff_only',
      requester_session_revoked: true
    });
    await renderManager([makeDevice('device-a', 'Device A', { is_current_device: true })]);

    fireEvent.change(
      within(rowFor('Device A')).getByRole('combobox'),
      { target: { value: 'staff_only' } }
    );

    await waitFor(() => expect(mocks.setDeviceModeSmart).toHaveBeenCalledWith(
      'device-a',
      'staff_only',
      'LIC-1'
    ));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(1);
  });

  it.each(['admin_only', 'shared'])('does not logout for current-device mode %s without revocation', async (nextMode) => {
    const currentMode = nextMode === 'admin_only' ? 'shared' : 'admin_only';
    await renderManager([makeDevice('device-a', 'Device A', {
      is_current_device: true,
      device_mode: currentMode
    })]);

    fireEvent.change(
      within(rowFor('Device A')).getByRole('combobox'),
      { target: { value: nextMode } }
    );

    await waitFor(() => expect(mocks.setDeviceModeSmart).toHaveBeenCalledWith(
      'device-a',
      nextMode,
      'LIC-1'
    ));
    await waitFor(() => expect(mocks.getLicenseDevicesSmart).toHaveBeenCalledTimes(2));
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('restores the canonical mode and does not logout on mode failure', async () => {
    mocks.setDeviceModeSmart.mockResolvedValue({
      success: false,
      message: 'DEVICE_MODE_INVALID'
    });
    await renderManager([makeDevice('device-a', 'Device A', {
      is_current_device: true,
      device_mode: 'shared'
    })]);
    const select = within(rowFor('Device A')).getByRole('combobox');

    fireEvent.change(select, { target: { value: 'staff_only' } });

    await waitFor(() => expect(mocks.showMessageModal).toHaveBeenCalledWith(
      'DEVICE_MODE_INVALID',
      null,
      { type: 'error' }
    ));
    expect(select.value).toBe('shared');
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('disables mode changes and release while cached offline data is shown', async () => {
    await renderManager([makeDevice('device-a', 'Device A', { is_current_device: true })], 'cache');
    const row = rowFor('Device A');

    expect(within(row).getByRole('combobox')).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Liberar' })).toBeDisabled();
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'staff_only' } });
    expect(mocks.setDeviceModeSmart).not.toHaveBeenCalled();
  });

  it('serializes rapid mode actions before the async confirmation resolves', async () => {
    let resolveConfirmation;
    mocks.showConfirmModal.mockReturnValue(new Promise((resolve) => {
      resolveConfirmation = resolve;
    }));
    await renderManager([makeDevice('device-a', 'Device A', {
      is_current_device: true,
      device_mode: 'shared'
    })]);
    const select = within(rowFor('Device A')).getByRole('combobox');

    fireEvent.change(select, { target: { value: 'staff_only' } });
    fireEvent.change(select, { target: { value: 'admin_only' } });
    resolveConfirmation(true);

    await waitFor(() => expect(mocks.setDeviceModeSmart).toHaveBeenCalledTimes(1));
    expect(mocks.setDeviceModeSmart).toHaveBeenCalledWith('device-a', 'staff_only', 'LIC-1');
  });

  it('does not expose Admin mutation controls to Staff', async () => {
    mocks.access = {
      isAdmin: false,
      canAccessSection: (section) => section === 'devices'
    };

    render(<DeviceManager licenseKey="LIC-1" />);

    expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
