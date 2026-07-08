import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationalSettings from '../OperationalSettings.jsx';
import { CASH_OPENING_POLICY } from '../../../services/cashOpeningPolicyService.js';

const setCashOpeningPolicy = vi.fn();

const appState = {
  showTicker: false,
  setShowTicker: vi.fn(),
  showAssistantBot: false,
  setShowAssistantBot: vi.fn(),
  enableMultipleOrders: false,
  setEnableMultipleOrders: vi.fn(),
  cashOpeningPolicy: CASH_OPENING_POLICY.MANUAL,
  setCashOpeningPolicy,
  licenseDetails: {
    features: {}
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

describe('OperationalSettings cash opening control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.cashOpeningPolicy = CASH_OPENING_POLICY.MANUAL;
    appState.licenseDetails = { features: {} };
  });

  it('disables automatic cash opening for cloud cash licenses', () => {
    appState.cashOpeningPolicy = CASH_OPENING_POLICY.AUTOMATIC;
    appState.licenseDetails = {
      features: {
        cloud_pos_sync: true,
        cloud_cash_sync: true
      }
    };

    render(<OperationalSettings />);

    expect(screen.queryByText('No disponible en PRO: la caja cloud requiere confirmación de apertura por auditoría.')).not.toBeNull();
    const switchInput = screen.getByLabelText('Permitir autoapertura de caja');
    expect(switchInput.disabled).toBe(true);
    expect(switchInput.checked).toBe(false);

    fireEvent.click(switchInput);
    expect(setCashOpeningPolicy).not.toHaveBeenCalled();
  });

  it('warns FREE/local users when automatic cash opening is enabled', () => {
    appState.cashOpeningPolicy = CASH_OPENING_POLICY.AUTOMATIC;

    render(<OperationalSettings />);

    expect(screen.queryByText('Automática: puede heredar el fondo del cierre anterior. Verifica que el efectivo físico exista.')).not.toBeNull();
    expect(screen.queryByText(/Atención: si el cierre anterior dejó fondo para el siguiente turno/)).not.toBeNull();
    expect(screen.getByLabelText('Permitir autoapertura de caja').checked).toBe(true);
  });
});
