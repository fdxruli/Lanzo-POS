import React, { useState, useEffect } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { loadData } from '../../services/database'; // Importamos tu database.js
import { STORES } from '../../services/database';
import './ProductMenu.css'

export default function ProductMenu({ onOpenScanner }) {
    // Estado local para los productos del menú
    const [products, setProducts] = useState([]);

    // 1. Obtenemos la ACCIÓN de añadir del store
    const addItemToOrder = useOrderStore((state) => state.addItem);

    // 2. Cargamos los productos al montar el componente
    useEffect(() => {
        // Esta es tu antigua 'renderMenu', ahora en React
        const fetchProducts = async () => {
            const menuData = await loadData(STORES.MENU);
            setProducts(menuData.filter(item => item.isActive !== false));
        };
        fetchProducts();
    }, []); // El array vacío significa "ejecutar 1 vez al montar"

    // 3. Función 'handler' que llama a la acción del store
    const handleProductClick = (product) => {
        // Aquí puedes poner validaciones (ej. stock) antes de llamar al store
        // ...
        // Llamamos a la acción de Zustand
        addItemToOrder(product);
    };

    return (
        <div className="pos-menu-container">
            <h3 className="subtitle">Menú de Productos</h3>

            {/* (Aquí irán tus filtros de categoría y búsqueda) */}
            <div id="category-filters" className="category-filters"></div>
            <div className="pos-controls">
                <input type="text" id="pos-product-search" className="form-input" placeholder="Buscar producto..." />
                {<button
                    id="scan-barcode-btn"
                    className="btn btn-scan"
                    title="Escanear"
                    onClick={onOpenScanner}
                >
                    📷
                </button>}
            </div>

            {/* 4. Renderizamos la lista de productos */}
            <div id="menu-items" className="menu-items-grid" aria-label="Elementos del menú">
                {products.length === 0 ? (
                    <p className="empty-message">No hay productos.</p>
                ) : (
                    products.map((item) => (
                        <div
                            key={item.id}
                            className="menu-item"
                            onClick={() => handleProductClick(item)}
                        >
                            <img className="menu-item-image" src={item.image || 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir'} alt={item.name} />
                            <h3 className="menu-item-name">{item.name}</h3>
                            <p className="menu-item-price">${item.price.toFixed(2)}</p>
                            {/* (Lógica de stock omitida por brevedad) */}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}