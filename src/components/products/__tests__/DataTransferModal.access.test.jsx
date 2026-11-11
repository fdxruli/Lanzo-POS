// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(), assertCurrent: vi.fn(), loadData: vi.fn(),
  buildReport: vi.fn(), download: vi.fn(), showMessage: vi.fn()
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsActionGuard: () => mocks.capture
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn(selector => selector({ companyProfile: { business_type: ['farmacia'] } }))
}));
vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasLabFields: true })
}));
vi.mock('../../../hooks/useDismissibleHistoryLayer', () => ({
  useDismissibleHistoryLayer: () => vi.fn()
}));
vi.mock('../../../services/dataTransfer', () => ({
  downloadInventorySmart: vi.fn(), processImport: vi.fn(), previewProductCsvImport: vi.fn(),
  downloadFile: mocks.download, buildPharmacyReport: mocks.buildReport, downloadTemplate: vi.fn()
}));
vi.mock('../../../services/database', () => ({
  loadData: mocks.loadData, STORES: { SALES: 'sales' }
}));
vi.mock('../../../services/utils', () => ({
  showConfirmModal: vi.fn(), showMessageModal: mocks.showMessage
}));

import DataTransferModal from '../DataTransferModal';

const mount = (allowSalesExport = true) => render(
  <DataTransferModal show allowInventory allowSalesExport={allowSalesExport}
    onClose={vi.fn()} onRefresh={vi.fn()} />
);
const clickReport = () => fireEvent.click(screen.getByRole('button', { name: /Reporte auxiliar de dispensaciones/i }));

describe('DataTransferModal: visibilidad y descarga autorizada de farmacia', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.capture.mockReturnValue({ assertCurrent: mocks.assertCurrent });
    mocks.loadData.mockResolvedValue([{ id: 'sal-1' }]);
    mocks.buildReport.mockReturnValue({ csv: 'archivo,seguro', count: 1, issueRows: 1 });
  });
  afterEach(cleanup);

  it('oculta el reporte cuando el contenedor no concede reportes', () => {
    mount(false);
    expect(screen.getByRole('button', { name: /Descargar Inventario Completo/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reporte auxiliar de dispensaciones/i })).not.toBeInTheDocument();
  });

  it('explica alcance local y descarga desde el botón de la app con guard sync+reports', async () => {
    mount();
    expect(screen.getByText(/No sustituye los libros de control sanitario autorizados/)).toBeInTheDocument();
    clickReport();
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.capture).toHaveBeenCalledWith('sync');
    expect(mocks.assertCurrent).toHaveBeenCalledWith('reports');
    expect(mocks.download.mock.calls[0][0]).toBe('archivo,seguro');
    expect(mocks.download.mock.calls[0][1]).toMatch(/^dispensaciones_farmacia_local_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('staff sin permisos: el guard deniega la acción y no lee ventas', async () => {
    mocks.capture.mockImplementation(() => { throw new Error('ACTOR_PERMISSION_DENIED'); });
    mount();
    clickReport();
    expect(mocks.loadData).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('revocación/cambio de actor durante carga: no se descarga el archivo', async () => {
    let resolveRead;
    mocks.loadData.mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
    mount();
    clickReport();
    await waitFor(() => expect(mocks.loadData).toHaveBeenCalledTimes(1));
    mocks.assertCurrent.mockImplementation(() => { throw new Error('CONTEXT_STALE'); });
    await act(async () => { resolveRead([{ id: 'sal-1' }]); await Promise.resolve(); });
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('lectura local válida vacía: no descarga y no confunde el dispositivo con todo el negocio', async () => {
    mocks.loadData.mockResolvedValue([]);
    mocks.buildReport.mockReturnValue({ csv: 'encabezados', count: 0, issueRows: 0 });
    mount();
    clickReport();
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalledTimes(1));
    expect(mocks.buildReport).toHaveBeenCalledOnce();
    expect(mocks.buildReport).toHaveBeenCalledWith([]);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.showMessage.mock.calls[0][0]).toMatch(/registros locales de este dispositivo/);
    expect(mocks.showMessage.mock.calls[0][0]).not.toMatch(/no fue posible leer/i);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['objeto', { rows: [] }],
    ['cadena', ''], ['número', 0]
  ])('lectura local inválida (%s): error explícito y cero exportación', async (_name, value) => {
    mocks.loadData.mockResolvedValue(value);
    mount();
    clickReport();
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalledTimes(1));
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.assertCurrent).toHaveBeenCalledWith('reports');
    expect(mocks.showMessage.mock.calls[0][0]).toMatch(/No fue posible leer las ventas almacenadas/);
    expect(mocks.showMessage.mock.calls[0][0]).not.toMatch(/No se encontraron dispensaciones/);
  });

  it('excepción durante la lectura: error controlado, sin detalles sensibles y sin descarga', async () => {
    mocks.loadData.mockRejectedValue(new Error('Doctor: DATO_SENSIBLE, IndexedDB falló'));
    mount();
    clickReport();
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalledTimes(1));
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.showMessage.mock.calls[0][0]).toMatch(/No fue posible leer o procesar las ventas/);
    expect(mocks.showMessage.mock.calls[0][0]).not.toMatch(/DATO_SENSIBLE|IndexedDB/);
  });

  it('ningún registro identificable: mensaje delimitado al dispositivo, sin CSV', async () => {
    mocks.buildReport.mockReturnValue({ csv: 'solo-encabezados', count: 0, issueRows: 0 });
    mount();
    clickReport();
    await waitFor(() => expect(mocks.showMessage).toHaveBeenCalled());
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.showMessage.mock.calls[0][0]).toMatch(/registros locales de este dispositivo/i);
  });
});
