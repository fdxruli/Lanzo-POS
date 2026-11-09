import React from 'react';
import { X } from 'lucide-react';

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
        placeholder="Nombre, código o SKU..."\n        autoComplete="off"\n        aria-autocomplete="list"\n        aria-expanded={Boolean(showSuggestions && searchTerm && filteredProducts.length > 0)}\n        aria-controls="batch-product-suggestions"
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
          <X size={16} aria-hidden="true" />
        </button>
      )}

      {showSuggestions && searchTerm && filteredProducts.length > 0 && (
        <div id="batch-product-suggestions" className="product-suggestions-list" aria-label="Sugerencias de productos">
          {filteredProducts.map((product) => (
            <button
              type="button"
              key={product.id}
              className="product-suggestion-item"
              onPointerDown={(event) => {\n                event.preventDefault();\n                onSelectProduct(product);\n              }}\n              onClick={() => onSelectProduct(product)}
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
