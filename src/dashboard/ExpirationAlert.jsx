// src/components/dashboard/ExpirationAlert.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import './ExpirationAlert.css';

export default function ExpirationAlert() {
  const getExpiringProducts = useProductStore(state => state.getExpiringProducts);
  // Asumimos que tienes estas funciones en tu store. Si no, revisa la nota abajo.
  const updateProductBatch = useProductStore(state => state.updateProductBatch); 
  const removeProductBatch = useProductStore(state => state.removeProductBatch);
  
  const companyProfile = useAppStore(state => state.companyProfile);
  
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Estado para manejo de acciones locales
  const [dismissedIds, setDismissedIds] = useState([]); // IDs ignorados en esta sesión
  const [editingItem, setEditingItem] = useState(null); // Item que se está editando
  const [newDate, setNewDate] = useState(''); // Nueva fecha temporal

  const refreshAlerts = async () => {
    setLoading(true);
    const data = await getExpiringProducts(45);
    setAlerts(data);
    setLoading(false);
  };

  useEffect(() => {
    refreshAlerts();
  }, [getExpiringProducts]);

  // --- LOGICA DE ACCIONES ---

  // 1. IGNORAR (Ocultar en esta sesión)
  const handleIgnore = (id) => {
    setDismissedIds(prev => [...prev, id]);
  };

  // 2. ELIMINAR (Borrar lote permanentemente)
  const handleDelete = async (item) => {
    if (window.confirm(`¿Estás seguro de eliminar el lote ${item.batchSku} de ${item.productName}? Esta acción es irreversible.`)) {
      try {
        if (removeProductBatch) {
          await removeProductBatch(item.productId, item.id); // Asumiendo item.id es el batchId
          await refreshAlerts(); // Recargar datos
        } else {
          // Fallback si no existe la función en el store (para que no rompa la UI)
          console.warn("Función removeProductBatch no encontrada en store");
          handleIgnore(item.id); 
        }
      } catch (error) {
        console.error("Error al eliminar lote:", error);
        alert("Error al eliminar el lote");
      }
    }
  };

  // 3. EDITAR (Abrir modal)
  const openEditModal = (item) => {
    setEditingItem(item);
    // Formatear fecha para el input type="date" (YYYY-MM-DD)
    const dateObj = new Date(item.expiryDate);
    const formatted = dateObj.toISOString().split('T')[0];
    setNewDate(formatted);
  };

  // 4. GUARDAR EDICIÓN
  const handleSaveDate = async () => {
    if (!editingItem || !newDate) return;
    
    try {
      if (updateProductBatch) {
        // Asumiendo firma: (productId, batchId, { expiryDate: ... })
        await updateProductBatch(editingItem.productId, editingItem.id, { expiryDate: newDate });
        setEditingItem(null);
        await refreshAlerts();
      } else {
        console.warn("Función updateProductBatch no encontrada en store");
        setEditingItem(null);
      }
    } catch (error) {
      console.error("Error actualizando fecha:", error);
      alert("No se pudo actualizar la fecha");
    }
  };

  // --- LÓGICA DE RECOMENDACIONES (Tips) ---
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
      return { icon: '🏷️', title: 'Liquidación', text: 'Arma "Packs de Ahorro" o 2x1. Mejor recuperar algo hoy que perder todo mañana.' };
    }
    return { icon: '💡', title: 'Sugerencia', text: 'Etiqueta con "Últimas Piezas". Verifica cambios con proveedor.' };
  }, [companyProfile]);

  if (loading) return <div className="expiration-loading">Buscando lotes próximos a vencer...</div>;

  // Filtrar los ignorados
  const visibleAlerts = alerts.filter(a => !dismissedIds.includes(a.id));

  if (visibleAlerts.length === 0) {
    return (
      <div className="expiration-widget expiration-empty">
        <div className="empty-icon">✅</div>
        <div className="empty-content">
          <h3>Todo el inventario está fresco</h3>
          <p>No hay lotes vencidos ni próximos a caducar visibles.</p>
          {dismissedIds.length > 0 && <small onClick={() => setDismissedIds([])} style={{color: 'var(--primary-color)', cursor:'pointer', textDecoration:'underline'}}>Restaurar {dismissedIds.length} ignorados</small>}
        </div>
      </div>
    );
  }

  const expiredCount = visibleAlerts.filter(a => a.daysRemaining < 0).length;
  const expiringCount = visibleAlerts.length - expiredCount;

  return (
    <div className="expiration-widget" style={{position: 'relative'}}>
      
      {/* HEADER */}
      <div className={`widget-header ${expiredCount > 0 ? 'header-critical' : 'header-warning'}`}>
        <div className="header-content">
          <span className="header-icon">{expiredCount > 0 ? '🚫' : '⚠️'}</span>
          <div>
            <h3>Control de Caducidad</h3>
            <p>
              {expiredCount > 0 
                ? `¡Atención! ${expiredCount} lotes VENCIDOS y ${expiringCount} por vencer.` 
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
              {visibleAlerts.slice(0, 10).map(item => {
                const isExpired = item.daysRemaining < 0;
                const isUrgent = item.daysRemaining <= 7 && !isExpired;
                
                return (
                  <tr key={item.id} className={isExpired ? 'row-expired' : (isUrgent ? 'row-urgent' : '')}>
                    <td className="fw-bold product-name">{item.productName}</td>
                    <td><span className="badge-sku">{item.batchSku}</span></td>
                    <td className="text-center">{item.stock}</td>
                    <td className="text-center">
                      {new Date(item.expiryDate).toLocaleDateString()}
                    </td>
                    <td className="text-right">
                      <span className={`status-pill ${isExpired ? 'pill-danger' : (isUrgent ? 'pill-warning' : 'pill-info')}`}>
                        {isExpired 
                          ? `Venció hace ${Math.abs(item.daysRemaining)} días` 
                          : `${item.daysRemaining} días`}
                      </span>
                    </td>
                    {/* COLUMNA DE ACCIONES */}
                    <td>
                      <div className="action-buttons">
                        <button 
                          className="btn-action edit" 
                          title="Corregir Fecha"
                          onClick={() => openEditModal(item)}
                        >
                          ✏️
                        </button>
                        <button 
                          className="btn-action ignore" 
                          title="Ignorar (Ocultar)"
                          onClick={() => handleIgnore(item.id)}
                        >
                          👁️‍🗨️
                        </button>
                        <button 
                          className="btn-action delete" 
                          title="Eliminar Lote"
                          onClick={() => handleDelete(item)}
                        >
                          🗑️
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
            <small>... y {visibleAlerts.length - 10} más.</small>
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

      {/* --- MINI MODAL PARA EDITAR FECHA --- */}
      {editingItem && (
        <div className="mini-modal-overlay">
          <div className="mini-modal">
            <h4>Corregir Fecha</h4>
            <p style={{fontSize: '0.9rem', marginBottom: '10px'}}>
              Lote: <b>{editingItem.batchSku}</b><br/>
              Producto: {editingItem.productName}
            </p>
            
            <div className="date-input-group">
              <label style={{display:'block', textAlign:'left', fontSize:'0.8rem', marginBottom:'5px', color:'var(--text-light)'}}>
                Nueva Fecha de Vencimiento:
              </label>
              <input 
                type="date" 
                value={newDate} 
                onChange={(e) => setNewDate(e.target.value)}
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