// src/components/dashboard/RestockSuggestions.jsx
import React, { useMemo } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { showMessageModal } from '../../services/utils';
import { Clipboard, Truck, AlertTriangle } from 'lucide-react';

export default function RestockSuggestions() {
  const getLowStockProducts = useProductStore(state => state.getLowStockProducts);
  
  // Obtenemos los productos calculados
  const lowStockItems = useMemo(() => getLowStockProducts(), [getLowStockProducts]);

  // Agrupamos por proveedor para facilitar los pedidos
  const groupedBySupplier = useMemo(() => {
    const groups = {};
    lowStockItems.forEach(item => {
      const sup = item.supplierName;
      if (!groups[sup]) groups[sup] = [];
      groups[sup].push(item);
    });
    return groups;
  }, [lowStockItems]);

  const handleCopyList = (supplierName, items) => {
    let text = `📋 *PEDIDO PARA: ${supplierName.toUpperCase()}*\n\n`;
    items.forEach(item => {
      text += `- ${item.suggestedOrder} ${item.unit} de ${item.name} (Stock actual: ${item.currentStock})\n`;
    });
    text += `\nGenerado por Lanzo POS`;

    navigator.clipboard.writeText(text)
      .then(() => showMessageModal('✅ Lista copiada al portapapeles. Pégala en WhatsApp.'))
      .catch(() => showMessageModal('Error al copiar.', null, { type: 'error' }));
  };

  if (lowStockItems.length === 0) {
    return (
      <div style={{ 
        padding: '3rem', textAlign: 'center', backgroundColor: 'var(--card-background-color)', 
        borderRadius: '16px', border: '1px dashed var(--success-color)' 
      }}>
        <Truck size={48} color="var(--success-color)" style={{ marginBottom: '1rem', opacity: 0.5 }} />
        <h3>¡Todo en Orden!</h3>
        <p style={{ color: 'var(--text-light)' }}>Tu inventario está saludable. No hay productos por debajo del mínimo.</p>
      </div>
    );
  }

  return (
    <div className="restock-container">
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <AlertTriangle color="var(--warning-color)" />
        <h3 className="subtitle" style={{ margin: 0 }}>Sugerencias de Compra ({lowStockItems.length} productos)</h3>
      </div>

      <div className="restock-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {Object.entries(groupedBySupplier).map(([supplier, items]) => (
          <div key={supplier} style={{ 
            backgroundColor: 'var(--card-background-color)', 
            borderRadius: '12px', 
            padding: '1.5rem',
            boxShadow: 'var(--box-shadow)',
            borderTop: '4px solid var(--secondary-color)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h4 style={{ margin: 0, color: 'var(--text-dark)' }}>{supplier}</h4>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                onClick={() => handleCopyList(supplier, items)}
              >
                <Clipboard size={14} /> Copiar Lista
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-light)', borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '5px' }}>Producto</th>
                  <th style={{ textAlign: 'center', padding: '5px' }}>Stock</th>
                  <th style={{ textAlign: 'right', padding: '5px', color: 'var(--primary-color)' }}>Pedir</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 5px', fontWeight: '500' }}>{item.name}</td>
                    <td style={{ textAlign: 'center', color: 'var(--error-color)', fontWeight: 'bold' }}>
                      {item.currentStock} <span style={{fontSize:'0.7em', fontWeight:'normal', color:'#999'}}>min:{item.minStock}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: '800', color: 'var(--primary-color)' }}>
                      {item.suggestedOrder} {item.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}