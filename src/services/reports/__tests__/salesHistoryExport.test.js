import { describe, expect, it } from 'vitest';
import {
  buildSalesHistoryCsv,
  buildSalesHistoryPrintHtml,
  dedupeSalesByStableId,
  formatSalesHistoryDateRange,
  getSaleInitialFinancialAmounts,
  getSalePaymentStatusCategory,
  getSalePaymentStatusLabel
} from '../salesHistoryExport';

describe('sales history export helpers', () => {
  it.each([
    [{ status: 'closed', payment_status: 'paid', payment_method: 'cash' }, 'paid', 'Pagada'],
    [{ status: 'closed', payment_status: 'credit_pending', payment_method: 'cash' }, 'credit', 'Fiada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'mixed', amount_paid: 10 }, 'partial', 'Parcialmente pagada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'cash', amount_paid: 0 }, 'partial', 'Parcialmente pagada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'mixed' }, 'partial', 'Parcialmente pagada'],
    [{ status: 'closed', payment_status: 'partial', payment_method: 'cash' }, 'partial', 'Parcialmente pagada'],
    [{ status: 'cancelled', payment_status: 'paid', payment_method: 'cash' }, 'cancelled', 'Cancelada'],
    [{ status: 'closed', payment_method: 'cash' }, 'unknown', 'Estado desconocido']
  ])('maps payment status independently from method: %j', (sale, category, label) => {
    expect(getSalePaymentStatusCategory(sale)).toBe(category);
    expect(getSalePaymentStatusLabel(sale)).toBe(label);
  });

  it('reconstructs the confirmed local $50 cash sale from its persisted payment snapshot', () => {
    const sale = {
      id: 'local-cash-50', status: 'closed', paymentMethod: 'efectivo', total: '50',
      abono: '50', saldoPendiente: '0', payments: [{ method: 'cash', amount: '50' }]
    };
    expect(getSalePaymentStatusCategory(sale)).toBe('paid');
    expect(getSalePaymentStatusLabel(sale)).toBe('Pagada');
    expect(getSaleInitialFinancialAmounts(sale)).toEqual({ paidInitially: 50, initialCredit: null });
  });

  it('keeps the confirmed $120 fiado sale pending without attributing any cash', () => {
    const sale = {
      id: 'local-credit-120', status: 'closed', paymentMethod: 'fiado', paymentStatus: 'credit_pending',
      creditStatus: 'VIGENTE', total: '120', abono: '0', saldoPendiente: '120', payments: []
    };
    expect(getSalePaymentStatusLabel(sale)).toBe('Fiada');
    expect(getSaleInitialFinancialAmounts(sale)).toEqual({ paidInitially: 0, initialCredit: 120 });
  });

  it('labels a credited sale with an initial payment as mixed credit', () => {
    expect(getSalePaymentStatusCategory({
      status: 'closed', paymentStatus: 'partial', paymentMethod: 'fiado',
      total: '120', abono: '50', saldoPendiente: '70',
      payments: [{ method: 'cash', amount: '50' }, { method: 'credit', amount: '70' }]
    })).toBe('mixed_credit');
  });

  it('keeps the initial credit separate from collections applied later', () => {
    const sale = {
      status: 'closed', paymentStatus: 'partial', paymentMethod: 'fiado',
      total: '120', abono: '50', saldoPendiente: '50', creditStatus: 'PARCIAL',
      paymentCollections: [{ method: 'cash', amount: '20', timestamp: '2026-11-18T10:00:00.000Z' }]
    };
    expect(getSaleInitialFinancialAmounts(sale)).toEqual({ paidInitially: 50, initialCredit: 70 });
    expect(getSalePaymentStatusCategory(sale)).toBe('mixed_credit');
  });

  it('reads the cloud original credit amount instead of its mutable current balance', () => {
    expect(getSaleInitialFinancialAmounts({
      status: 'closed', source_mode: 'cloud_committed', total: 120,
      amount_paid: 50, originalBalanceDue: 70,
      balance_due: 70, current_balance_due: 40
    })).toEqual({ paidInitially: 50, initialCredit: 70 });
  });

  it('does not label a mutable current balance as initial credit without initial payment evidence', () => {
    expect(getSaleInitialFinancialAmounts({
      status: 'closed', paymentMethod: 'fiado', total: 120, saldoPendiente: 100,
      paymentCollections: [{ method: 'cash', amount: '20' }]
    })).toEqual({ paidInitially: null, initialCredit: null });
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

  it('does not infer a cash payment from the method and sale total alone', () => {
    expect(getSalePaymentStatusCategory({
      status: 'closed', payment_method: 'cash', total: 50
    })).toBe('unknown');
    expect(getSaleInitialFinancialAmounts({
      status: 'closed', payment_method: 'cash', total: 50
    })).toEqual({ paidInitially: null, initialCredit: null });
  });

  it('keeps date-only report bounds as business calendar dates', () => {
    expect(formatSalesHistoryDateRange({ date_from: '2026-11-18', date_to: '2026-11-18' }, 'America/Merida'))
      .toBe('Desde 18/11/2026 hasta 18/11/2026 · America/Merida');
    expect(formatSalesHistoryDateRange({
      date_from: '2026-11-18T06:00:00.000Z', date_to: '2026-11-19T06:00:00.000Z'
    }, 'America/Merida')).toBe('Desde 18/11/2026 hasta 18/11/2026 · America/Merida');
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
