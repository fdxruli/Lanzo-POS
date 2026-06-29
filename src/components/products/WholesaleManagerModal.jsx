import React, { useCallback, useState, useEffect } from 'react';
import { showMessageModal } from '../../services/utils';
import { useDismissibleHistoryLayer } from '../../hooks/useDismissibleHistoryLayer';
import './WholesaleManagerModal.css';

export default function WholesaleManagerModal({ show, onClose, tiers, onSave, basePrice }) {
  const [localTiers, setLocalTiers] = useState([]);
  const [minQty, setMinQty] = useState('');
  const [price, setPrice] = useState('');

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const dismissModal = useDismissibleHistoryLayer({
    isOpen: show,
    onDismiss: handleClose,
    layerId: 'wholesale-manager-modal'
  });

  useEffect(() => {
    if (show) {
      // Corrección de seguridad: Aseguramos que los valores sean números
      const safeTiers = (tiers || []).map(t => ({
        min: Number(t.min),
        price: Number(t.price)
      }));
      setLocalTiers(safeTiers.sort((a, b) => a.min - b.min));
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
    }

    const newTier = { min: qty, price: p };
    // Evita duplicados de cantidad
    const updated = localTiers.filter(t => t.min !== qty); 
    updated.push(newTier);
    
    setLocalTiers(updated.sort((a, b) => a.min - b.min));
    setMinQty('');
    setPrice('');
  };

  const handleRemove = (min) => {
    const updated = localTiers.filter(t => t.min !== min);
    setLocalTiers(updated);
  };

  const handleSave = () => {
    onSave(localTiers);
    dismissModal();
  };

  if (!show) return null;

  return (
    <div className="ui-modal ui-modal--high wholesale-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wholesale-modal-title">
      <div className="ui-modal__content ui-modal__content--md wholesale-modal">
        <header className="ui-modal__header">
          <div>
            <h2 id="wholesale-modal-title" className="ui-modal__title">Precios de Mayoreo</h2>
            <p className="ui-modal__subtitle modal-subtitle">Precio Base actual: ${basePrice || '0.00'}</p>
          </div>
        </header>

        {/* Formulario de ingreso */}
        <div className="ui-card ui-card--compact ui-card--flat wholesale-form-row">
          <div className="form-group">
            <label className="form-label">A partir de (Cant.)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 12"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Nuevo Precio ($)</label>
            <input 
              type="number" 
              className="form-input" 
              placeholder="Ej: 8.50"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <button type="button" className="ui-button ui-button--primary btn btn-save" onClick={handleAdd}>
            +
          </button>
        </div>

        {/* Lista de reglas */}
        <div className="tiers-list">
          {localTiers.length === 0 ? (
            <p className="ui-empty-state empty-tiers-message">No hay reglas definidas.</p>
          ) : (
            <table className="tiers-table">
              <thead>
                <tr>
                  <th>Cantidad Mín.</th>
                  <th>Precio Unitario</th>
                  <th style={{ width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {localTiers.map((tier) => (
                  <tr key={tier.min}>
                    <td>{tier.min}+</td>
                    <td className="price-cell">${Number(tier.price).toFixed(2)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        type="button"
                        className="btn-delete-tier"
                        onClick={() => handleRemove(tier.min)}
                        aria-label="Eliminar regla de mayoreo"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="modal-actions-container">
           <p className="footer-note">
             * Recuerda hacer clic en <strong>&quot;Guardar Producto&quot;</strong> al salir para aplicar los cambios.
           </p>
           <div className="ui-modal__actions modal-actions">
            <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={dismissModal}>Cancelar</button>
            <button type="button" className="ui-button ui-button--primary btn btn-save" onClick={handleSave}>Aplicar</button>
          </div>
        </div>

      </div>
    </div>
  );
}