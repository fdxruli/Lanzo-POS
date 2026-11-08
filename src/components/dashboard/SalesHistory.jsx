import { useMemo, useState } from 'react';
import { salesRepository } from '../../services/db/sales';
import { getReportSourceLabel, REPORT_SOURCE_MODES } from '../../services/reports/reportSourceBadges';
import { formatCurrencyMXN } from '../../utils/formatCurrencyMXN';
import {
  buildSalesHistoryCsv,
  buildSalesHistoryPrintHtml,
  dedupeSalesByStableId,
  formatSalesHistoryDateRange,
  getSaleInitialFinancialAmounts,
  getSalePaymentStatusCategory,
  getSalePaymentStatusLabel
} from '../../services/reports/salesHistoryExport';
import {
  getSaleDisplayReference,
  getSaleSecondaryReference,
  isEcommerceSale,
  saleMatchesReference
} from '../../services/sales/saleReference';
import './SalesHistory.css';

const toText = (value) => String(value || '').trim().toLowerCase();

const getSaleKey = (sale, index) => sale?.cloudSaleId || sale?.cloud_sale_id || sale?.id || `sale-without-id-${index}`;

const isSplitParentSale = (sale = {}) => (
  sale.type === 'split_parent' ||
  sale.saleType === 'split_parent' ||
  sale.orderType === 'split_parent' ||
  (Array.isArray(sale.splitChildIds) && sale.splitChildIds.length > 0) ||
  Boolean(sale.splitGroupId && sale.splitSettledAt)
);

const isCostMissing = (value) => (
  value === null ||
  value === undefined ||
  value === '' ||
  Number(value) === 0 ||
  Number.isNaN(Number(value))
);

const readFirst = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const getSaleTimestamp = (sale = {}) => readFirst(sale.timestamp, sale.soldAt, sale.sold_at, sale.createdAt, sale.created_at);

const getCustomerLabel = (sale = {}) => (
  sale.customerName ||
  sale.customer_name ||
  sale.customer?.name ||
  sale.customerSnapshot?.name ||
  sale.customerId ||
  ''
);

const getPaymentLabel = (sale = {}) => (
  sale.paymentMethod ||
  sale.payment_method ||
  sale.paymentSummary?.method ||
  ''
);

const getSourceMode = (sale = {}) => String(sale.sourceMode || sale.source_mode || '').toLowerCase();

const getSaleStatus = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || sale.fulfillment_status || '').toLowerCase();
  if (status === 'cancelled' || fulfillmentStatus === 'cancelled') return 'cancelled';
  if (status === 'open' || fulfillmentStatus === 'open') return 'open';
  if (status === 'closed' || fulfillmentStatus === 'closed') return 'closed';
  return status || fulfillmentStatus || 'completed';
};

const formatDateForDisplay = (value) => {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-MX');
};

const getPaymentMethodFilterLabel = (sale = {}) => String(
  sale.paymentMethod || sale.payment_method || sale.paymentSummary?.method || ''
).trim();

const getSaleOperationalStatusLabel = (status) => ({
  completed: 'Completada',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
  open: 'Abierta'
}[status] || 'Desconocida');

const PAYMENT_STATUS_FILTER_LABELS = Object.freeze({
  paid: 'Pagada',
  credit: 'Fiada',
  mixed_credit: 'Pago mixto con crédito',
  partial: 'Parcialmente pagada',
  cancelled: 'Cancelada',
  unknown: 'Estado desconocido'
});

