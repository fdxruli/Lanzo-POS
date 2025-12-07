// src/components/customers/PurchaseHistoryModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, queryByIndex, STORES } from '../../services/database';
import './PurchaseHistoryModal.css';

export default function PurchaseHistoryModal({ show, onClose, customer }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (show && customer) {
      const fetchHistory = async () => {
        setLoading(true);
        try {
          // --- CÓDIGO CORREGIDO ---
          // En lugar de cargar TODO (loadData), usamos el índice específico
          // Esto buscará solo las ventas donde customerId coincida
          const customerSales = await queryByIndex(STORES.SALES, 'customerId', customer.id);

          // Ordenamos en memoria (esto es rápido porque son pocas ventas por cliente)
          const sortedSales = customerSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

          setSales(sortedSales);
        } catch (error) {
          console.error("Error cargando historial:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchHistory();
    }
  }, [show, customer]);

  if (!show || !customer) {
    return null;
  }

  const totalPurchases = sales.length;
  const totalAmount = sales.reduce((sum, sale) => sum + sale.total, 0);
  const averagePurchase = totalPurchases > 0 ? totalAmount / totalPurchases : 0;

  // 1. Obtenemos la deuda actual (puede estar desactualizada si se abona
  //    mientras el modal está abierto, pero es suficiente para visualización)
  const currentDebt = customer.debt || 0;

  return (
    <div id="purchase-history-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <h2 className="modal-title">Historial de Compras</h2>
        <div className="purchase-history-container">
          <h3 id="customer-history-name" className="subtitle">
            Historial de: <span>{customer.name}</span>
          </h3>

          {/* 2. NUEVO: Resumen de Deuda */}
          {currentDebt > 0 && (
            <div className="debt-summary-box">
              <p>Deuda Pendiente Actual:</p>
              <span>${currentDebt.toFixed(2)}</span>
            </div>
          )}

          <div id="purchase-history-list" className="purchase-history-list">
            {loading ? (
              <p>Cargando historial...</p>
            ) : sales.length === 0 ? (
              <p className="empty-message">No hay compras registradas.</p>
            ) : (
              sales.map(sale => {
                // 3. Verificamos si la venta fue fiada
                const isFiado = sale.paymentMethod === 'fiado';
                const itemClasses = `purchase-history-item ${isFiado ? 'sale-fiado' : ''}`;

                return (
                  <div key={sale.timestamp} className={itemClasses}>
                    <div className="purchase-history-item-header">
                      <div className="purchase-date">
                        {new Date(sale.timestamp).toLocaleString()}
                        {/* 4. Etiqueta de "Fiado" */}
                        {isFiado && <span className="fiado-tag">Venta Fiada</span>}
                      </div>
                      <div className="purchase-total">${sale.total.toFixed(2)}</div>
                    </div>
                    <ul className="purchase-items-container">
                      {sale.items.map(item => (
                        <li key={item.id} className="purchase-item">
                          <span className="purchase-item-name">{item.name}</span>
                          <span className="purchase-item-quantity">x{item.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    {/* 5. Detalles del pago fiado */}
                    {isFiado && (
                      <div className="fiado-details">
                        <p>Abono inicial: ${sale.abono.toFixed(2)}</p>
                        <p>Deuda generada: ${sale.saldoPendiente.toFixed(2)}</p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="purchase-summary">
            <h4>Resumen General</h4>
            <p>Total de compras: <span id="total-purchases">{totalPurchases}</span></p>
            <p>Monto total: <span id="total-amount">${totalAmount.toFixed(2)}</span></p>
            <p>Promedio por compra: <span id="average-purchase">${averagePurchase.toFixed(2)}</span></p>
          </div>
        </div>
        <button id="close-history-modal-btn" className="btn btn-cancel" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}