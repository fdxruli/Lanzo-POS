import React from 'react';
import './SalesHistory.css';

export default function SalesHistory({ sales, onDeleteSale }) {
  return (
    <div className="sales-history-container" style={{ display: 'flex', flexDirection: 'column', height: '500px' }}>
      <h3 className="subtitle">Historial de Ventas ({sales.length})</h3>
      
      {sales.length === 0 ? (
        <div className="empty-message">No hay ventas registradas.</div>
      ) : (
        <div style={{ flex: 1, width: '100%', overflowY: 'auto', padding: '0 10px' }}>
          {sales.map((sale) => (
            <div 
              key={sale.timestamp}
              style={{ marginBottom: '10px' }}
            >
              <div className="sale-item" style={{ flexDirection: 'column', alignItems: 'flex-start', overflow: 'hidden' }}>
                
                {/* Cabecera de la venta */}
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '5px' }}>
                  <div className="sale-date" style={{ fontWeight: 'bold' }}>
                    {new Date(sale.timestamp).toLocaleString()}
                  </div>
                  <div className="sale-total">${sale.total.toFixed(2)}</div>
                </div>

                <div className="sale-item-info" style={{ width: '100%' }}>
                  {/* Lista de Productos */}
                  <ul style={{ paddingLeft: '15px', margin: '5px 0' }}>
                    {sale.items.map(item => (
                      <li key={item.id}>
                        {item.quantity}x {item.name}
                        {item.requiresPrescription && (
                          <span style={{ color: 'var(--error-color)', fontSize: '0.75rem', marginLeft: '5px', fontWeight: 'bold' }}>
                            (Controlado)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {/* Datos de Receta Médica */}
                  {sale.prescriptionDetails && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: '#fff3cd',
                      borderRadius: '6px',
                      border: '1px solid #ffeeba',
                      fontSize: '0.85rem',
                      color: '#856404'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                        <strong>⚕️ Datos de Dispensación:</strong>
                      </div>
                      <div>Dr(a): {sale.prescriptionDetails.doctorName}</div>
                      <div>Cédula: {sale.prescriptionDetails.licenseNumber}</div>
                      {sale.prescriptionDetails.notes && (
                        <div style={{ fontStyle: 'italic', marginTop: '2px' }}>
                          Nota: {sale.prescriptionDetails.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Botón de Eliminar */}
                <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
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