const buildCancellationSummary = (sale = {}) => {
  if (getSaleStatus(sale) !== 'cancelled') return null;

  const disposition = Array.isArray(sale.cancellationDisposition)
    ? sale.cancellationDisposition
    : [];
  const restockCount = disposition.filter((entry) => entry.action === 'RESTOCK').length;
  const wasteCount = disposition.filter((entry) => entry.action === 'WASTE').length;
  const noReturnCount = disposition.filter((entry) => entry.action === 'NO_RETURN').length;
  const cloudReversals = [
    sale.cashReversalStatus || sale.cash_reversal_status ? `Caja: ${sale.cashReversalStatus || sale.cash_reversal_status}` : null,
    sale.inventoryReversalStatus || sale.inventory_reversal_status ? `Inventario: ${sale.inventoryReversalStatus || sale.inventory_reversal_status}` : null,
    sale.creditReversalStatus || sale.credit_reversal_status ? `Credito: ${sale.creditReversalStatus || sale.credit_reversal_status}` : null
  ].filter(Boolean);

  return {
    cancelledBy: sale.cancelledBy || sale.cancelled_by || sale.actorName || 'No registrado',
    cancelReason: sale.cancelReason || sale.cancel_reason || sale.deletedReason || 'Sin motivo',
    inventoryText: sale.inventoryRestored
      ? `Stock devuelto (${restockCount || 'parcial'})`
      : (cloudReversals.length ? cloudReversals.join(' | ') : 'Stock no devuelto'),
    wasteText: sale.cancellationWasteRecordIds?.length
      ? `${sale.cancellationWasteRecordIds.length} merma(s) registrada(s)`
      : (wasteCount ? `${wasteCount} item(s) enviados a merma` : 'Sin merma'),
    dispositionText: [
      restockCount ? `${restockCount} reposicion` : null,
      wasteCount ? `${wasteCount} merma` : null,
      noReturnCount ? `${noReturnCount} sin retorno` : null
    ].filter(Boolean).join(' | ') || (cloudReversals.length ? 'Reversas cloud aplicadas' : 'Sin plan detallado')
  };
};

const isEffectApplied = (status) => String(status || '').toLowerCase() === 'applied';

const buildCloudBadges = (sale = {}, isCloudFinal = false) => {
  if (!isCloudFinal) return [];

  const status = getSaleStatus(sale);
  const badges = [];

  if (status === 'closed') badges.push({ label: 'Cerrada', tone: 'success' });
  if (status === 'cancelled') badges.push({ label: 'Cancelada', tone: 'danger' });

  if (isEffectApplied(sale.cashEffectStatus || sale.cash_effect_status)) badges.push({ label: 'Caja aplicada', tone: 'cloud' });
  if (isEffectApplied(sale.inventoryEffectStatus || sale.inventory_effect_status)) badges.push({ label: 'Inventario aplicado', tone: 'cloud' });
  if (isEffectApplied(sale.creditEffectStatus || sale.credit_effect_status)) badges.push({ label: 'Credito aplicado', tone: 'cloud' });

  const hasReversals = [
    sale.cashReversalStatus || sale.cash_reversal_status,
    sale.inventoryReversalStatus || sale.inventory_reversal_status,
    sale.creditReversalStatus || sale.credit_reversal_status
  ].some(isEffectApplied);
  if (hasReversals) badges.push({ label: 'Reversas aplicadas', tone: 'danger' });

  return badges;
};

const getUiBadgeTone = (tone) => {
  if (tone === 'danger') return 'ui-badge--danger';
  if (tone === 'success') return 'ui-badge--success';
  if (tone === 'warning') return 'ui-badge--warning';
  return 'ui-badge--info';
};

const getCloudActionState = (sale = {}, isCloudFinal = false) => {
  const status = getSaleStatus(sale);
  const sourceMode = getSourceMode(sale);

  if (!isCloudFinal) {
    return {
      disabled: false,
      action: status === 'cancelled' ? 'archive' : 'cancel',
      label: status === 'cancelled' ? 'Mover a papelera' : `Cancelar ${isSplitParentSale(sale) ? 'origen' : 'venta'}`,
      title: ''
    };
  }

  if (status === 'cancelled') {
    return {
      disabled: true,
      action: 'none',
      label: 'Ya cancelada',
      title: 'Esta venta cloud ya fue cancelada y no puede cancelarse otra vez.'
    };
  }

  if (status === 'closed' && sourceMode === 'cloud_committed') {
    return {
      disabled: false,
      action: 'cancel',
      label: 'Cancelar venta cloud',
      title: 'Usa el flujo seguro de cancelacion cloud 6E.'
    };
  }

  return {
    disabled: true,
    action: 'none',
    label: 'Solo consulta',
    title: sourceMode === 'shadow' || sourceMode === 'legacy_imported'
      ? 'Esta venta no tiene efectos cloud reales; no se cancela desde el flujo cloud.'
      : 'Solo se pueden cancelar ventas cloud cerradas.'
  };
};

const getItems = (sale = {}) => (Array.isArray(sale.items) ? sale.items : []);

