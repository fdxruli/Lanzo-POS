// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationalSettings from '../OperationalSettings.jsx';
import { CASH_OPENING_POLICY } from '../../../services/cashOpeningPolicyService.js';

const mocks = vi.hoisted(() => ({
  appState: null,
  setShowTicker: vi.fn(),
  setShowAssistantBot: vi.fn(),
  setEnableMultipleOrders: vi.fn(),
  setCashOpeningPolicy: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(mocks.appState))
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

const createAppState = (overrides = {}) => ({
  showTicker: true,
  setShowTicker: mocks.setShowTicker,
  showAssistantBot: false,
  setShowAssistantBot: mocks.setShowAssistantBot,
  enableMultipleOrders: false,
  setEnableMultipleOrders: mocks.setEnableMultipleOrders,
  cashOpeningPolicy: CASH_OPENING_POLICY.MANUAL,
  setCashOpeningPolicy: mocks.setCashOpeningPolicy,
  licenseDetails: localLicense(),
  ...overrides
});

afterEach(() => {
  cleanup();
});

describe('OperationalSettings ticker safety-net copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appState = createAppState();
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
    mocks.appState = createAppState({ showTicker: false });

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Oculto: la cinta superior se oculta; las alertas de inventario siguen disponibles en la campana.'
    )).toBeInTheDocument();
  });

  it('Pro/Nube ON uses summary semantics and preserves the cloud Notification Center', () => {
    mocks.appState = createAppState({ licenseDetails: cloudLicense() });

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Muestra la cinta superior con un resumen de avisos importantes de Lanzo Nube.'
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Activo: la cinta muestra un resumen; las notificaciones completas siguen en el Centro de Notificaciones.'
    )).toBeInTheDocument();
  });

  it('Pro/Nube OFF says only the ticker is hidden while the Notification Center remains', () => {
    mocks.appState = createAppState({
      showTicker: false,
      licenseDetails: cloudLicense()
    });

    render(<OperationalSettings />);

    expect(screen.getByText(
      'Oculto: la cinta superior se oculta; las notificaciones siguen disponibles en el Centro de Notificaciones.'
    )).toBeInTheDocument();
  });

  it('the ticker switch only writes showTicker and leaves notification capabilities untouched', () => {
    const capabilitiesBefore = JSON.stringify(mocks.appState.licenseDetails.features);

    render(<OperationalSettings />);
    fireEvent.click(screen.getByLabelText('Activar ticker de alertas'));

    expect(mocks.setShowTicker).toHaveBeenCalledTimes(1);
    expect(mocks.setShowTicker).toHaveBeenCalledWith(false);
    expect(mocks.setShowAssistantBot).not.toHaveBeenCalled();
    expect(mocks.setEnableMultipleOrders).not.toHaveBeenCalled();
    expect(mocks.setCashOpeningPolicy).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.appState.licenseDetails.features)).toBe(capabilitiesBefore);
  });
});
