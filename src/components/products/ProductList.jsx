import React, { useState, useMemo } from 'react';
import './ProductList.css'

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export default function ProductList({ products, categories, isLoading, onEdit, onDelete, onToggleStatus }) {
  
  const [searchTerm, setSearchTerm] = useState('');

  // Creamos un "mapa" de categorías para buscarlas rápido
  const categoryMap = useMemo(() => {
    return new Map(categories.map(cat => [cat.id, cat.name]));
  }, [categories]);

  // Filtramos la lista basado en la búsqueda
  const filteredProducts = useMemo(() => {
    return products.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // Lógica de 'renderProductManagement' de app.js
  if (isLoading) {
    return <div>Cargando productos...</div>;
  }
  
  // HTML de 'view-products-content'
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
        <div id="product-list" className="product-list">
          {filteredProducts.map(item => {
            const categoryName = categoryMap.get(item.categoryId) || 'Sin categoría';
            const isActive = item.isActive !== false;
            
            return (
              <div key={item.id} className="product-item">
                <div className={`product-status-badge ${isActive ? 'active' : 'inactive'}`}>
                  {isActive ? 'Activo' : 'Inactivo'}
                </div>
                <div className="product-item-info">
                  <img src={item.image || defaultPlaceholder} alt={item.name} />
                  <div className="product-item-details">
                    <span>{item.name}</span>
                    <p><strong>Categoría:</strong> {categoryName}</p>
                    <p><strong>Precio:</strong> ${item.price?.toFixed(2)}</p>
                    <p><strong>Costo:</strong> ${item.cost?.toFixed(2)}</p>
                    <p><strong>Stock:</strong> {item.trackStock ? item.stock : 'N/A'}</p>
                  </div>
                </div>
                <div className="product-item-controls">
                  <button 
                    className={`btn-toggle-status ${isActive ? 'btn-deactivate' : 'btn-activate'}`}
                    onClick={() => onToggleStatus(item)}
                  >
                    {isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="edit-product-btn" onClick={() => onEdit(item)}>
                    ✏️
                  </button>
                  <button className="delete-product-btn" onClick={() => onDelete(item)}>
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}