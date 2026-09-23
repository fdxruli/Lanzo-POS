// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  app: {
    licenseDetails: {
      license_id: 'license-local',
      features: {
        local_inventory_alerts: true,
        notification_center: false,
        cloud_notifications: false
      }
    },
    showTicker: false,
    showAssistantBot: false
  }
}));

const runtimeMocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => ({ status: 'ready' })),
  reset: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
}));

vi.mock('../../../services/notifications/notificationCapabilities', () => ({
  shouldUseLocalInventoryOperationalBell: vi.fn((licenseDetails) => (
    licenseDetails?.features?.local_inventory_alerts === true
    && licenseDetails?.features?.notification_center === false
    && licenseDetails?.features?.cloud_notifications === false
  ))
}));

vi.mock('../../../services/localInventoryOperationalAlerts', () => ({
  refreshLocalInventoryOperationalAlertsSnapshot: runtimeMocks.refresh,
  resetLocalInventoryOperationalAlertsRuntime: runtimeMocks.reset
}));

vi.mock('../../../services/tickerAlerts', () => ({
  TICKER_ALERT_POLL_INTERVAL_MS: 5 * 60 * 1000
}));

import { TICKER_INVENTORY_ALERT_EVENT } from '../../../services/tickerAlertEvents';
import LocalInventoryOperationalAlertsRuntime from '../LocalInventoryOperationalAlertsRuntime';

describe('LocalInventoryOperationalAlertsRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    state.app = {
      licenseDetails: {
        license_id: 'license-local',
        features: {
          local_inventory_alerts: true,
          notification_center: false,
          cloud_notifications: false
        }
      },
      showTicker: false,
      showAssistantBot: false
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('refreshes independently of ticker and AssistantBot visibility', async () => {
    render(<LocalInventoryOperationalAlertsRuntime />);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(runtimeMocks.refresh).toHaveBeenCalledTimes(1);
    expect(state.app.showTicker).toBe(false);
    expect(state.app.showAssistantBot).toBe(false);
  });

  it('reuses the existing inventory event for refresh', async () => {
    render(<LocalInventoryOperationalAlertsRuntime />);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    runtimeMocks.refresh.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(TICKER_INVENTORY_ALERT_EVENT));
    });

    expect(runtimeMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when returning to foreground', async () => {
    render(<LocalInventoryOperationalAlertsRuntime />);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    runtimeMocks.refresh.mockClear();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(runtimeMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not run for a cloud notification plan', async () => {
    state.app.licenseDetails = {
      license_id: 'license-cloud',
      features: {
        local_inventory_alerts: true,
        notification_center: true,
        cloud_notifications: true
      }
    };

    render(<LocalInventoryOperationalAlertsRuntime />);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(runtimeMocks.refresh).not.toHaveBeenCalled();
    expect(runtimeMocks.reset).toHaveBeenCalled();
  });
});
