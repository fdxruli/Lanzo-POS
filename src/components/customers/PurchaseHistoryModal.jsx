import { useState, useEffect, useMemo, useCallback } from 'react';
import { queryByIndex, STORES } from '../../services/database';
import './PurchaseHistoryModal.css';
import Logger from '../../services/Logger';
import { getSafeCustomerDebt, formatCustomerDebt } from '../../utils/customerUtils';
import { customerCreditRepository } from '../../services/customerCredit/customerCreditRepository';
import {
  formatMoneyValue,
  isCreditPaymentMethod,
  normalizeMoney
} from '../../services/customerMessaging';

// Iconos simples (puedes reemplazarlos por lucide-react o fontawesome si usas)
const ChevronIcon = ({ expanded }) => (
  <span className={`history-chevron ${expanded ? 'history-chevron--expanded' : ''}`}>
    ▼
  </span>
);

export default function PurchaseHistoryModal({ show, onClose, customer, isCloudCredit = false }) {
  const [sales, setSales] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  // Novedades: Filtros y Acordeón
  const [filterType, setFilterType] = useState('all'); // 'all', 'fiado', 'paid'
  const [expandedSaleId, setExpandedSaleId] = useState(null);

  const loadHistory = useCallback(async () => {
    if (!customer?.id) return;

    setLoading(true);
    try {
      const customerSales = await queryByIndex(STORES.SALES, 'customerId', customer.id);
      // Orden descendente (más reciente primero)
      const sortedSales = customerSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setSales(sortedSales);

      const summary = await customerCreditRepository.getCustomerCreditSummary(customer.id);
      const entries = summary?.ledger_entries || summary?.ledgerEntries || [];
      setLedgerEntries(Array.isArray(entries) ? entries : []);
    } catch (error) {
      Logger.error("Error cargando historial:", error);
    } finally {
      setLoading(false);
    }
  }, [customer?.id]);

  useEffect(() => {
    if (show && customer) {
      loadHistory();
    }
    // Reiniciar estados al abrir
    return () => {
      setExpandedSaleId(null);
      setFilterType('all');
    };
  }, [show, customer, loadHistory]);

  const toggleDetails = (saleId) => {
    setExpandedSaleId(prev => prev === saleId ? null : saleId);
  };

  // Filtrado en memoria
  const filteredSales = useMemo(() => {
    return sales.filter(sale => {
      if (filterType === 'fiado') return isCreditPaymentMethod(sale.paymentMethod ?? sale.payment_method);
      if (filterType === 'paid') return !isCreditPaymentMethod(sale.paymentMethod ?? sale.payment_method);
      return true;
    });
  }, [sales, filterType]);

  // Cálculos estadísticos
  const stats = useMemo(() => {
    const totalPurchases = sales.length;
    const totalAmount = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const averageTicket = totalPurchases > 0 ? totalAmount / totalPurchases : 0;
    return { totalPurchases, totalAmount, averageTicket };
  }, [sales]);

  if (!show || !customer) return null;

  return (
    <div className="ui-modal purchase-history-modal-overlay" onClick={onClose}>
      <div className="ui-modal__content history-modal-content purchase-history-modal"
        onClick={(e) => e.stopPropagation()}
      >

        {/* HEADER */}
        <div className="purchase-history-modal-header">
          <div>
            <h2 className="purchase-history-modal-title">Historial del Cliente</h2>
            <p className="purchase-history-modal-subtitle">{customer.name}</p>
          </div>
          <button className="purchase-history-close-button" onClick={onClose}>&times;</button>
        </div>

        {/* RESUMEN FINANCIERO (TARJETAS) */}
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">Total Gastado</span>
            <span className="stat-value">${stats.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Ticket Promedio</span>
            <span className="stat-value">${stats.averageTicket.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className={`stat-card ${getSafeCustomerDebt(customer.debt) > 0 ? 'debt-warning' : 'debt-clean'}`}>
            <span className="stat-label">Deuda Actual</span>
            <span className="stat-value">${formatCustomerDebt(customer.debt)}</span>
          </div>
        </div>

        {/* BARRA DE HERRAMIENTAS / FILTROS */}
        <div className="history-toolbar">
          <div className="filter-group">
            <button
              className={`filter-chip ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              Todos ({sales.length})
            </button>
            <button
              className={`filter-chip ${filterType === 'fiado' ? 'active' : ''}`}
              onClick={() => setFilterType('fiado')}
            >
              Fiados
            </button>
            <button
              className={`filter-chip ${filterType === 'paid' ? 'active' : ''}`}
              onClick={() => setFilterType('paid')}
            >
              Pagados
            </button>
          </div>
        </div>

        {(isCloudCredit || ledgerEntries.length > 0) && (
          <div className="history-toolbar history-ledger-toolbar">
            <div className="history-ledger-content">
              <strong className="history-ledger-title">
                Ledger de credito{isCloudCredit ? ' cloud' : ''}
              </strong>
              {ledgerEntries.length === 0 ? (
                <p className="history-ledger-empty">Sin movimientos de ledger registrados.</p>
              ) : (
                <div className="history-ledger-list">
                  {ledgerEntries.slice(0, 8).map((entry) => {
                    const normalizedAmount = normalizeMoney(entry.amount ?? 0);
                    const amountIsNegative = normalizedAmount.ok && normalizedAmount.amount.lt(0);
                    const createdAt = entry.created_at || entry.createdAt || entry.timestamp;
                    return (
                      <div key={entry.id} className="history-item-header history-ledger-row">
                        <div className="info-col">
                          <div className="info-top">
                            <span className="sale-id">#{String(entry.id).slice(-6)}</span>
                            <span className={`badge ${amountIsNegative ? 'badge-paid' : 'badge-fiado'}`}>
                              {entry.type || 'LEDGER'}
                            </span>
                          </div>
                          <div className="info-sub">
                            {createdAt ? new Date(createdAt).toLocaleString('es-MX') : 'Fecha no disponible'}
                            {entry.actor_name || entry.actorName ? ` - ${entry.actor_name || entry.actorName}` : ''}
                          </div>
                        </div>
                        <div className="amount-col">
                          <span className="amount">
                            {amountIsNegative ? '' : '+'}{formatMoneyValue(entry.amount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* LISTA DE COMPRAS */}
        <div className="history-list-container">
          {loading ? (
            <div className="loading-state">Cargando transacciones...</div>
          ) : filteredSales.length === 0 ? (
            <div className="empty-state">
              <p>No se encontraron movimientos con este filtro.</p>
            </div>
          ) : (
            filteredSales.map(sale => {
              const isFiado = isCreditPaymentMethod(sale.paymentMethod ?? sale.payment_method);
              const isExpanded = expandedSaleId === sale.id;
              const dateObj = new Date(sale.timestamp);

              return (
                <div
                  key={sale.id}
                  className={`history-item ${isFiado ? 'type-fiado' : 'type-sale'} ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleDetails(sale.id)}
                >
                  {/* Cabecera de la Fila (Siempre visible) */}
                  <div className="history-item-header">
                    <div className="date-col">
                      <span className="day">{dateObj.getDate()}</span>
                      <span className="month">{dateObj.toLocaleString('es-MX', { month: 'short' })}</span>
                    </div>

                    <div className="info-col">
                      <div className="info-top">
                        <span className="sale-id">#{sale.id ? sale.id.toString().slice(-4) : '---'}</span>
                        {isFiado ? (
                          <span className="badge badge-fiado">CRÉDITO</span>
                        ) : (
                          <span className="badge badge-paid">PAGADO</span>
                        )}
                      </div>
                      <div className="info-sub">
                        {sale.items.length} productos • {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <div className="amount-col">
                      <span className="amount">{formatMoneyValue(sale.total)}</span>
                      <ChevronIcon expanded={isExpanded} />
                    </div>
                  </div>

                  {/* Detalles Desplegables */}
                  {isExpanded && (
                    <div className="history-item-details" onClick={(e) => e.stopPropagation()}>
                      <div className="details-divider"></div>
                      <ul className="item-list">
                        {sale.items.map((item, idx) => (
                          <li key={`${item.id}-${idx}`} className="detail-row">
                            <span>{item.quantity}x {item.name}</span>
                            <span>{formatMoneyValue(
                              (() => {
                                const price = normalizeMoney(item.price ?? 0);
                                const quantity = normalizeMoney(item.quantity ?? 1);
                                return price.ok && quantity.ok ? price.amount.times(quantity.amount).toString() : null;
                              })()
                            )}</span>
                          </li>
                        ))}
                      </ul>

                      {isFiado && (
                        <div className="fiado-breakdown">
                          <div className="breakdown-row">
                            <span>Abono Inicial:</span>
                            <span>- {formatMoneyValue(sale.abono)}</span>
                          </div>
                          <div className="breakdown-row total-debt">
                            <span>Quedó a deber:</span>
                            <span>{formatMoneyValue(sale.saldoPendiente)}</span>
                          </div>
                        </div>
                      )}

                      <div className="details-actions">
                        {/* Aquí podrías poner botones futuros como "Reimprimir Ticket" */}
                        <small className="transaction-hash">ID: {sale.id}</small>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
