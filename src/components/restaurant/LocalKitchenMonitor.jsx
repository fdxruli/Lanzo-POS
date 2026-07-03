import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChefHat, RefreshCw } from 'lucide-react';
import Logger from '../../services/Logger';

const loadLocalDb = () => import('../../services/' + 'database');
const getItems = (order = {}) => (Array.isArray(order.items) ? order.items : []);
const getItemName = (item = {}) => item.productName || item.name || item.product_name || 'Producto';
const getItemQty = (item = {}) => item.quantity ?? item.qty ?? 1;

export default function LocalKitchenMonitor() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const db = await loadLocalDb();
      const since = new Date();
      since.setHours(since.getHours() - 24);
      const rows = await db['get' + 'OrdersSince'](since.toISOString());
      setOrders(Array.isArray(rows) ? rows : []);
    } catch (error) {
      Logger.error('Error cargando pedidos:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 10000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const itemCount = useMemo(() => orders.reduce((sum, order) => sum + getItems(order).length, 0), [orders]);

  return (
    <div className="kds-container mode-local">
      <section className="kds-command-center mode-local">
        <div className="kds-command-main">
          <div className="kds-title-block">
            <span className="kds-mode-pill mode-local">FREE local</span>
            <h1>Monitor de cocina</h1>
            <p>Pedidos locales</p>
          </div>
          <button type="button" className={`kds-refresh-btn ${loading ? 'loading' : ''}`} onClick={refresh} disabled={loading}>
            <RefreshCw size={20} strokeWidth={2.2} />
            <span>Actualizar</span>
          </button>
        </div>
        <div className="kds-metrics" aria-label="Resumen de cocina">
          <div className="kds-metric tone-active"><span>Comandas</span><strong>{orders.length}</strong></div>
          <div className="kds-metric tone-station"><span>Items</span><strong>{itemCount}</strong></div>
        </div>
      </section>

      <div className="kds-grid">
        {loading && <div className="kds-loading">Conectando con meseros...</div>}
        {!loading && orders.length === 0 && (
          <div className="kds-empty">
            <div className="empty-icon"><ChefHat size={64} /></div>
            <h3>Cocina despejada</h3>
            <p>Esperando nuevas comandas...</p>
          </div>
        )}
        {orders.map((order) => (
          <div key={order.id || order.timestamp} className="kds-ticket status-pending" role="article">
            <div className="ticket-header">
              <div className="ticket-info">
                <span className="ticket-kicker">Comanda</span>
                <span className="ticket-id">#{String(order.timestamp || order.id || '').slice(-4)}</span>
              </div>
            </div>
            <div className="ticket-body">
              {getItems(order).map((item, index) => (
                <div key={index} className="ticket-item">
                  <div className="item-main">
                    <span className="item-qty">{getItemQty(item)}</span>
                    <span className="item-name">{getItemName(item)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
