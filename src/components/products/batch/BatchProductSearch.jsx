import React from 'react';

export default function BatchProductSearch({
  inputId = 'batch-product-search',
  searchTerm,
  onSearchTermChange,
  onClearSelection,
  showSuggestions,
  onSetShowSuggestions,
  filteredProducts,
  onSelectProduct
}) {
  return (
    <div className="product-selector-wrapper">
      <input
        id={inputId}
        type="text"
        className="form-input product-search-input"
        placeholder="Buscar producto..."
        value={searchTerm}
        onChange={(event) => {
          onSearchTermChange(event.target.value);
          onSetShowSuggestions(true);
        }}
        onFocus={() => onSetShowSuggestions(true)}
        onBlur={() => setTimeout(() => onSetShowSuggestions(false), 200)}
      />

      {searchTerm && (
        <button
          type="button"
          className="btn-clear-search"
          aria-label="Limpiar busqueda de producto"
          onClick={onClearSelection}
        >
          x
        </button>
      )}

      {showSuggestions && searchTerm && (
        <div className="product-suggestions-list" aria-label="Sugerencias de productos">
          {filteredProducts.map((product) => (
            <button
              type="button"
              key={product.id}
              className="product-suggestion-item"
              onMouseDown={() => onSelectProduct(product)}
            >
              <span className="suggestion-name">{product.name}</span>
              <span className="suggestion-meta">Stock: {product.stock || 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
