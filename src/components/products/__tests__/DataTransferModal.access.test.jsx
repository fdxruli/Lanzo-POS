// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsActionGuard: () => () => ({ assertCurrent: vi.fn() })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    companyProfile: { business_type: ['farmacia'] }
  }))
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasLabFields: true })
}));

vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: () => vi.fn()
}));

vi.mock('../../../services/dataTransfer', () => ({
  downloadInventorySmart: vi.fn(),
  processImport: vi.fn(),
  downloadFile: vi.fn(),
  generatePharmacyReport: vi.fn(),
  downloadTemplate: vi.fn()
}));

vi.mock('../../../services/database', () => ({
  loadData: vi.fn(),
  STORES: { SALES: 'sales' }
}));

vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: vi.fn()
}));

import DataTransferModal from '../DataTransferModal';

describe('DataTransferModal sales presentation isolation', () => {
  afterEach(cleanup);

  it('does not expose the pharmacy sales export without reports authority', () => {
    render(
      <DataTransferModal
        show
        allowInventory
        allowSalesExport={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Descargar Inventario Completo/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Libro de Control/i })).not.toBeInTheDocument();
  });

  it('shows the pharmacy sales export only when its combined authority is supplied', () => {
    render(
      <DataTransferModal
        show
        allowInventory
        allowSalesExport
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Libro de Control/i })).toBeInTheDocument();
  });
});
