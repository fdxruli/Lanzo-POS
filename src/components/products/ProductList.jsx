import React, { useState, useMemo } from 'react';
import { getProductAlerts } from '../../services/utils';
import LazyImage from '../common/LazyImage';
import { useFeatureConfig } from '../../hooks/useFeatureConfig';
import { useDashboardStore } from '../../store/useDashboardStore';
import WasteModal from './WasteModal';
import './ProductList.css';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  const features = useFeatureConfig(); // Configuración del rubro

  // --- OPTIMIZACIÓN: Conexión al Store para Paginación y Recarga ---
  const refreshData = useDashboardStore((state) => state.loadAllData);
  const loadMoreProducts = useDashboardStore((state) => state.loadMoreProducts);
  const hasMoreProducts = useDashboardStore((state) => state.hasMoreProducts);
  const isGlobalLoading = useDashboardStore((state) => state.isLoading);

  const [searchTerm, setSearchTerm] = useState('');

  // Estados para el Modal de Merma
  const [showWaste, setShowWaste] = useState(false);
  const [productForWaste, setProductForWaste] = useState(null);

  const categoryMap = useMemo(() => {
    return new Map(categories.map(cat => [cat.id, cat.name]));
  }, [categories]);

  const filteredProducts = useMemo(() => {
    return products.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // Manejadores para Merma
  const handleOpenWaste = (product) => {
    setProductForWaste(product);
    setShowWaste(true);
  };

  const handleCloseWaste = () => {
    setProductForWaste(null);
    setShowWaste(false);
  };

  const handleWasteConfirmed = async () => {
    // Recargar los datos para que se actualice el stock en pantalla
    await refreshData(true);
  };

  if (isLoading && products.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Cargando productos...</div>;
  }

  return (
    <div className="product-list-container">
      <h3 className="subtitle">Lista de Productos</h3>

      <div className="search-container">
        <input
          type="text"
          id="product-search-input"
          className="form-input"
          placeholder="Buscar por nombre..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-message">No hay productos {searchTerm && 'que coincidan'}.</div>
      ) : (
        <>
          <div id="product-list" className="product-list">
            {filteredProducts.map(item => {
              const categoryName = categoryMap.get(item.categoryId) || 'Sin categoría';
              const isActive = item.isActive !== false;
              const { isLowStock, isNearingExpiry } = getProductAlerts(item);

              const itemClasses = [
                'product-item',
                isLowStock ? 'low-stock-warning' : '',
                isNearingExpiry ? 'nearing-expiry-warning' : ''
              ].filter(Boolean).join(' ');

              return (
                <div key={item.id} className={itemClasses}>
                  <div className={`product-status-badge ${isActive ? 'active' : 'inactive'}`}>
                    {isActive ? 'Activo' : 'Inactivo'}
                  </div>
                  <div className="product-item-info">
                    <LazyImage
                      src={item.image}
                      alt={item.name} />
                    <div className="product-item-details">
                      <span>{item.name}</span>
                      {item.sustancia && (
                        <p style={{ color: 'var(--secondary-color)', fontWeight: '500', fontSize: '0.85rem' }}>
                          💊 {item.sustancia}
                        </p>
                      )}
                      <p><strong>Categoría:</strong> {categoryName}</p>
                      <p><strong>Precio:</strong> ${item.price?.toFixed(2)}</p>
                      <p><strong>Costo:</strong> ${item.cost?.toFixed(2)}</p>
                      <p><strong>Stock:</strong> {item.trackStock ? item.stock : 'N/A'}</p>

                      {isLowStock && <span className="alert-indicator low-stock-indicator">Stock bajo</span>}
                      {isNearingExpiry && <span className="alert-indicator nearing-expiry-indicator">Próximo a caducar</span>}
                    </div>
                  </div>

                  <div className="product-item-controls">
                    {/* Botón de Estado (Activar/Desactivar) */}
                    <button
                      className={`btn-toggle-status ${isActive ? 'btn-deactivate' : 'btn-activate'}`}
                      onClick={() => onToggleStatus(item)}
                      title={isActive ? "Desactivar" : "Activar"}
                    >
                      {isActive ? 'Desactivar' : 'Activar'}
                    </button>

                    {/* Botón de Merma (Solo si el rubro lo permite, ej: Frutería) */}
                    {features.hasWaste && isActive && (
                      <button
                        className="btn-waste"
                        onClick={() => handleOpenWaste(item)}
                        title="Registrar Merma / Desperdicio"
                      >
                        Merma
                      </button>
                    )}

                    {/* Botón Editar */}
                    <button className="edit-product-btn" onClick={() => onEdit(item)} title="Editar">
                      ✏️
                    </button>

                    {/* Botón Eliminar */}
                    <button className="delete-product-btn" onClick={() => onDelete(item)} title="Eliminar">
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* --- SECCIÓN DE PAGINACIÓN --- */}
          {/* Solo mostramos el botón si NO estamos buscando (en búsqueda mostramos todo lo encontrado) y si el store dice que hay más páginas */}
          {!searchTerm && hasMoreProducts && (
            <div style={{ textAlign: 'center', marginTop: '20px', paddingBottom: '20px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => loadMoreProducts()}
                disabled={isGlobalLoading}
                style={{ minWidth: '200px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
              >
                {isGlobalLoading ? (
                  <>
                    <div className="spinner-loader small" style={{ borderWidth: '2px', width: '16px', height: '16px' }}></div>
                    Cargando...
                  </>
                ) : (
                  '⬇️ Cargar más productos'
                )}
              </button>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '5px' }}>
                Mostrando {products.length} productos
              </p>
            </div>
          )}
        </>
      )}

      {/* Renderizamos el Modal de Merma fuera del loop */}
      <WasteModal
        show={showWaste}
        onClose={handleCloseWaste}
        product={productForWaste}
        onConfirm={handleWasteConfirmed}
      />
    </div>
  );
}