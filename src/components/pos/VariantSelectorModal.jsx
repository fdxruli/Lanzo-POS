import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore'; 
import { useInventoryMovement } from '../../hooks/useInventoryMovement';
import './VariantSelectorModal.css'; 
import Logger from '../../services/Logger';

// Iconos SVG
const SearchIcon = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
const TagIcon = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;
const RulerIcon = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12h20"/><path d="M6 12v-3"/><path d="M10 12v-4"/><path d="M14 12v-3"/><path d="M18 12v-4"/></svg>;
const MapPinIcon = () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>;

export default function VariantSelectorModal({ show, onClose, product, onConfirm }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { loadBatchesForProduct } = useInventoryMovement();
  const companyProfile = useAppStore(state => state.companyProfile);

  // --- CORRECCIÓN AQUÍ ---
  // Determinar si debemos mostrar ubicación (Solo Abarrotes y Ferretería)
  const showLocation = useMemo(() => {
    // Obtenemos el valor crudo
    const rawType = companyProfile?.business_type;
    
    // Convertimos explícitamente a String para evitar el crash si es null, undefined o número
    const type = rawType ? String(rawType).toLowerCase() : ''; 
    
    return type.includes('abarrote') || type.includes('ferreter') || type.includes('grocery') || type.includes('hardware');
  }, [companyProfile]);

  useEffect(() => {
    if (show && product) {
      const fetchVariants = async () => {
        setLoading(true);
        try {
          const productBatches = await loadBatchesForProduct(product.id);
          // Filtramos solo los activos con stock positivo
          const available = (productBatches || []).filter(b => b.isActive && b.stock > 0);
          setBatches(available);
        } catch (error) {
          Logger.error("Error cargando variantes:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchVariants();
      setSearchTerm(''); // Resetear búsqueda al abrir
    }
  }, [show, product, loadBatchesForProduct]);

  // --- LÓGICA DE AGRUPACIÓN POR COLOR ---
  const groupedByColor = useMemo(() => {
    const colorGroups = {};

    batches.forEach(batch => {
        const attrs = batch.attributes || {};
        
        // Extracción segura de atributos
        const talla = (attrs.talla || attrs.modelo || 'UNIT').trim().toUpperCase();
        let color = (attrs.color || attrs.marca || 'Estándar').trim();
        // Capitalizar primera letra del color
        color = color.charAt(0).toUpperCase() + color.slice(1);
        
        const location = batch.location || ''; 

        // Filtro de búsqueda
        const searchString = `${talla} ${color} ${batch.sku || ''} ${location}`.toLowerCase();
        if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) {
            return;
        }

        if (!colorGroups[color]) {
            colorGroups[color] = [];
        }

        colorGroups[color].push({
            ...batch,
            displayTalla: talla,
            displayColor: color,
            displayLocation: location,
            stockState: getStockState(batch.stock)
        });
    });

    // Ordenar tallas
    Object.keys(colorGroups).forEach(c => {
        colorGroups[c].sort((a, b) => {
            const numA = parseFloat(a.displayTalla);
            const numB = parseFloat(b.displayTalla);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.displayTalla.localeCompare(b.displayTalla);
        });
    });

    return colorGroups;
  }, [batches, searchTerm]);

  function getStockState(stock) {
      if (stock <= 2) return 'critical';
      if (stock <= 5) return 'low';
      return 'good';
  }

  if (!show || !product) return null;

  const handleSelectVariant = (batch) => {
    const variantItem = {
      ...product,
      id: batch.id,
      parentId: product.id, 
      name: `${product.name} (${batch.displayColor} ${batch.displayTalla})`,
      price: batch.price, 
      cost: batch.cost,
      stock: batch.stock,
      trackStock: true,
      isVariant: true,
      batchId: batch.id,
      sku: batch.sku 
    };
    onConfirm(variantItem);
  };

  const hasVariants = Object.keys(groupedByColor).length > 0;

  return (
    <div className="modal-backdrop">
      <div className="modal-content variant-modal">
        
        {/* HEADER */}
        <div className="variant-header">
          <div className="header-info">
             <h2 className="product-title">{product.name}</h2>
             <span className="product-base-price">Precio Base: ${product.price.toFixed(2)}</span>
          </div>
          <button className="btn-close-x" onClick={onClose}>&times;</button>
        </div>

        {/* SEARCH BAR */}
        {!loading && batches.length > 5 && (
            <div className="variant-search-bar">
                <SearchIcon />
                <input 
                    type="text" 
                    placeholder="Buscar talla, color o SKU..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                />
            </div>
        )}

        {/* BODY */}
        <div className="variant-body">
          {loading ? (
            <div className="loading-state">
                <div className="spinner"></div>
                <p>Buscando inventario...</p>
            </div>
          ) : !hasVariants ? (
            <div className="empty-state">
                <p>⚠️ No hay variantes disponibles con stock.</p>
                {searchTerm && <button className="btn-link" onClick={()=>setSearchTerm('')}>Limpiar búsqueda</button>}
            </div>
          ) : (
            <div className="color-groups-container">
              {Object.entries(groupedByColor).map(([colorName, variants]) => (
                <div key={colorName} className="color-group">
                    <div className="color-header">
                        <span className="color-dot" style={{backgroundColor: getColorHex(colorName)}}></span>
                        <h3 className="color-title">{colorName}</h3>
                        <span className="variant-count">{variants.length}</span>
                    </div>
                    
                    <div className="sizes-grid">
                        {variants.map((variant) => (
                            <button 
                                key={variant.id} 
                                className={`size-card stock-${variant.stockState}`}
                                onClick={() => handleSelectVariant(variant)}
                            >
                                <div className="card-top">
                                    <span className="size-label">
                                        <RulerIcon /> {variant.displayTalla}
                                    </span>
                                    <span className="price-label">${variant.price.toFixed(2)}</span>
                                </div>
                                
                                <div className="card-details">
                                    <small className="sku-text"><TagIcon /> {variant.sku || '---'}</small>
                                    
                                    {/* Mostrar ubicación solo si es Abarrotes/Ferretería y tiene dato */}
                                    {showLocation && variant.displayLocation && (
                                        <small className="location-text"><MapPinIcon /> {variant.displayLocation}</small>
                                    )}
                                </div>

                                <div className="card-bottom">
                                   <div className={`stock-pill ${variant.stockState}`}>
                                        {variant.stock} disponibles
                                   </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="variant-footer">
          <button className="btn btn-secondary full-width" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper visual para colores (sin cambios)
function getColorHex(name) {
    const map = {
        'negro': '#1a1a1a', 'black': '#1a1a1a',
        'blanco': '#f5f5f5', 'white': '#f5f5f5',
        'rojo': '#ef4444', 'red': '#ef4444',
        'azul': '#3b82f6', 'blue': '#3b82f6',
        'verde': '#22c55e', 'green': '#22c55e',
        'amarillo': '#eab308', 'yellow': '#eab308',
        'rosa': '#ec4899', 'pink': '#ec4899',
        'gris': '#6b7280', 'gray': '#6b7280',
        'naranja': '#f97316', 'orange': '#f97316',
        'morado': '#a855f7', 'purple': '#a855f7',
        'cafe': '#78350f', 'brown': '#78350f',
        'beige': '#f5f5dc'
    };
    const key = name.toLowerCase().split(' ')[0]; 
    return map[key] || '#cbd5e1'; 
}
