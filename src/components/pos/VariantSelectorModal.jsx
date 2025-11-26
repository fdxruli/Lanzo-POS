import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import './ProductModifiersModal.css'; // Reusamos estilos de modificadores para mantener consistencia

export default function VariantSelectorModal({ show, onClose, product, onConfirm }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Store para cargar los lotes específicos de este producto
  const loadBatchesForProduct = useDashboardStore(state => state.loadBatchesForProduct);

  useEffect(() => {
    if (show && product) {
      const fetchVariants = async () => {
        setLoading(true);
        try {
          // Cargamos todos los lotes (variantes)
          const allBatches = await loadData(STORES.PRODUCT_BATCHES); // Ojo: Mejor usar la función optimizada del store si existe, pero por seguridad:
          // Usamos la función del store que ya tienes optimizada en BatchManager
          const productBatches = await loadBatchesForProduct(product.id);
          
          // Filtramos solo los que tienen stock y están activos
          const available = productBatches.filter(b => b.isActive && b.stock > 0);
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

  if (!show || !product) return null;

  const handleSelectVariant = (batch) => {
    // Construimos el objeto "Variante" para el carrito
    // Usamos el ID del lote para que el carrito los distinga (Ej: Camisa Roja vs Camisa Azul)
    
    // Formatear nombre de atributos (Ej: "Talla: M, Color: Rojo")
    const attrs = batch.attributes || {};
    const attrString = Object.values(attrs).filter(Boolean).join(' / ');
    
    const variantItem = {
      ...product,
      id: batch.id, // ¡TRUCO! Usamos el ID del lote para separar items en el carrito
      parentId: product.id, // Guardamos referencia al padre
      name: `${product.name} (${attrString || 'Estándar'})`,
      price: batch.price, // Usamos el precio específico de esta variante
      cost: batch.cost,
      stock: batch.stock, // Stock específico de esta variante
      trackStock: true,
      isVariant: true,
      batchId: batch.id // Referencia explícita para descontar stock correctamente
    };

    onConfirm(variantItem);
  };

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 2200 }}>
      <div className="modal-content modifiers-modal">
        <div className="modifiers-header">
          <h2 className="modal-title">Selecciona una Opción</h2>
          <p className="base-price-label">{product.name}</p>
        </div>

        <div className="modifiers-body">
          {loading ? (
            <p style={{textAlign: 'center', padding: '20px'}}>Cargando stock...</p>
          ) : batches.length === 0 ? (
            <div className="empty-message">⚠️ No hay variantes con stock disponible.</div>
          ) : (
            <div className="modifier-options-grid">
              {batches.map((batch) => {
                const attrs = batch.attributes || {};
                // Mostrar Talla y Color preferentemente
                const label = `${attrs.talla || ''} ${attrs.color || ''} ${attrs.modelo || ''}`.trim() || 'Estándar';
                
                return (
                  <div 
                    key={batch.id} 
                    className="modifier-option-card"
                    onClick={() => handleSelectVariant(batch)}
                  >
                    <span className="opt-name" style={{fontSize: '1.1rem', fontWeight: 'bold'}}>{label}</span>
                    {batch.sku && <small style={{color: '#666', fontSize: '0.75rem'}}>{batch.sku}</small>}
                    <div style={{marginTop: '5px', display: 'flex', gap: '10px', justifyContent: 'center'}}>
                        <span className="opt-price" style={{color: 'var(--primary-color)'}}>${batch.price.toFixed(2)}</span>
                        <span className="stock-badge" style={{fontSize: '0.8rem', background: '#e5e7eb', padding: '2px 6px', borderRadius: '4px'}}>
                            Stock: {batch.stock}
                        </span>
                    </div>
                  </div>
                );
              })}
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