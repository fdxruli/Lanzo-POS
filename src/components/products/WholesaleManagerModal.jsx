// src/components/products/WholesaleManagerModal.jsx
import React, { useState, useEffect } from 'react';
import { showMessageModal } from '../../services/utils';
import './WholesaleManagerModal.css'; // (Asegúrate de crear este archivo CSS o reutilizar estilos)

export default function WholesaleManagerModal({ show, onClose, tiers, onSave, basePrice }) {
  const [localTiers, setLocalTiers] = useState([]);
  const [minQty, setMinQty] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (show) {
      // Ordenar los niveles existentes por cantidad
      setLocalTiers([...(tiers || [])].sort((a, b) => a.min - b.min));
      setMinQty('');
      setPrice('');
    }
  }, [show, tiers]);

  const handleAdd = () => {
    const qty = parseFloat(minQty);
    const p = parseFloat(price);

    if (!qty || !p || qty <= 1) {
      showMessageModal('Ingresa una cantidad mayor a 1 y un precio válido.');
      return;
    }
    
    if (basePrice && p >= basePrice) {
      showMessageModal(`Advertencia: El precio de mayoreo ($${p}) debería ser menor al precio base ($${basePrice}).`);
      // No retornamos, permitimos agregarlo, pero advertimos.
    }

    const newTier = { min: qty, price: p };
    
    // Evitar duplicados de cantidad
    const updated = localTiers.filter(t => t.min !== qty);
    updated.push(newTier);
    
    // Reordenar
    setLocalTiers(updated.sort((a, b) => a.min - b.min));
    setMinQty('');
    setPrice('');
  };

  const handleRemove = (min) => {
    setLocalTiers(localTiers.filter(t => t.min !== min));
  };

  const handleSave = () => {
    onSave(localTiers);
    onClose();
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <h2 className="modal-title">Precios de Mayoreo</h2>
        <p className="modal-subtitle">Precio Base actual: ${basePrice || '0.00'}</p>

        <div className="wholesale-form-row" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label style={{fontSize: '0.85rem'}}>A partir de (Cant.)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 12"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label style={{fontSize: '0.85rem'}}>Nuevo Precio ($)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 8.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-save" style={{ marginBottom: 0, width: 'auto' }} onClick={handleAdd}>
            +
          </button>
        </div>

        <div className="tiers-list" style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px' }}>
          {localTiers.length === 0 ? (
            <p style={{ padding: '1rem', textAlign: 'center', color: '#999' }}>No hay reglas definidas.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: '#f9f9f9' }}>
                <tr>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Cantidad Mín.</th>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Precio Unitario</th>
                  <th style={{ padding: '8px', width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {localTiers.map((tier) => (
                  <tr key={tier.min} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{tier.min}+</td>
                    <td style={{ padding: '8px', fontWeight: 'bold', color: 'var(--success-color)' }}>${tier.price.toFixed(2)}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <button 
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error-color)' }}
                        onClick={() => handleRemove(tier.min)}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-save" onClick={handleSave}>Guardar Reglas</button>
        </div>
      </div>
    </div>
  );
}