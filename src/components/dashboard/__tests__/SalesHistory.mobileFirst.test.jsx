// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/db/sales', () => ({
  salesRepository: { getSalesByIds: vi.fn(async () => []) }
}));
vi.mock('../../../services/reports/reportSourceBadges', () => ({
  REPORT_SOURCE_MODES: { LOCAL: 'local', CLOUD_FINAL: 'cloud_final' },
  getReportSourceLabel: () => 'Local'
}));
vi.mock('../../../services/reports/salesHistoryExport', () => ({
  buildSalesHistoryCsv: vi.fn(() => ''),
  buildSalesHistoryPrintHtml: vi.fn(() => ''),
  dedupeSalesByStableId: (sales) => sales,
  formatSalesHistoryDateRange: () => 'Período consultado',
  getSaleInitialFinancialAmounts: () => ({ paidInitially: null, initialCredit: null }),
  getSalePaymentStatusCategory: () => 'paid',
  getSalePaymentStatusLabel: () => 'Pagada'
}));
vi.mock('../../../services/sales/saleReference', () => ({
  getSaleDisplayReference: (sale) => sale.folio || sale.id,
  getSaleSecondaryReference: () => '',
  isEcommerceSale: () => false,
  saleMatchesReference: () => false
}));
vi.mock('../../../utils/formatCurrencyMXN', () => ({
  formatCurrencyMXN: (amount) => '$' + Number(amount || 0).toFixed(2)
}));

import SalesHistory from '../SalesHistory';

const sampleSales = [
  {
    id: 'venta-1',
    folio: 'V-184',
    timestamp: '2026-11-08T12:00:00Z',
    total: 350,
    status: 'completed',
    paymentMethod: 'Efectivo',
    items: [{ id: 'line-1', name: 'Leche', quantity: 1, cost: 20 }]
  }
];

afterEach(cleanup);

describe('Historial de ventas mobile-first', () => {
  it('muestra folio y total y conserva el detalle dentro de una fila desplegable', () => {
    const { container } = render(<SalesHistory sales={sampleSales} />);
    expect(screen.getByText('V-184')).toBeVisible();
    expect(screen.getByText('$350.00')).toBeVisible();

    const row = container.querySelector('details.sale-item');
    expect(row).not.toBeNull();
    expect(row).not.toHaveAttribute('open');
    fireEvent.click(row.querySelector('summary'));
    expect(row).toHaveAttribute('open');
    expect(screen.getByText(/1x Leche/)).toBeInTheDocument();
  });

  it('oculta inicialmente los filtros secundarios pero permite utilizarlos', () => {
    render(<SalesHistory sales={sampleSales} />);
    expect(screen.queryByLabelText('Fecha inicial')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Más filtros/ }));
    expect(screen.getByLabelText('Fecha inicial')).toBeVisible();
    expect(screen.getByLabelText('Fecha final')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Filtrar por estado de pago' })).toBeVisible();
  });
});
