import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useInventoryMovement } from '../../hooks/useInventoryMovement';
import { getExpiringProductsReport } from '../../services/inventoryAnalysis';
import './ExpirationAlert.css';

export default function ExpirationAlert() {
  const { updateProductBatch, removeProductBatch } = useInventoryMovement();
  const companyProfile = useAppStore((state) => state.companyProfile);

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [newDate, setNewDate] = useState('');

  const refreshAlerts = useCallback(async () => {
    setLoading(true);
    const data = await getExpiringProductsReport({ daysThreshold: 45 });
    setAlerts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshAlerts();
    }, 0);

    return () => clearTimeout(timer);
  }, [refreshAlerts]);

  const handleIgnore = (id) => {
    setDismissedIds((prev) => [...prev, id]);
  };

  const handleDelete = async (item) => {
    if (item.type !== 'Lote') {
      alert('Solo los lotes pueden eliminarse desde este panel.');
      return;
    }

    if (window.confirm(`¿Estás seguro de eliminar el lote ${item.batchSku} de ${item.productName}?`)) {
      try {
        await removeProductBatch(item.productId, item.id);
        await refreshAlerts();
      } catch (error) {
        console.error('Error al eliminar lote:', error);
        alert('Error al eliminar el lote');
      }
    }
  };

  const openEditModal = (item) => {
    if (item.type !== 'Lote') {
      alert('Solo los lotes se pueden editar desde este panel.');
      return;
    }

    setEditingItem(item);
    const dateObj = new Date(item.expiryDate);
    const formatted = dateObj.toISOString().split('T')[0];
    setNewDate(formatted);
  };

  const handleSaveDate = async () => {
    if (!editingItem || !newDate) return;

    try {
      await updateProductBatch(editingItem.productId, editingItem.id, { expiryDate: newDate });
      setEditingItem(null);
      await refreshAlerts();
    } catch (error) {
      console.error('Error actualizando fecha:', error);
      alert('No se pudo actualizar la fecha');
    }
  };

  const strategyTip = useMemo(() => {
    const rawType = companyProfile?.business_type;
    const type = (Array.isArray(rawType) ? rawType[0] : rawType) || 'general';
    const lowerType = type.toLowerCase();

    if (lowerType.includes('farmacia') || lowerType.includes('botica') || lowerType.includes('salud')) {
      return { icon: '💊', title: 'Protocolo Farmacéutico', text: 'Revisa políticas de devolución y separa antibióticos caducados (SINGREM).' };
    }
    if (lowerType.includes('food') || lowerType.includes('restaurante') || lowerType.includes('cafeteria')) {
      return { icon: '🍳', title: 'Estrategia "Cero Desperdicio"', text: 'Prioriza estos ingredientes en "Especiales del Día" o procésalos hoy.' };
    }
    if (lowerType.includes('abarrotes') || lowerType.includes('tienda')) {
      return { icon: '🏷️', title: 'Liquidación', text: 'Arma packs de ahorro o 2x1. Mejor recuperar algo hoy que perder todo mañana.' };
    }
    return { icon: '💡', title: 'Sugerencia', text: 'Etiqueta con "Últimas Piezas". Verifica cambios con proveedor.' };
  }, [companyProfile]);

  if (loading) return <div className="expiration-loading">Buscando lotes próximos a vencer...</div>;

  const visibleAlerts = alerts.filter((alertItem) => !dismissedIds.includes(alertItem.id));

  if (visibleAlerts.length === 0) {
    return (
      <div className="expiration-widget expiration-empty">
        <div className="empty-icon">✅</div>
        <div className="empty-content">
          <h3>Todo el inventario está fresco</h3>
          <p>No hay lotes vencidos ni próximos a caducar visibles.</p>
          {dismissedIds.length > 0 && (
            <small
              onClick={() => setDismissedIds([])}
              style={{ color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Restaurar
              {' '}
              {dismissedIds.length}
              {' '}
              ignorados
            </small>
          )}
        </div>
      </div>
    );
  }

  const expiredCount = visibleAlerts.filter((item) => item.daysRemaining < 0).length;
  const expiringCount = visibleAlerts.length - expiredCount;

  return (
    <div className="expiration-widget" style={{ position: 'relative' }}>
      <div className={`widget-header ${expiredCount > 0 ? 'header-critical' : 'header-warning'}`}>
        <div className="header-content">
          <span className="header-icon">{expiredCount > 0 ? '🚫' : '⚠️'}</span>
          <div>
            <h3>Control de Caducidad</h3>
            <p>
              {expiredCount > 0
                ? `¡Atención! ${expiredCount} lotes vencidos y ${expiringCount} por vencer.`
                : `Tienes ${expiringCount} productos que caducan pronto.`}
            </p>
          </div>
        </div>
      </div>

      <div className="widget-body">
        <div className="table-responsive">
          <table className="expiration-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lote</th>
                <th className="text-center">Stock</th>
                <th className="text-center">Caducidad</th>
                <th className="text-right">Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleAlerts.slice(0, 10).map((item) => {
                const isExpired = item.daysRemaining < 0;
                const isUrgent = item.daysRemaining <= 7 && !isExpired;
                const isBatch = item.type === 'Lote';

                return (
                  <tr key={item.id} className={isExpired ? 'row-expired' : (isUrgent ? 'row-urgent' : '')}>
                    <td className="fw-bold product-name">{item.productName}</td>
                    <td><span className="badge-sku">{item.batchSku}</span></td>
                    <td className="text-center">{item.stock}</td>
                    <td className="text-center">{new Date(item.expiryDate).toLocaleDateString()}</td>
                    <td className="text-right">
                      <span className={`status-pill ${isExpired ? 'pill-danger' : (isUrgent ? 'pill-warning' : 'pill-info')}`}>
                        {isExpired ? `Venció hace ${Math.abs(item.daysRemaining)} días` : `${item.daysRemaining} días`}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        {isBatch && (
                          <>
                            <button className="btn-action edit" title="Corregir Fecha" onClick={() => openEditModal(item)}>
                              ✏️
                            </button>
                            <button className="btn-action delete" title="Eliminar Lote" onClick={() => handleDelete(item)}>
                              🗑️
                            </button>
                          </>
                        )}
                        <button className="btn-action ignore" title="Ignorar (Ocultar)" onClick={() => handleIgnore(item.id)}>
                          👁️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleAlerts.length > 10 && (
          <div className="view-more">
            <small>
              ... y
              {' '}
              {visibleAlerts.length - 10}
              {' '}
              más.
            </small>
          </div>
        )}

        {strategyTip && (
          <div className="strategy-box">
            <div className="strategy-icon">{strategyTip.icon}</div>
            <div className="strategy-content">
              <strong>{strategyTip.title}</strong>
              <p>{strategyTip.text}</p>
            </div>
          </div>
        )}
      </div>

      {editingItem && (
        <div className="mini-modal-overlay">
          <div className="mini-modal">
            <h4>Corregir Fecha</h4>
            <p style={{ fontSize: '0.9rem', marginBottom: '10px' }}>
              Lote:
              {' '}
              <b>{editingItem.batchSku}</b>
              <br />
              Producto:
              {' '}
              {editingItem.productName}
            </p>

            <div className="date-input-group">
              <label
                style={{
                  display: 'block',
                  textAlign: 'left',
                  fontSize: '0.8rem',
                  marginBottom: '5px',
                  color: 'var(--text-light)'
                }}
              >
                Nueva Fecha de Vencimiento:
              </label>
              <input
                type="date"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
                autoFocus
              />
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleSaveDate}>Guardar</button>
              <button className="btn-cancel" onClick={() => setEditingItem(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
