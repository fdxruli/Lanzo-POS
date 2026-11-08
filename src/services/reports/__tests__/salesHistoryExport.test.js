import { describe, expect, it } from 'vitest';
import {
  buildSalesHistoryCsv,
  buildSalesHistoryPrintHtml,
  dedupeSalesByStableId,
  getSaleInitialFinancialAmounts,
  getSalePaymentStatusCategory,
  getSalePaymentStatusLabel
} from '../salesHistoryExport';

describe('sales history export helpers', () => {
  it.each([
    [{ status: 'closed', payment_status: 'paid', payment_method: 'cash' }, 'paid', 'Pagada'],
    [{ status: 'closed', payment_status: 'credit_pending', payment_method: 'cash' }, 'credit', 'Fiada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'mixed', amount_paid: 10 }, 'mixed_credit', 'Pago mixto con crédito'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'cash', amount_paid: 0 }, 'credit', 'Fiada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'mixed' }, 'partial', 'Parcialmente pagada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'cash' }, 'partial', 'Parcialmente pagada'],
    [{ status: 'cancelled', payment_status: 'paid', payment_method: 'cash' }, 'cancelled', 'Cancelada'],
    [{ status: 'closed', payment_method: 'cash' }, 'unknown', 'Estado desconocido']
  ])('maps payment status independently from method: %j', (sale, category, label) => {
    expect(getSalePaymentStatusCategory(sale)).toBe(category);
    expect(getSalePaymentStatusLabel(sale)).toBe(label);
  });

  it('reports recorded initial amounts without deriving current debt from the sale total', () => {
    expect(getSaleInitialFinancialAmounts({
      source_mode: 'cloud_committed',
      total: 30,
      amount_paid: 10,
      original_balance_due: 20,
      balance_due: 4,
      current_balance_due: 4
    })).toEqual({ paidInitially: 10, initialCredit: 20 });

    expect(getSaleInitialFinancialAmounts({
      source_mode: 'cloud_committed',
      balance_due: 20,
      current_balance_due: 4
    })).toEqual({ paidInitially: null, initialCredit: null });

    expect(getSaleInitialFinancialAmounts({
      total: 20,
      payment_method: 'credit',
      saldoPendiente: 20
    })).toEqual({ paidInitially: null, initialCredit: null });
  });

  it('writes one row per stable sale ID and records the actual page, scope, filters and source', () => {
    const rows = [
      { id: 'sale-a', folio: 'F-001', total: 20, status: 'closed', payment_status: 'credit_pending', customer_name: '=2+2' },
      { id: 'sale-a', folio: 'F-001', total: 20, status: 'closed', payment_status: 'credit_pending', customer_name: '=2+2' }
    ];
    const csv = buildSalesHistoryCsv(rows, {
      pageIndex: 1,
      pageLoadedCount: 50,
      totalCount: 60,
      activeFilters: ['Pago: Fiada'],
      scopeLabel: 'Mis ventas, según permisos actuales',
      sourceLabel: 'Cloud oficial final',
      coverageLabel: 'Solo página 2: 1 de 50 registro(s) cargado(s) tras los filtros locales'
    });

    expect(dedupeSalesByStableId(rows)).toHaveLength(1);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain('Mis ventas, según permisos actuales');
    expect(csv).toContain('Cloud oficial final');
    expect(csv).toContain('Solo página 2: 1 de 50');
    expect(csv).toContain('"total_disponible_en_consulta"');
    expect(csv).toContain(',"60"');
    expect(csv.match(/"sale-a"/g)).toHaveLength(1);
  });

  it('exports exactly the filtered rows from a 50-row page of a larger authorized history', () => {
    const page = Array.from({ length: 50 }, (_, index) => ({
      id: `sale-${index + 1}`,
      folio: `F-${index + 1}`,
      status: 'closed',
      payment_status: index % 2 === 0 ? 'paid' : 'credit_pending',
      payment_method: index % 2 === 0 ? 'cash' : 'credit',
      total: 20
    }));
    const filteredPage = page.filter((sale) => sale.payment_status === 'paid');
    const csv = buildSalesHistoryCsv(filteredPage, {
      pageIndex: 0,
      pageLoadedCount: page.length,
      totalCount: 60,
      exportedCount: filteredPage.length,
      activeFilters: ['Pago: Pagada'],
      scopeLabel: 'Mis ventas, según permisos actuales',
      sourceLabel: 'Cloud oficial final',
      coverageLabel: 'Solo página 1: 25 de 50 registro(s) cargado(s) tras los filtros locales'
    });

    const exportedIds = csv.match(/"sale-\d+"/g) || [];
    expect(exportedIds).toHaveLength(25);
    expect(new Set(exportedIds).size).toBe(25);
    expect(exportedIds).toEqual(filteredPage.map((sale) => `"${sale.id}"`));
    expect(csv).not.toContain('"sale-51"');
    expect(csv).toContain('"60"');
    expect(csv).toContain('Solo página 1: 25 de 50');
  });

  it('escapes untrusted HTML in the printable report and labels it as the visible page', () => {
    const html = buildSalesHistoryPrintHtml([{
      id: 'sale-print',
      customer_name: '<img src=x onerror=alert(1)> & "Cliente"',
      total: 20,
      payment_status: 'credit_pending',
      payment_method: 'credit',
      status: 'closed'
    }], {
      pageIndex: 1,
      scopeLabel: 'Mis ventas',
      sourceLabel: 'Último snapshot',
      period: 'Desde 01/11/2026 hasta 08/11/2026'
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Cliente&quot;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Solo página 2: 1 registro(s) filtrado(s)');
    expect(html).toContain('Crédito inicial (histórico)');
    expect(html).toContain('Período:</strong> Desde 01/11/2026 hasta 08/11/2026');
  });
});
