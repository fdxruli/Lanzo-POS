// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationalSettings from '../OperationalSettings.jsx';
import { CASH_OPENING_POLICY } from '../../../services/cashOpeningPolicyService.js';

const setShowTicker = vi.fn();
const setShowAssistantBot = vi.fn();
const setEnableMultipleOrders = vi.fn();
const setCashOpeningPolicy = vi.fn();

const appState = {
  showTicker: true,
  setShowTicker,
  showAssistantBot: false,
  setShowAssistantBot,
  enableMultipleOrders: false,
  setEnableMultipleOrders,
  cashOpeningPolicy: CASH_OPENING_POLICY.MANUAL,
  setCashOpeningPolicy,
  licenseDetails: {
    features: {
      ticker_enabled: true,
      ticker_mode: 'local',
      local_inventory_alerts: true,
      notification_center: false,
      cloud_notifications: false
    }
  }
};

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(appState))
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: vi.fn((selector) => selector({ activeOrders: new Map() }))
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasTables: false })
}));

const localLicense = () => ({
  features: {
    ticker_enabled: true,
    ticker_mode: 'local',
    local_inventory_alerts: true,
    notification_center: false,
    cloud_notifications: false
  }
});

const cloudLicense = () => ({
  features: {
    ticker_enabled: true,
    ticker_mode: 'summary',
    local_inventory_alerts: true,
    notification_center: true,
    cloud_notifications: true
  }
});

describe('OperationalSettings ticker safety-net copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.showTicker = true;
    appState.licenseDetails = localLicense();
  });

  it('Free/local ON explains quick visibility while the bell remains the complete safety net', () => {
    render(<OperationalSettings />);

    expect(screen.getByText(
      'Muestra la cinta superior con avisos rápidos de inventario y otros mensajes operativos.'
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Activo: la cinta muestra avisos rápidos; las alertas de inventario completas siguen en la campana.'
    )).toBeInTheDocument();
  });

  it('Free/local OFF explains that hiding the ticker does not disable the inventory bell', () => {
    appState.showTicker = false;

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Oculto: la cinta superior se oculta; las alertas de inventario siguen disponibles en la campana.'
    )).toBeInTheDocument();
  });

  it('Pro/Nube ON uses summary semantics and preserves the cloud Notification Center', () => {
    appState.licenseDetails = cloudLicense();

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Muestra la cinta superior con un resumen de avisos importantes de Lanzo Nube.'
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Activo: la cinta muestra un resumen; las notificaciones completas siguen en el Centro de Notificaciones.'
    )).toBeInTheDocument();
  });

  it('Pro/Nube OFF says only the ticker is hidden while the Notification Center remains', () => {
    appState.showTicker = false;
    appState.licenseDetails = cloudLicense();

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Oculto: la cinta superior se oculta; las notificaciones siguen disponibles en el Centro de Notificaciones.'
    )).toBeInTheDocument();
  });

  it('the ticker switch only writes showTicker and leaves notification capabilities untouched', () => {
    const capabilitiesBefore = JSON.stringify(appState.licenseDetails.features);

    render(<OperationalSettings />);
    fireEvent.click(screen.getByLabelText('Activar ticker de alertas'));

    expect(setShowTicker).toHaveBeenCalledTimes(1);
    expect(setShowTicker).toHaveBeenCalledWith(false);
    expect(setShowAssistantBot).not.toHaveBeenCalled();
    expect(setEnableMultipleOrders).not.toHaveBeenCalled();
    expect(setCashOpeningPolicy).not.toHaveBeenCalled();
    expect(JSON.stringify(appState.licenseDetails.features)).toBe(capabilitiesBefore);
  });
});
