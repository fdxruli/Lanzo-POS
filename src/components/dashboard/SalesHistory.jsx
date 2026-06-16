// src/components/dashboard/SalesHistory.jsx
import { useState } from 'react';
import { salesRepository } from '../../services/db/sales';
import './SalesHistory.css';

export default function SalesHistory({ sales, onDeleteSale, onArchiveSale }) {
  // Estado para manejar qué padres están expandidos y la data de sus hijos
  const [expandedSplits, setExpandedSplits] = useState({});

  // Filtramos los hijos por si el componente padre (DashboardPage) sigue enviando la lista plana antigua
  const mainSales = sales.filter(sale => !sale.splitParentId);

  const toggleSplitView = async (sale) => {
    const saleId = sale.id;

    // Si ya está abierto, lo cerramos
    if (expandedSplits[saleId]) {
      const newState = { ...expandedSplits };
      delete newState[saleId];
      setExpandedSplits(newState);
      return;
    }

    // Estado inicial de carga
    setExpandedSplits(prev => ({
      ...prev,
      [saleId]: { loading: true, children: [], error: null }
    }));

    try {
      const childIds = sale.splitChildIds || [];
      const childRecords = await salesRepository.getSalesByIds(childIds);

      setExpandedSplits(prev => ({
        ...prev,
        [saleId]: { loading: false, children: childRecords, error: null }
      }));
    } catch {
      setExpandedSplits(prev => ({
        ...prev,
        [saleId]: { loading: false, children: [], error: 'Error al cargar tickets hijos' }
      }));
    }
  };

  return (
    <div className="sales-history-container">
      <h3 className="subtitle">Historial de Ventas ({mainSales.length})</h3>

      {mainSales.length === 0 ? (
        <div className="empty-message">No hay ventas registradas.</div>
      ) : (
        <div className="sales-history-list">
          {mainSales.map((sale) => {
            const isSplitParent = sale.cancelReason === 'split_settled';
            const isCancelled = sale.status === 'cancelled';
            const expandedData = expandedSplits[sale.id];

            return (
              <div key={sale.timestamp} className={`sale-card-wrapper ${isSplitParent ? 'split-parent-card' : ''}`}>
                <div className="sale-item">

                  {/* Cabecera de la venta */}
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
                    {/* Lista de Productos del Padre */}
                    {(sale.items || []).length === 0 ? (
                      <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0' }}>Sin detalle de productos</p>
                    ) : (
                      <ul>
                        {(sale.items || []).map(item => {
                          const isCostMissing = item.cost === null || item.cost === undefined;
                          return (
                            <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className={isSplitParent ? 'text-muted-strike' : ''}>
                                {item.quantity}x {item.name}
                              </span>

                              {item.requiresPrescription && (
                                <span className="prescription-tag">(Controlado)</span>
                              )}

                              {isCostMissing && !isSplitParent && (
                                <span className="warning-cost-tag" title="Vendido sin costo de compra registrado.">
                                  ⚠️ Sin Costo
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {/* Acciones y Acordeón Lazy Load */}
                  <div className="sale-actions">
                    {isSplitParent && (
                      <button
                        className="toggle-split-btn"
                        onClick={() => toggleSplitView(sale)}
                      >
                        {expandedData ? 'Ocultar Desglose ▲' : `Ver ${sale.splitChildIds?.length || 0} Pagos ▼`}
                      </button>
                    )}

                    <button
                      className="delete-order-btn"
                      onClick={() => (
                        isCancelled ? onArchiveSale(sale) : onDeleteSale(sale)
                      )}
                    >
                      {isCancelled ? 'Mover a papelera' : `Cancelar ${isSplitParent ? 'origen' : 'venta'}`}
                    </button>
                  </div>

                  {/* Renderizado del Acordeón (Tickets Hijos) */}
                  {expandedData && (
                    <div className="split-children-accordion">
                      {expandedData.loading ? (
                        <div className="split-loading">Cargando pagos...</div>
                      ) : expandedData.error ? (
                        <div className="split-error">{expandedData.error}</div>
                      ) : (
                        expandedData.children.map(child => (
                          <div key={child.id} className="split-child-card">
                            <div className="split-child-header">
                              <span className="split-child-label">{child.splitLabel || 'Pago Dividido'}</span>
                              <span className="split-child-status">{child.status.toUpperCase()}</span>
                              <strong className="split-child-total">${(Number(child.total) || 0).toFixed(2)}</strong>
                            </div>
                            <div className="split-child-items">
                              {child.items.map(ci => (
                                <div key={ci.id} className="child-item-row">
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
    </div>
  );
}
