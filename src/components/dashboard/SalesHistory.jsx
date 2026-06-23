import { useMemo, useState } from 'react';
import { salesRepository } from '../../services/db/sales';
import './SalesHistory.css';

const toText = (value) => String(value || '').trim().toLowerCase();

const getSaleKey = (sale) => sale?.id || sale?.timestamp || 'sale-without-id';

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

const getCustomerLabel = (sale = {}) => (
  sale.customerName ||
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

const getSaleStatus = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  if (status === 'cancelled' || fulfillmentStatus === 'cancelled') return 'cancelled';
  if (status === 'open' || fulfillmentStatus === 'open') return 'open';
  return status || fulfillmentStatus || 'completed';
};

const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

const buildCancellationSummary = (sale = {}) => {
  if (getSaleStatus(sale) !== 'cancelled') return null;

  const disposition = Array.isArray(sale.cancellationDisposition)
    ? sale.cancellationDisposition
    : [];
  const restockCount = disposition.filter((entry) => entry.action === 'RESTOCK').length;
  const wasteCount = disposition.filter((entry) => entry.action === 'WASTE').length;
  const noReturnCount = disposition.filter((entry) => entry.action === 'NO_RETURN').length;

  return {
    cancelledBy: sale.cancelledBy || 'No registrado',
    cancelReason: sale.cancelReason || sale.deletedReason || 'Sin motivo',
    inventoryText: sale.inventoryRestored
      ? `Stock devuelto (${restockCount || 'parcial'})`
      : 'Stock no devuelto',
    wasteText: sale.cancellationWasteRecordIds?.length
      ? `${sale.cancellationWasteRecordIds.length} merma(s) registrada(s)`
      : (wasteCount ? `${wasteCount} item(s) enviados a merma` : 'Sin merma'),
    dispositionText: [
      restockCount ? `${restockCount} reposicion` : null,
      wasteCount ? `${wasteCount} merma` : null,
      noReturnCount ? `${noReturnCount} sin retorno` : null
    ].filter(Boolean).join(' | ') || 'Sin plan detallado'
  };
};

