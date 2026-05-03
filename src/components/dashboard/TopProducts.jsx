// src/components/dashboard/TopProducts.jsx
import React, { useMemo } from 'react';
import { Package, TrendingUp, Crown } from 'lucide-react';
import './TopProducts.css';

export default function TopProducts({ sales, limit = 5 }) {
  const topProducts = useMemo(() => {
    const productMap = new Map();

    // Agrupar productos vendidos
    sales.forEach(sale => {
      if (sale.fulfillmentStatus === 'cancelled') return;
      
      sale.items.forEach(item => {
        const id = item.parentId || item.id;
        const existing = productMap.get(id) || {
          id,
          name: item.name,
          quantity: 0,
          revenue: 0,
          image: item.image
        };

        existing.quantity += item.quantity;
        existing.revenue += (item.price || 0) * item.quantity;
        productMap.set(id, existing);
      });
    });

    // Convertir a array y ordenar por cantidad vendida
    return Array.from(productMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);
  }, [sales, limit]);

  const formatCurrency = (val) => 
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

  if (!topProducts || topProducts.length === 0) {
    return (
      <div className="top-products-empty">
        <Package size={48} strokeWidth={1.5} />
        <p>No hay productos vendidos aún</p>
        <small>Los productos más vendidos aparecerán aquí</small>
      </div>
    );
  }

  return (
    <div className="top-products-container">
      <div className="top-products-header">
        <div className="top-products-title">
          <TrendingUp size={20} />
          <h3>Productos Más Vendidos</h3>
        </div>
      </div>

      <div className="top-products-list">
        {topProducts.map((product, index) => (
          <div
            key={product.id}
            className={`top-product-item ${index === 0 ? 'top-product-gold' : ''}`}
          >
            <div className="top-product-rank">
              {index === 0 ? (
                <Crown size={20} className="crown-icon" />
              ) : (
                <span className="rank-number">#{index + 1}</span>
              )}
            </div>

            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="top-product-image"
                loading="lazy"
              />
            ) : (
              <div className="top-product-image-placeholder">
                <Package size={20} />
              </div>
            )}

            <div className="top-product-info">
              <span className="top-product-name">{product.name}</span>
              <span className="top-product-qty">{product.quantity} unid.</span>
            </div>

            <div className="top-product-revenue">
              {formatCurrency(product.revenue)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