export default function SalesHistory({
  sales,
  onDeleteSale,
  onArchiveSale,
  onNext,
  onPrev,
  hasMore = false,
  currentPageIndex = 0,
  isLoading = false,
  source = null,
  reportSource = null,
  isCloudFinal = false,
  canManageRefunds = false,
  totalCount = null,
  queryScope = null,
  dateRange = null,
  error = null,
  businessName = ''
}) {
  const [expandedSplits, setExpandedSplits] = useState({});
  const [exportError, setExportError] = useState('');
  const [filters, setFilters] = useState({
    query: '',
    dateFrom: '',
    dateTo: '',
    paymentMethod: 'all',
    paymentStatus: 'all',
    status: 'all',
    split: 'all'
  });

  const effectiveSource = source || reportSource || {};
  const effectiveIsCloudFinal = Boolean(isCloudFinal || effectiveSource.final === true || effectiveSource.mode === REPORT_SOURCE_MODES.CLOUD_FINAL);
  const sourceWarnings = Array.isArray(effectiveSource.warnings) ? effectiveSource.warnings : [];

  const mainSales = useMemo(
    () => dedupeSalesByStableId((sales || []).filter((sale) => !sale.splitParentId)),
    [sales]
  );

  const paymentMethods = useMemo(() => (
    Array.from(mainSales.reduce((methods, sale) => {
      const method = getPaymentMethodFilterLabel(sale);
      if (method) methods.add(method);
      return methods;
    }, new Set())).sort()
  ), [mainSales]);

  const filteredSales = useMemo(() => {
    const query = toText(filters.query);
    const fromMs = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
    const toMs = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : null;

    return mainSales.filter((sale) => {
      const saleTime = Date.parse(getSaleTimestamp(sale));
      const splitParent = isSplitParentSale(sale);
      const status = getSaleStatus(sale);
      const haystack = [
        sale.id,
        sale.cloudSaleId,
        sale.folio,
        sale.cloudFolio,
        sale.ecommerceOrderCode,
        sale.ecommerce_order_code,
        getCustomerLabel(sale),
        getPaymentMethodFilterLabel(sale),
        sale.total
      ].map(toText).join(' ');

      if (query && !haystack.includes(query) && !saleMatchesReference(sale, query)) return false;
      if ((fromMs !== null || toMs !== null) && !Number.isFinite(saleTime)) return false;
      if (fromMs !== null && saleTime < fromMs) return false;
      if (toMs !== null && saleTime > toMs) return false;
      if (filters.paymentMethod !== 'all' && getPaymentMethodFilterLabel(sale) !== filters.paymentMethod) return false;
      if (filters.paymentStatus !== 'all' && getSalePaymentStatusCategory(sale) !== filters.paymentStatus) return false;
      if (filters.status !== 'all' && status !== filters.status) return false;
      if (filters.split === 'split' && !splitParent) return false;
      if (filters.split === 'regular' && splitParent) return false;

      return true;
    });
  }, [filters, mainSales]);

  const activeFilters = useMemo(() => {
    const active = [];
    if (filters.query.trim()) active.push(`Búsqueda: ${filters.query.trim()}`);
    if (filters.dateFrom) active.push(`Desde ${filters.dateFrom}`);
    if (filters.dateTo) active.push(`Hasta ${filters.dateTo}`);
    if (filters.paymentMethod !== 'all') active.push(`Método: ${filters.paymentMethod}`);
    if (filters.paymentStatus !== 'all') active.push(`Pago: ${PAYMENT_STATUS_FILTER_LABELS[filters.paymentStatus]}`);
    if (filters.status !== 'all') active.push(`Venta: ${getSaleOperationalStatusLabel(filters.status)}`);
    if (filters.split === 'split') active.push('Ventas divididas');
    if (filters.split === 'regular') active.push('Ventas sin dividir');
    return active;
  }, [filters]);

  const normalizedTotalCount = totalCount !== null && totalCount !== undefined && totalCount !== ''
    && Number.isFinite(Number(totalCount)) && Number(totalCount) >= 0
    ? Number(totalCount)
    : null;
  const scopeLabel = queryScope === 'license'
    ? 'Negocio, según permisos actuales'
    : queryScope === 'mine'
      ? 'Mis ventas, según permisos actuales'
      : effectiveIsCloudFinal ? 'Alcance no confirmado' : 'Datos visibles de este dispositivo';
  const sourceLabel = effectiveSource.mode
    ? `${getReportSourceLabel(effectiveSource)}${effectiveSource.stale ? ' (snapshot desactualizado)' : ''}`
    : (isLoading ? 'Esperando consulta' : 'Origen no informado');
  const pageNumber = currentPageIndex + 1;
  const periodLabel = formatSalesHistoryDateRange(dateRange);
  const coverageLabel = `Solo página ${pageNumber}: ${filteredSales.length} de ${mainSales.length} registro(s) cargado(s) tras los filtros locales`;
  const exportMetadata = {
    pageIndex: currentPageIndex,
    pageLoadedCount: mainSales.length,
    exportedCount: filteredSales.length,
    totalCount: normalizedTotalCount,
    dateRange,
    period: periodLabel,
    activeFilters,
    scopeLabel,
    sourceLabel,
    businessName,
    coverageLabel
  };

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSplitView = async (sale) => {
    const saleId = sale.id;
    if (!saleId) return;

    if (expandedSplits[saleId]) {
      const newState = { ...expandedSplits };
      delete newState[saleId];
      setExpandedSplits(newState);
      return;
    }

    setExpandedSplits((prev) => ({
      ...prev,
      [saleId]: { loading: true, children: [], error: null }
    }));

    try {
      const childIds = sale.splitChildIds || [];
      const childRecords = await salesRepository.getSalesByIds(childIds);

      setExpandedSplits((prev) => ({
        ...prev,
        [saleId]: { loading: false, children: childRecords, error: null }
      }));
    } catch {
      setExpandedSplits((prev) => ({
        ...prev,
        [saleId]: { loading: false, children: [], error: 'Error al cargar tickets hijos' }
      }));
    }
  };

  const exportCsv = () => {
    setExportError('');
    const csv = buildSalesHistoryCsv(filteredSales, exportMetadata);
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historial-ventas-pagina-${pageNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printPdf = () => {
    setExportError('');
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      setExportError('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir o guardar como PDF.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildSalesHistoryPrintHtml(filteredSales, exportMetadata));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="sales-history-container">
      <div className="sales-history-topbar">
        <div className="history-heading">
          <h3 className="subtitle">Historial de ventas</h3>
          <p className="history-result-summary" aria-live="polite">
            {isLoading
              ? `Cargando página ${pageNumber}…`
              : `${filteredSales.length} de ${mainSales.length} registros cargados visibles en página ${pageNumber}`}
            {!isLoading && normalizedTotalCount !== null && ` · ${normalizedTotalCount} disponibles en la consulta`}
            {!isLoading && normalizedTotalCount === null && (hasMore ? ' · Hay más páginas' : ' · Total disponible no informado')}
          </p>
        </div>
        <div className="history-export-actions">
          <button type="button" className="history-secondary-btn" onClick={exportCsv} disabled={isLoading || filteredSales.length === 0}>
            CSV · página
          </button>
          <button type="button" className="history-secondary-btn" onClick={printPdf} disabled={isLoading || filteredSales.length === 0}>
            Imprimir · página
          </button>
        </div>
      </div>

      <p className="history-export-note">
        {isLoading
          ? 'La exportación estará disponible cuando termine la carga.'
          : `CSV e impresión incluirán solo ${filteredSales.length} venta(s) filtradas de las ${mainSales.length} cargadas en esta página.`}
      </p>

      <div className="history-meta" aria-label="Alcance de la consulta">
        <span>Origen: {sourceLabel}</span>
        <span>Alcance: {scopeLabel}</span>
        <span>Período: {periodLabel}</span>
      </div>

      {sourceWarnings.length > 0 && (
        <div className="ui-alert ui-alert--warning empty-message sales-history-warning">
          {sourceWarnings[0]}
        </div>
      )}

      {error && <div className="ui-alert ui-alert--warning sales-history-warning" role="alert">{error}</div>}
      {exportError && <div className="ui-alert ui-alert--warning sales-history-warning" role="alert">{exportError}</div>}

      <div className="history-filters">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => updateFilter('query', event.target.value)}
          aria-label="Buscar ventas"
          placeholder="Folio, cliente, método..."
        />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(event) => updateFilter('dateFrom', event.target.value)}
          aria-label="Fecha inicial"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(event) => updateFilter('dateTo', event.target.value)}
          aria-label="Fecha final"
        />
        <select value={filters.paymentMethod} onChange={(event) => updateFilter('paymentMethod', event.target.value)}>
          <option value="all">Todos los métodos</option>
          {paymentMethods.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
        <select value={filters.paymentStatus} onChange={(event) => updateFilter('paymentStatus', event.target.value)} aria-label="Filtrar por estado de pago">
          <option value="all">Todos los estados de pago</option>
          <option value="paid">Pagadas</option>
          <option value="credit">Fiadas</option>
          <option value="mixed_credit">Pago mixto con crédito</option>
          <option value="partial">Parcialmente pagadas</option>
          <option value="cancelled">Canceladas</option>
          <option value="unknown">Estado desconocido</option>
        </select>
        <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
          <option value="all">Todos los estados de venta</option>
          <option value="completed">Completadas</option>
          <option value="closed">Cerradas</option>
          <option value="cancelled">Canceladas</option>
          <option value="open">Abiertas</option>
        </select>
        <select value={filters.split} onChange={(event) => updateFilter('split', event.target.value)}>
          <option value="all">Todas</option>
          <option value="split">Divididas</option>
          <option value="regular">Sin dividir</option>
        </select>
      </div>

      <p className="history-filter-summary">
        <strong>Filtros locales:</strong> {activeFilters.length ? activeFilters.join(' · ') : 'Sin filtros locales'}
        {' '}<span>(aplican solo a los registros cargados de esta página)</span>
      </p>

      {isLoading && mainSales.length === 0 ? (
        <div className="empty-message" role="status">Cargando historial de ventas…</div>
      ) : error && mainSales.length === 0 ? (
        <div className="empty-message">No se pudo mostrar el historial.</div>
      ) : filteredSales.length === 0 ? (
        <div className="empty-message">No hay ventas que coincidan en esta página.</div>
      ) : (
        <div className="sales-history-list">
          {filteredSales.map((sale, saleIndex) => {
            const isSplitParent = isSplitParentSale(sale);
            const isCancelled = getSaleStatus(sale) === 'cancelled';
            const expandedData = expandedSplits[sale.id];
            const cancellationSummary = buildCancellationSummary(sale);
            const actionState = getCloudActionState(sale, effectiveIsCloudFinal);
            const badges = buildCloudBadges(sale, effectiveIsCloudFinal);
            const items = getItems(sale);
            const itemsCount = Number(sale.itemsCount || sale.items_count || items.length || 0);
            const itemsQuantity = Number(sale.itemsQuantity || sale.items_quantity || 0);
            const initialAmounts = getSaleInitialFinancialAmounts(sale);
            const paymentStatusLabel = getSalePaymentStatusLabel(sale);
            const ecommerce = isEcommerceSale(sale);

            return (
              <div key={getSaleKey(sale, saleIndex)} className={`sale-card-wrapper ${isSplitParent ? 'split-parent-card' : ''}`}>
                <div className="sale-item">
                  <div className="sale-header">
                    <div className="sale-date">
                      <span className="sale-reference">
                        <span className="sale-folio-tag">
                          {getSaleDisplayReference(sale) || sale.id?.substring?.(0, 6) || '---'}
                        </span>
                        {ecommerce && <span className="sale-reference-secondary">{getSaleSecondaryReference(sale)}</span>}
                      </span>
                      {ecommerce && <span className="ui-badge ui-badge--info ui-badge--sm">Ecommerce</span>}
                      {formatDateForDisplay(getSaleTimestamp(sale))}
                      {isSplitParent && (
                        <span className="split-badge">Cuentas Separadas</span>
                      )}
                      {isCancelled && (
                        <span className="cancelled-sale-badge">Cancelada</span>
                      )}
                      {badges.map((badge) => (
                        <span key={`${getSaleKey(sale, saleIndex)}-${badge.label}`} className={`ui-badge ui-badge--sm ${getUiBadgeTone(badge.tone)}`}>{badge.label}</span>
                      ))}
                    </div>
                    <div className={`sale-total ${isSplitParent ? 'split-total' : ''}`}>
                      <span className="sale-total-label">Total comercial</span>
                      {formatCurrencyMXN(sale.total, 'Importe no disponible')}
                    </div>
                  </div>

                  <div className="sale-item-info">
                    {items.length === 0 ? (
                      <p className="text-muted sales-history-item-note">
                        {itemsCount || itemsQuantity
                          ? `${itemsCount || 0} partida(s), ${itemsQuantity || 0} unidad(es)`
                          : 'Sin detalle de productos'}
                      </p>
                    ) : (
                      <ul>
                        {items.map((item) => {
                          const costMissing = isCostMissing(item.cost);
                          return (
                            <li key={item.lineId || item.cartLineId || item.id || `${item.name}-${item.quantity}`} className="sales-history-item-row">
                              <span className={isSplitParent ? 'text-muted-strike' : ''}>
                                {item.quantity}x {item.name}
                              </span>

                              {item.requiresPrescription && (
                                <span className="prescription-tag">(Controlado)</span>
                              )}

                              {costMissing && !isSplitParent && !effectiveIsCloudFinal && (
                                <span className="warning-cost-tag" title="Vendido sin costo de compra registrado.">
                                  Sin Costo
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="card-mini-stats sales-history-mini-stats sales-history-mini-stats--nested">
                      {getCustomerLabel(sale) && <span className="ui-badge ui-badge--neutral mini-stat-pill">Cliente: {getCustomerLabel(sale)}</span>}
                      {getPaymentLabel(sale) && <span className="ui-badge ui-badge--neutral mini-stat-pill">Método: {getPaymentLabel(sale)}</span>}
                      <span className="ui-badge ui-badge--info mini-stat-pill">Estado de pago: {paymentStatusLabel}</span>
                      {initialAmounts.paidInitially !== null && initialAmounts.paidInitially > 0 && (
                        <span className="ui-badge ui-badge--success mini-stat-pill">Pagado inicialmente: {formatCurrencyMXN(initialAmounts.paidInitially)}</span>
                      )}
                      {initialAmounts.initialCredit !== null && initialAmounts.initialCredit > 0 && (
                        <span className="ui-badge ui-badge--warning mini-stat-pill">Crédito inicial (histórico): {formatCurrencyMXN(initialAmounts.initialCredit)}</span>
                      )}
                      {sale.actorName && <span className="ui-badge ui-badge--neutral mini-stat-pill">Actor: {sale.actorName}</span>}
                    </div>
                  </div>

                  {cancellationSummary && (
                    <div className="cancellation-audit">
                      <strong>Bitacora de cancelacion</strong>
                      <span>Usuario: {cancellationSummary.cancelledBy}</span>
                      <span>Motivo: {cancellationSummary.cancelReason}</span>
                      <span>{cancellationSummary.inventoryText}</span>
                      <span>{cancellationSummary.wasteText}</span>
                      <span>{cancellationSummary.dispositionText}</span>
                    </div>
                  )}

                  <div className="sale-actions">
                    {isSplitParent && !effectiveIsCloudFinal && (
                      <button
                        type="button"
                        className="toggle-split-btn"
                        onClick={() => toggleSplitView(sale)}
                      >
                        {expandedData ? 'Ocultar Desglose' : `Ver ${sale.splitChildIds?.length || 0} Pagos`}
                      </button>
                    )}

                    {canManageRefunds && (
                      <button
                        type="button"
                        className="delete-order-btn"
                        title={actionState.title}
                        disabled={actionState.disabled}
                        onClick={() => {
                          if (actionState.action === 'archive') onArchiveSale?.(sale);
                          if (actionState.action === 'cancel') onDeleteSale?.(sale);
                        }}
                      >
                        {actionState.label}
                      </button>
                    )}
                  </div>

                  {expandedData && (
                    <div className="split-children-accordion">
                      {expandedData.loading ? (
                        <div className="split-loading">Cargando pagos...</div>
                      ) : expandedData.error ? (
                        <div className="split-error">{expandedData.error}</div>
                      ) : (
                        expandedData.children.map((child) => (
                          <div key={child.id} className="split-child-card">
                            <div className="split-child-header">
                              <span className="split-child-label">{child.splitLabel || 'Pago Dividido'}</span>
                              <span className="split-child-status">{String(child.status || '').toUpperCase()}</span>
                              <strong className="split-child-total">${(Number(child.total) || 0).toFixed(2)}</strong>
                            </div>
                            <div className="split-child-items">
                              {(child.items || []).map((ci) => (
                                <div key={ci.lineId || ci.cartLineId || ci.id} className="child-item-row">
                                  {ci.quantity}x {ci.name}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="history-pagination">
        <button type="button" className="history-secondary-btn" onClick={onPrev} disabled={isLoading || currentPageIndex === 0}>
          Anterior
        </button>
        <span>Página {currentPageIndex + 1}{normalizedTotalCount !== null ? ` · ${normalizedTotalCount} disponibles` : ''}</span>
        <button type="button" className="history-secondary-btn" onClick={onNext} disabled={isLoading || !hasMore}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
