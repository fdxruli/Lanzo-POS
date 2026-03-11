import React from 'react';
import './SalesHistory.css';

export default function SalesHistory({ sales, onDeleteSale }) {
  return (
    // Quitamos el style inline fijo y usamos la clase para controlar la altura
    <div className="sales-history-container">
      <h3 className="subtitle">Historial de Ventas ({sales.length})</h3>

      {sales.length === 0 ? (
        <div className="empty-message">No hay ventas registradas.</div>
      ) : (
        // Agregamos la clase 'sales-history-list' aquí
        <div className="sales-history-list">
          {sales.map((sale) => (
            <div
              key={sale.timestamp}
              className="sale-card-wrapper" // Clase auxiliar para el margen
            >
              <div className="sale-item">

                {/* Cabecera de la venta */}
                <div className="sale-header">
                  <div className="sale-date">
                    {new Date(sale.timestamp).toLocaleString()}
                  </div>
                  <div className="sale-total">${sale.total.toFixed(2)}</div>
                </div>

                <div className="sale-item-info">
                  {/* Lista de Productos */}
                  <ul>
                    {sale.items.map(item => {
                      const isCostMissing = item.cost === null || item.cost === undefined;

                      return (
                        <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{item.quantity}x {item.name}</span>

                          {/* Etiqueta de Controlado */}
                          {item.requiresPrescription && (
                            <span className="prescription-tag">
                              (Controlado)
                            </span>
                          )}

                          {/* Etiqueta Crítica de Auditoría */}
                          {isCostMissing && (
                            <span
                              style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}
                              title="Este producto fue vendido sin un costo de compra registrado. La ganancia es irreal."
                            >
                              ⚠️ Sin Costo
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {/* Datos de Receta Médica */}
                  {sale.prescriptionDetails && (
                    <div className="prescription-details">
                      <div className="doc-row">
                        <strong>⚕️ Datos de Dispensación:</strong>
                      </div>
                      <div>Dr(a): {sale.prescriptionDetails.doctorName}</div>
                      <div>Cédula: {sale.prescriptionDetails.licenseNumber}</div>
                      {sale.prescriptionDetails.notes && (
                        <div className="doc-note">
                          Nota: {sale.prescriptionDetails.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Botón de Eliminar */}
                <div className="sale-actions">
                  <button
                    className="delete-order-btn"
                    onClick={() => onDeleteSale(sale.timestamp)}
                  >
                    Eliminar Venta
                  </button>
                </div>

              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}