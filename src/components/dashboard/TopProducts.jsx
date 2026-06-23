// src/components/dashboard/TopProducts.jsx
import { useMemo, useState } from 'react';
import { Package, TrendingUp, Crown, DollarSign, AlertTriangle } from 'lucide-react';
import { getLineRevenue, isMissingUnitCost, normalizeFinancialNumber } from '../../services/sales/financialPolicy';
import './TopProducts.css';

const PRODUCT_VIEWS = {
  quantity: {
    label: 'Cantidad',
    title: 'Productos mas vendidos',
    icon: TrendingUp,
    empty: 'Los productos mas vendidos apareceran aqui'
  },
  profit: {
    label: 'Utilidad',
    title: 'Top productos por utilidad',
    icon: DollarSign,
    empty: 'Aun no hay utilidad confirmada para este periodo'
  },
  lowMargin: {
    label: 'Bajo margen',
    title: 'Venden mucho, dejan poco',
    icon: AlertTriangle,
    empty: 'No hay productos de alta rotacion con margen bajo'
  }
};

const formatCurrency = (val) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);

const formatQuantity = (value) => {
  const qty = Number(value || 0);
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

const isCancelledSale = (sale = {}) => {
  const status = String(sale.status || '').toLowerCase();
  const fulfillmentStatus = String(sale.fulfillmentStatus || '').toLowerCase();
  return status === 'cancelled' || fulfillmentStatus === 'cancelled';
};

export default function TopProducts({ sales = [], limit = 5 }) {
  const [activeView, setActiveView] = useState('quantity');

  const productStats = useMemo(() => {
    const productMap = new Map();

    sales.forEach(sale => {
      if (isCancelledSale(sale) || !Array.isArray(sale.items)) return;

      sale.items.forEach(item => {
        const id = item.parentId || item.id;
        const quantity = normalizeFinancialNumber(item.quantity || 0);
        const lineRevenue = Number(getLineRevenue(item).round(2).toString());
        const rawCost = item.cost;
        const hasMissingCost = isMissingUnitCost(rawCost);
        const unitCost = normalizeFinancialNumber(rawCost);
        const existing = productMap.get(id) || {
          id,
          name: item.name,
          quantity: 0,
          revenue: 0,
          confirmedRevenue: 0,
          confirmedProfit: 0,
          missingRevenue: 0,
          image: item.image
        };

        existing.quantity += quantity;
        existing.revenue += lineRevenue;

        if (hasMissingCost) {
          existing.missingRevenue += lineRevenue;
        } else {
          existing.confirmedRevenue += lineRevenue;
          existing.confirmedProfit += lineRevenue - (unitCost * quantity);
        }

        productMap.set(id, existing);
      });
    });

    return Array.from(productMap.values()).map(product => ({
      ...product,
      marginPct: product.confirmedRevenue > 0
        ? (product.confirmedProfit / product.confirmedRevenue) * 100
        : null
    }));
  }, [sales]);

  const topProducts = useMemo(() => {
    if (activeView === 'profit') {
      return [...productStats]
        .filter(product => product.confirmedProfit > 0)
        .sort((a, b) => b.confirmedProfit - a.confirmedProfit)
        .slice(0, limit);
    }

    if (activeView === 'lowMargin') {
      return [...productStats]
        .filter(product => product.quantity > 0 && product.marginPct !== null && product.marginPct < 20)
        .sort((a, b) => (b.quantity * (20 - b.marginPct)) - (a.quantity * (20 - a.marginPct)))
        .slice(0, limit);
    }

    return [...productStats]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);
  }, [activeView, productStats, limit]);

  const activeConfig = PRODUCT_VIEWS[activeView];
  const HeaderIcon = activeConfig.icon;

  const getPrimaryValue = (product) => {
    if (activeView === 'profit') return formatCurrency(product.confirmedProfit);
    if (activeView === 'lowMargin') return `${product.marginPct.toFixed(1)}%`;
    return formatCurrency(product.revenue);
  };

  const getSecondaryValue = (product) => {
    const quantityText = `${formatQuantity(product.quantity)} unid.`;
    if (activeView === 'profit') {
      return `${quantityText} · margen ${product.marginPct !== null ? `${product.marginPct.toFixed(1)}%` : 'sin costo'}`;
    }
    if (activeView === 'lowMargin') {
      return `${quantityText} · utilidad ${formatCurrency(product.confirmedProfit)}`;
    }
    return quantityText;
  };

  return (
    <div className="top-products-container">
      <div className="top-products-header">
        <div className="top-products-title">
          <HeaderIcon size={20} />
          <h3>{activeConfig.title}</h3>
        </div>
        <div className="top-products-tabs" aria-label="Orden de productos">
          {Object.entries(PRODUCT_VIEWS).map(([key, config]) => (
            <button
              key={key}
              type="button"
              className={`top-products-tab ${activeView === key ? 'active' : ''}`}
              onClick={() => setActiveView(key)}
            >
              {config.label}
            </button>
          ))}
        </div>
      </div>

      {topProducts.length === 0 ? (
        <div className="top-products-empty">
          <Package size={48} strokeWidth={1.5} />
          <p>No hay datos suficientes</p>
          <small>{activeConfig.empty}</small>
        </div>
      ) : (
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
                <span className="top-product-qty">{getSecondaryValue(product)}</span>
                {product.missingRevenue > 0 && (
                  <span className="top-product-warning">Tiene ventas sin costo</span>
                )}
              </div>

              <div className="top-product-revenue">
                {getPrimaryValue(product)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
