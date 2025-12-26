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

  // Cargamos las alertas al montar el componente
  useEffect(() => {
    const fetchAlerts = async () => {
      // Buscamos productos que vencen en los próximos 45 días
      const data = await getExpiringProducts(45);
      setAlerts(data);
      setLoading(false);
    };
    fetchAlerts();
  }, [getExpiringProducts]);

  // --- LÓGICA INTELIGENTE DE RECOMENDACIONES POR RUBRO ---
  const strategyTip = useMemo(() => {
    const rawType = companyProfile?.business_type;
    const type = (Array.isArray(rawType) ? rawType[0] : rawType) || 'general';
    const lowerType = type.toLowerCase();

    // 1. FARMACIA / BOTICA
    if (lowerType.includes('farmacia') || lowerType.includes('botica') || lowerType.includes('salud')) {
      return {
        icon: '💊',
        title: 'Protocolo Farmacéutico',
        text: 'Revisa las políticas de devolución con tus laboratorios para los lotes próximos a vencer. Para antibióticos caducados, recuerda separarlos en el contenedor de residuos peligrosos (SINGREM) y no tirarlos a la basura común.'
      };
    }
    
    // 2. ALIMENTOS / RESTAURANTE
    if (lowerType.includes('food') || lowerType.includes('restaurante') || lowerType.includes('cafeteria') || lowerType.includes('cocina')) {
      return {
        icon: '🍳',
        title: 'Estrategia de Cocina - "Cero Desperdicio"',
        text: 'Prioriza estos ingredientes en los "Especiales del Día" o menú de empleados. Si son perecederos críticos, procésalos hoy mismo (salsas, congelación) para extender su vida útil antes de que venzan.'
      };
    }

    // 3. ABARROTES / TIENDITA
    if (lowerType.includes('abarrotes') || lowerType.includes('tienda') || lowerType.includes('super') || lowerType.includes('mini')) {
      return {
        icon: '🏷️',
        title: 'Liquidación de Inventario',
        text: 'Arma "Packs de Ahorro" o promociones 2x1 ubicándolos cerca de la caja. Es mejor recuperar el costo vendiéndolo barato hoy, que perder el 100% del valor tirándolo mañana.'
      };
    }

    // 4. GENERAL (Default)
    return {
      icon: '💡',
      title: 'Sugerencia de Gestión',
      text: 'Identifica estos productos con una etiqueta de "Últimas Piezas" o descuento especial. Verifica si tu proveedor acepta cambios por mercancía nueva antes de la fecha límite.'
    };
  }, [companyProfile]);

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Buscando lotes próximos a vencer...</div>;
  }

  // --- ESTADO VACÍO (TODO EN ORDEN) ---
  if (alerts.length === 0) {
    return (
      <div className="expiration-widget" style={{ textAlign: 'center', padding: '40px 20px', borderLeft: '6px solid #22c55e' }}>
        <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
        <h3 style={{ margin: '0 0 10px 0', color: '#15803d' }}>Todo el inventario está fresco</h3>
        <p style={{ color: '#64748b', margin: 0 }}>
          No se encontraron lotes vencidos ni próximos a caducar en los siguientes 45 días.
        </p>
      </div>
    );
  }

  // Separamos vencidos de próximos a vencer
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
                ? `¡Atención! Tienes ${expiredCount} lotes VENCIDOS y ${expiringCount} por vencer.` 
                : `Tienes ${expiringCount} productos que caducan pronto.`}
            </p>
          </div>
        </div>
      </div>

      <div className="widget-body">
        {/* TABLA DE PRODUCTOS */}
        <div className="table-responsive">
          <table className="expiration-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lote / SKU</th>
                <th className="text-center">Stock</th>
                <th className="text-center">Caducidad</th>
                <th className="text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 10).map(item => { // Mostramos top 10
                const isExpired = item.daysRemaining < 0;
                const isUrgent = item.daysRemaining <= 7 && !isExpired;
                
                return (
                  <tr key={item.id} className={isExpired ? 'row-expired' : (isUrgent ? 'row-urgent' : '')}>
                    <td className="fw-bold">{item.productName}</td>
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
            <small>... y {alerts.length - 10} lotes más. Revisa el inventario detallado.</small>
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