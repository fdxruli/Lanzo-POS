// src/components/pos/VariantSelectorModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
// CAMBIO: Importamos el store correcto
import { useProductStore } from '../../store/useProductStore';
import './ProductModifiersModal.css'; 

export default function VariantSelectorModal({ show, onClose, product, onConfirm }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // CAMBIO: Usamos el selector del store de productos
  const loadBatchesForProduct = useProductStore(state => state.loadBatchesForProduct);

  useEffect(() => {
    if (show && product) {
      const fetchVariants = async () => {
        setLoading(true);
        try {
          const productBatches = await loadBatchesForProduct(product.id);
          
          // Filtramos solo los activos con stock
          const available = (productBatches || []).filter(b => b.isActive && b.stock > 0);
          setBatches(available);
        } catch (error) {
          console.error("Error cargando variantes:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchVariants();
    }
  }, [show, product, loadBatchesForProduct]);

  // --- LÓGICA DE AGRUPACIÓN (Se mantiene igual) ---
  const groupedVariants = useMemo(() => {
    const groups = {};

    batches.forEach(batch => {
        const attrs = batch.attributes || {};
        // Normalizamos a minúsculas para que "Azul" y "azul" sean lo mismo
        const t1 = (attrs.talla || attrs.modelo || '').trim();
        const t2 = (attrs.color || attrs.marca || '').trim();
        
        // Creamos una clave única, ej: "29-azul"
        const key = `${t1}-${t2}`.toLowerCase();

        if (!groups[key]) {
            // Si es el primero que encontramos, lo guardamos como base
            groups[key] = {
                ...batch, // Copiamos datos del lote
                displayLabel: `${t1} ${t2}`, // Etiqueta bonita
                totalStock: 0,
                // Guardamos referencia al lote más antiguo (FIFO) para usar su ID y Precio
                fifoBatchId: batch.id, 
                fifoPrice: batch.price
            };
        }

        // Sumamos el stock de este lote al grupo
        groups[key].totalStock += batch.stock;
    });

    // Convertimos el objeto de grupos de vuelta a un array
    return Object.values(groups);
  }, [batches]);

  if (!show || !product) return null;

  const handleSelectVariant = (groupItem) => {
    // Al seleccionar, usamos el ID del lote base (FIFO) pero mostramos que hay stock disponible
    
    const variantItem = {
      ...product,
      id: groupItem.fifoBatchId, // Usamos el ID real de un lote para que el sistema sepa qué descontar
      parentId: product.id, 
      name: `${product.name} (${groupItem.displayLabel})`,
      price: groupItem.fifoPrice, 
      cost: groupItem.cost,
      stock: groupItem.totalStock, // Pasamos el stock TOTAL sumado
      trackStock: true,
      isVariant: true,
      batchId: groupItem.fifoBatchId 
    };

    onConfirm(variantItem);
  };

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 1100 }}>
      <div className="modal-content modifiers-modal">
        <div className="modifiers-header">
          <h2 className="modal-title">Selecciona una Opción</h2>
          <p className="base-price-label">{product.name}</p>
        </div>

        <div className="modifiers-body">
          {loading ? (
            <p style={{textAlign: 'center', padding: '20px'}}>Cargando stock...</p>
          ) : groupedVariants.length === 0 ? (
            <div className="variant-empty-state">
                ⚠️ No hay variantes con stock disponible.
            </div>
          ) : (
            <div className="modifier-options-grid">
              {groupedVariants.map((group, idx) => (
                <div 
                  key={idx} 
                  className="modifier-option-card"
                  onClick={() => handleSelectVariant(group)}
                >
                  <span className="opt-name" style={{fontSize: '1.1rem', fontWeight: 'bold', textTransform: 'capitalize'}}>
                    {group.displayLabel || 'Estándar'}
                  </span>
                  
                  {group.sku && <small style={{color: '#666', fontSize: '0.75rem'}}>{group.sku}</small>}
                  
                  <div style={{marginTop: '5px', display: 'flex', gap: '10px', justifyContent: 'center'}}>
                      <span className="opt-price" style={{color: 'var(--primary-color)'}}>
                        ${group.fifoPrice.toFixed(2)}
                      </span>
                      <span className="stock-badge" style={{fontSize: '0.8rem', background: '#e5e7eb', padding: '2px 6px', borderRadius: '4px'}}>
                          Stock: {group.totalStock}
                      </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modifiers-footer">
          <button className="btn btn-cancel" style={{width: '100%'}} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}