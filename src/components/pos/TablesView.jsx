import { useEffect, useState, useMemo } from 'react';
import { db, STORES } from '../../services/db';
import { SALE_STATUS } from '../../services/sales/financialStats';
import './TablesView.css';

const getTableLabel = (order) => {
  const tableName = typeof order?.tableData === 'string' ? order.tableData.trim() : '';
  if (tableName) return tableName;

  const orderId = String(order?.id || '');
  const shortId = orderId.slice(-6) || 'N/A';
  return `Orden #${shortId}`;
};

const formatOrderDate = (value) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return parsed.toLocaleString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
};

const getItemsCount = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.length;
};

const TableCard = ({ order, onSelectOrder, onCheckoutOrder, onSplitOrder }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const items = Array.isArray(order.items) ? order.items : [];

  const handleToggleAccordion = (e) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="table-card">
      {/* ERROR CORREGIDO: Se eliminó el onClick del body para evitar toques accidentales al hacer scroll en móvil */}
      <div className="table-card-body">
        <div className="table-card-title">
          <h3>{getTableLabel(order)}</h3>
          <span className="table-time">{formatOrderDate(order.updatedAt || order.timestamp)}</span>
        </div>
        <div className="table-card-stats">
          <div className="stat-item">
            <span className="stat-label">Items</span>
            <span className="stat-value">{getItemsCount(order.items)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total</span>
            <span className="stat-value total-highlight">${formatCurrency(order.total)}</span>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <button
          type="button"
          className="btn-accordion-toggle"
          onClick={handleToggleAccordion}
        >
          {isExpanded ? 'Ocultar productos ▲' : 'Ver productos ▼'}
        </button>
      )}

      <div className={`table-card-accordion ${isExpanded ? 'expanded' : ''}`}>
        <div className="accordion-items-list">
          {items.map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="accordion-item-row">
              <span className="item-qty">{item.quantity}x</span>
              <span className="item-name">{item.name}</span>
              <span className="item-price">${formatCurrency(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="table-card-actions">
        <button
          type="button"
          className="btn-quick-edit" 
          onClick={(e) => {
            e.stopPropagation();
            onSelectOrder?.(order.id);
          }}
        >
          Editar / Añadir
        </button>

        <button
          type="button"
          className="btn-quick-split"
          onClick={(e) => {
            e.stopPropagation();
            onSplitOrder?.(order);
          }}
        >
          Separar
        </button>
        <button
          type="button"
          className="btn-quick-checkout"
          onClick={(e) => {
            e.stopPropagation();
            onCheckoutOrder?.(order);
          }}
        >
          Cobrar
        </button>
      </div>
    </div>
  );
};

export default function TablesView({
  show,
  onClose,
  onSelectOrder,
  onCheckoutOrder,
  onSplitOrder
}) {
  const [openOrders, setOpenOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!show) {
      setSearchTerm('');
      return undefined;
    }

    let isActive = true;

    const fetchOpenOrders = async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const rows = await db
          .table(STORES.SALES)
          .where('status')
          .equals(SALE_STATUS.OPEN)
          .toArray();

        rows.sort((left, right) => {
          const leftDate = new Date(left?.updatedAt || left?.timestamp || 0).getTime();
          const rightDate = new Date(right?.updatedAt || right?.timestamp || 0).getTime();
          return rightDate - leftDate;
        });

        if (isActive) setOpenOrders(rows);
      } catch (error) {
        if (isActive) {
          setOpenOrders([]);
          setErrorMessage(error?.message || 'Error al cargar las mesas activas.');
        }
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    fetchOpenOrders();

    return () => {
      isActive = false;
    };
  }, [show]);

  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return openOrders;
    const lowerSearch = searchTerm.toLowerCase();
    return openOrders.filter(order =>
      getTableLabel(order).toLowerCase().includes(lowerSearch)
    );
  }, [openOrders, searchTerm]);

  // ERROR CORREGIDO: Interceptores para obligar al cierre del modal tras elegir una acción.
  const handleSelectAndClose = (orderId) => {
    onSelectOrder?.(orderId);
    onClose?.(); 
  };

  const handleCheckoutAndClose = (order) => {
    onCheckoutOrder?.(order);
    onClose?.();
  };

  const handleSplitAndClose = (order) => {
    onSplitOrder?.(order);
    onClose?.();
  };

  if (!show) return null;

  return (
    <div className="modal tables-modal-overlay" onClick={onClose}>
      <div
        className="modal-content tables-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tables-header">
          <div className="tables-header-info">
            <h2>Mesas activas ({filteredOrders.length})</h2>
            <div className="tables-search-container">
              <input
                type="text"
                placeholder="Buscar mesa u orden..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="tables-search-input"
              />
            </div>
          </div>
          <button type="button" className="btn-cancel" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {isLoading && <div className="tables-loading">Cargando mesas...</div>}
        {!isLoading && errorMessage && <div className="tables-error">{errorMessage}</div>}
        {!isLoading && !errorMessage && openOrders.length === 0 && (
          <div className="tables-empty">No hay mesas activas en este momento.</div>
        )}
        {!isLoading && !errorMessage && openOrders.length > 0 && filteredOrders.length === 0 && (
          <div className="tables-empty">No se encontraron mesas con esa búsqueda.</div>
        )}

        {!isLoading && !errorMessage && filteredOrders.length > 0 && (
          <div className="tables-grid">
            {filteredOrders.map((order) => (
              <TableCard
                key={order.id}
                order={order}
                onSelectOrder={handleSelectAndClose}
                onCheckoutOrder={handleCheckoutAndClose}
                onSplitOrder={handleSplitAndClose}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}