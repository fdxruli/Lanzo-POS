import React from 'react';
import './SalesHistory.css'

export default function SalesHistory({ sales, onDeleteSale }) {
  return (
    <div className="sales-history-container">
      <h3 className="subtitle">Historial de Ventas</h3>
      {sales.length === 0 ? (
        <div className="empty-message">No hay ventas registradas.</div>
      ) : (
        <div id="sales-history-list" className="sales-history-list">
          {sales.map((sale) => (
            <div key={sale.timestamp} className="sale-item">
              <div className="sale-item-info">
                <p>{new Date(sale.timestamp).toLocaleString()}</p>
                <p>Total: <span className="revenue">${sale.total.toFixed(2)}</span></p>
                <ul>
                  {sale.items.map(item => (
                    <li key={item.id}>{item.name} x {item.quantity}</li>
                  ))}
                </ul>
              </div>
              <button 
                className="delete-order-btn" 
                onClick={() => onDeleteSale(sale.timestamp)}
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}