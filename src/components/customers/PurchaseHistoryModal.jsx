import React, { useState, useEffect, useMemo } from 'react';
import { queryByIndex, STORES } from '../../services/database';
import './PurchaseHistoryModal.css';
import Logger from '../../services/Logger';

// Iconos simples (puedes reemplazarlos por lucide-react o fontawesome si usas)
const ChevronIcon = ({ expanded }) => (
  <span style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.2s', display: 'inline-block' }}>
    ▼
  </span>
);

export default function PurchaseHistoryModal({ show, onClose, customer }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Novedades: Filtros y Acordeón
  const [filterType, setFilterType] = useState('all'); // 'all', 'fiado', 'paid'
  const [expandedSaleId, setExpandedSaleId] = useState(null);

  useEffect(() => {
    if (show && customer) {
      loadHistory();
    }
    // Reiniciar estados al abrir
    return () => {
      setExpandedSaleId(null);
      setFilterType('all');
    };
  }, [show, customer]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const customerSales = await queryByIndex(STORES.SALES, 'customerId', customer.id);
      // Orden descendente (más reciente primero)
      const sortedSales = customerSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setSales(sortedSales);
    } catch (error) {
      Logger.error("Error cargando historial:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleDetails = (saleId) => {
    setExpandedSaleId(prev => prev === saleId ? null : saleId);
  };

  // Filtrado en memoria
  const filteredSales = useMemo(() => {
    return sales.filter(sale => {
      if (filterType === 'fiado') return sale.paymentMethod === 'fiado';
      if (filterType === 'paid') return sale.paymentMethod !== 'fiado';
      return true;
    });
  }, [sales, filterType]);

  // Cálculos estadísticos
  const stats = useMemo(() => {
    const totalPurchases = sales.length;
    const totalAmount = sales.reduce((sum, sale) => sum + sale.total, 0);
    const averageTicket = totalPurchases > 0 ? totalAmount / totalPurchases : 0;
    return { totalPurchases, totalAmount, averageTicket };
  }, [sales]);

  if (!show || !customer) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content history-modal-content"
      onClick={(e) => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Historial del Cliente</h2>
            <p className="modal-subtitle">{customer.name}</p>
          </div>
          <button className="btn-icon-close" onClick={onClose}>&times;</button>
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
          <div className={`stat-card ${customer.debt > 0 ? 'debt-warning' : 'debt-clean'}`}>
            <span className="stat-label">Deuda Actual</span>
            <span className="stat-value">${(customer.debt || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
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
              const isFiado = sale.paymentMethod === 'fiado';
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
                        {sale.items.length} productos • {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </div>
                    </div>

                    <div className="amount-col">
                      <span className="amount">${sale.total.toFixed(2)}</span>
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
                            <span>${(item.price * item.quantity).toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                      
                      {isFiado && (
                        <div className="fiado-breakdown">
                          <div className="breakdown-row">
                            <span>Abono Inicial:</span>
                            <span>- ${sale.abono?.toFixed(2) || '0.00'}</span>
                          </div>
                          <div className="breakdown-row total-debt">
                            <span>Quedó a deber:</span>
                            <span>${sale.saldoPendiente?.toFixed(2) || '0.00'}</span>
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