export default function SalesHistory({
  sales,
  onDeleteSale,
  onArchiveSale,
  onNext,
  onPrev,
  hasMore = false,
  currentPageIndex = 0,
  isLoading = false
}) {
  const [expandedSplits, setExpandedSplits] = useState({});
  const [filters, setFilters] = useState({
    query: '',
    dateFrom: '',
    dateTo: '',
    paymentMethod: 'all',
    status: 'all',
    split: 'all'
  });

  const mainSales = useMemo(
    () => (sales || []).filter((sale) => !sale.splitParentId),
    [sales]
  );

  const paymentMethods = useMemo(() => (
    Array.from(mainSales.reduce((methods, sale) => {
      const method = getPaymentLabel(sale);
      if (method) methods.add(method);
      return methods;
    }, new Set())).sort()
  ), [mainSales]);

  const filteredSales = useMemo(() => {
    const query = toText(filters.query);
    const fromMs = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
    const toMs = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : null;

    return mainSales.filter((sale) => {
      const saleTime = Date.parse(sale.timestamp);
      const splitParent = isSplitParentSale(sale);
      const status = getSaleStatus(sale);
      const haystack = [
        sale.id,
        sale.folio,
        getCustomerLabel(sale),
        getPaymentLabel(sale),
        sale.total
      ].map(toText).join(' ');

      if (query && !haystack.includes(query)) return false;
      if (fromMs && Number.isFinite(saleTime) && saleTime < fromMs) return false;
      if (toMs && Number.isFinite(saleTime) && saleTime > toMs) return false;
      if (filters.paymentMethod !== 'all' && getPaymentLabel(sale) !== filters.paymentMethod) return false;
      if (filters.status !== 'all' && status !== filters.status) return false;
      if (filters.split === 'split' && !splitParent) return false;
      if (filters.split === 'regular' && splitParent) return false;

      return true;
    });
  }, [filters, mainSales]);

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
    const header = ['id', 'folio', 'fecha', 'cliente', 'metodo_pago', 'estado', 'total'];
    const rows = filteredSales.map((sale) => [
      sale.id,
      sale.folio,
      sale.timestamp,
      getCustomerLabel(sale),
      getPaymentLabel(sale),
      getSaleStatus(sale),
      sale.total
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historial-ventas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const rows = filteredSales.map((sale) => `
      <tr>
        <td>${sale.folio || sale.id || ''}</td>
        <td>${new Date(sale.timestamp).toLocaleString()}</td>
        <td>${getCustomerLabel(sale) || '-'}</td>
        <td>${getPaymentLabel(sale) || '-'}</td>
        <td>${getSaleStatus(sale)}</td>
        <td>$${(Number(sale.total) || 0).toFixed(2)}</td>
      </tr>
    `).join('');
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Historial de ventas</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Historial de ventas</h1>
          <table>
            <thead>
              <tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Estado</th><th>Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="sales-history-container">
      <div className="sales-history-topbar">
        <h3 className="subtitle">Historial de Ventas ({filteredSales.length}/{mainSales.length})</h3>
        <div className="history-export-actions">
          <button type="button" className="history-secondary-btn" onClick={exportCsv} disabled={filteredSales.length === 0}>
            CSV
          </button>
          <button type="button" className="history-secondary-btn" onClick={printPdf} disabled={filteredSales.length === 0}>
            PDF
          </button>
        </div>
      </div>

      <div className="history-filters">
        <input
          type="search"
          value={filters.query}
          onChange={(event) => updateFilter('query', event.target.value)}
          placeholder="Folio, cliente, metodo..."
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
          <option value="all">Todos los pagos</option>
          {paymentMethods.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
        <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
          <option value="all">Todos los estados</option>
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

      {filteredSales.length === 0 ? (
        <div className="empty-message">No hay ventas registradas.</div>
      ) : (
        <div className="sales-history-list">
          {filteredSales.map((sale) => {
            const isSplitParent = isSplitParentSale(sale);
            const isCancelled = getSaleStatus(sale) === 'cancelled';
            const expandedData = expandedSplits[sale.id];
            const cancellationSummary = buildCancellationSummary(sale);

            return (
              <div key={getSaleKey(sale)} className={`sale-card-wrapper ${isSplitParent ? 'split-parent-card' : ''}`}>
                <div className="sale-item">
                  <div className="sale-header">
                    <div className="sale-date">
                      <span className="sale-folio-tag">
                        Folio: {sale.folio || sale.id?.substring(0, 6) || '---'}
                      </span>
                      {new Date(sale.timestamp).toLocaleString()}
                      {isSplitParent && (
                        <span className="split-badge">Cuentas Separadas</span>
                      )}
                      {isCancelled && (
                        <span className="cancelled-sale-badge">Cancelada</span>
                      )}
                    </div>
                    <div className={`sale-total ${isSplitParent ? 'split-total' : ''}`}>
                      ${(parseFloat(String(sale.total).replace(/[^0-9.-]+/g, '')) || 0).toFixed(2)}
                    </div>
                  </div>

                  <div className="sale-item-info">
                    {(sale.items || []).length === 0 ? (
                      <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0' }}>Sin detalle de productos</p>
                    ) : (
                      <ul>
                        {(sale.items || []).map((item) => {
                          const costMissing = isCostMissing(item.cost);
                          return (
                            <li key={item.lineId || item.cartLineId || item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className={isSplitParent ? 'text-muted-strike' : ''}>
                                {item.quantity}x {item.name}
                              </span>

                              {item.requiresPrescription && (
                                <span className="prescription-tag">(Controlado)</span>
                              )}

                              {costMissing && !isSplitParent && (
                                <span className="warning-cost-tag" title="Vendido sin costo de compra registrado.">
                                  Sin Costo
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
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
                    {isSplitParent && (
                      <button
                        type="button"
                        className="toggle-split-btn"
                        onClick={() => toggleSplitView(sale)}
                      >
                        {expandedData ? 'Ocultar Desglose' : `Ver ${sale.splitChildIds?.length || 0} Pagos`}
                      </button>
                    )}

                    <button
                      type="button"
                      className="delete-order-btn"
                      onClick={() => (
                        isCancelled ? onArchiveSale(sale) : onDeleteSale(sale)
                      )}
                    >
                      {isCancelled ? 'Mover a papelera' : `Cancelar ${isSplitParent ? 'origen' : 'venta'}`}
                    </button>
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
        <span>Pagina {currentPageIndex + 1}</span>
        <button type="button" className="history-secondary-btn" onClick={onNext} disabled={isLoading || !hasMore}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
