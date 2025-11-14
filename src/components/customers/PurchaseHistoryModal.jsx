// src/components/customers/PurchaseHistoryModal.jsx
import React, { useState, useEffect } from 'react';
import { loadData, STORES } from '../../services/database';
import './PurchaseHistoryModal.css';

export default function PurchaseHistoryModal({ show, onClose, customer }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);

  // Carga el historial de ventas CADA VEZ que el 'customer' cambia
  useEffect(() => {
    if (show && customer) {
      const fetchHistory = async () => {
        setLoading(true);
        const allSales = await loadData(STORES.SALES);
        const customerSales = allSales
          .filter(sale => sale.customerId === customer.id)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setSales(customerSales);
        setLoading(false);
      };
      fetchHistory();
    }
  }, [show, customer]); // Depende de 'show' y 'customer'

  if (!show || !customer) {
    return null;
  }

  // Cálculos para el resumen
  const totalPurchases = sales.length;
  const totalAmount = sales.reduce((sum, sale) => sum + sale.total, 0);
  const averagePurchase = totalPurchases > 0 ? totalAmount / totalPurchases : 0;

  // HTML de 'purchase-history-modal'
  return (
    <div id="purchase-history-modal" className="modal" style={{ display: 'flex' }}>
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <h2 className="modal-title">Historial de Compras</h2>
        <div className="purchase-history-container">
          <h3 id="customer-history-name" className="subtitle">
            Historial de: <span>{customer.name}</span>
          </h3>
          
          <div id="purchase-history-list" className="purchase-history-list">
            {loading ? (
              <p>Cargando historial...</p>
            ) : sales.length === 0 ? (
              <p className="empty-message">No hay compras registradas.</p>
            ) : (
              sales.map(sale => (
                <div key={sale.timestamp} className="purchase-history-item">
                  <div className="purchase-history-item-header">
                    <div className="purchase-date">{new Date(sale.timestamp).toLocaleString()}</div>
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
                </div>
              ))
            )}
          </div>
          
          <div className="purchase-summary">
            <h4>Resumen</h4>
            <p>Total de compras: <span id="total-purchases">{totalPurchases}</span></p>
            <p>Monto total: <span id="total-amount">${totalAmount.toFixed(2)}</span></p>
            <p>Promedio por compra: <span id="average-purchase">${averagePurchase.toFixed(2)}</span></p>
          </div>
        </div>
        <button id="close-history-modal-btn" className="btn btn-modal" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}