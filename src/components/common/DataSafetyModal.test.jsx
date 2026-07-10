import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    render(<DataSafetyModal />);

    expect(await screen.findByText(/advertencia cr.tica/i)).not.toBeNull();
  });

  it('does not show the warning for a PRO license', async () => {
    appState.licenseDetails = {
      plan_code: 'pro',
      features: { cloud_pos_sync: true }
    };

    render(<DataSafetyModal />);

    await waitFor(() => {
      expect(screen.queryByText(/advertencia cr.tica/i)).toBeNull();
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

    render(<DataSafetyModal />);

    await waitFor(() => {
      expect(screen.queryByText(/advertencia cr.tica/i)).toBeNull();
    });
  });
});
