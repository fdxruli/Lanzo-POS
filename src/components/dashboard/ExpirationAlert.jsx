// src/components/dashboard/ExpirationAlert.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import './ExpirationAlert.css';

export default function ExpirationAlert() {
  const getExpiringProducts = useProductStore(state => state.getExpiringProducts);
  const companyProfile = useAppStore(state => state.companyProfile);
  
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      const data = await getExpiringProducts(45);
      setAlerts(data);
      setLoading(false);
    };
    fetchAlerts();
  }, [getExpiringProducts]);

  const strategyTip = useMemo(() => {
    const rawType = companyProfile?.business_type;
    const type = (Array.isArray(rawType) ? rawType[0] : rawType) || 'general';
    const lowerType = type.toLowerCase();

    if (lowerType.includes('farmacia') || lowerType.includes('botica') || lowerType.includes('salud')) {
      return {
        icon: '💊',
        title: 'Protocolo Farmacéutico',
        text: 'Revisa las políticas de devolución con tus laboratorios. Separa antibióticos caducados para residuos peligrosos (SINGREM).'
      };
    }
    
    if (lowerType.includes('food') || lowerType.includes('restaurante') || lowerType.includes('cafeteria') || lowerType.includes('cocina')) {
      return {
        icon: '🍳',
        title: 'Estrategia de Cocina "Cero Desperdicio"',
        text: 'Prioriza estos ingredientes en los "Especiales del Día". Procesa salsas o congela para extender vida útil.'
      };
    }

    if (lowerType.includes('abarrotes') || lowerType.includes('tienda') || lowerType.includes('super')) {
      return {
        icon: '🏷️',
        title: 'Liquidación de Inventario',
        text: 'Arma "Packs de Ahorro" o 2x1 cerca de caja. Es mejor recuperar el costo hoy que perder el 100% mañana.'
      };
    }

    return {
      icon: '💡',
      title: 'Sugerencia de Gestión',
      text: 'Identifica estos productos con etiqueta de "Últimas Piezas". Verifica cambios con proveedor antes de la fecha límite.'
    };
  }, [companyProfile]);

  if (loading) {
    return <div className="expiration-loading">Buscando lotes próximos a vencer...</div>;
  }

  // --- ESTADO VACÍO (TODO EN ORDEN) ---
  if (alerts.length === 0) {
    return (
      <div className="expiration-widget expiration-empty">
        <div className="empty-icon">✅</div>
        <div className="empty-content">
          <h3>Todo el inventario está fresco</h3>
          <p>No hay lotes vencidos ni próximos a caducar en los siguientes 45 días.</p>
        </div>
      </div>
    );
  }

  const expiredCount = alerts.filter(a => a.daysRemaining < 0).length;
  const expiringCount = alerts.length - expiredCount;

  return (
    <div className="expiration-widget">
      {/* HEADER DE ALERTA */}
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
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 10).map(item => {
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
                          : `${item.daysRemaining} días restantes`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {alerts.length > 10 && (
          <div className="view-more">
            <small>... y {alerts.length - 10} lotes más.</small>
          </div>
        )}

        {/* SECCIÓN DE TIPS INTELIGENTES */}
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
    </div>
  );
}