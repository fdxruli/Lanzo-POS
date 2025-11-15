// src/components/layout/Ticker.jsx
import React, { useMemo } from 'react';
// 1. Importa el store en lugar del hook
import { useDashboardStore } from '../../store/useDashboardStore';
// 2. Importamos el helper
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';

const promotionalMessages = [
  "🚀 ¡Potencia tu negocio con Lanzo POS!",
  "📦 Gestiona tu inventario de forma fácil y rápida.",
  "✨ ¡Sigue creciendo tu negocio con nosotros!"
];

// ... (función generateAlertMessages sin cambios) ...
function generateAlertMessages(menu) {
  const alerts = [];

  menu.forEach(product => {
    // No generar alertas para productos inactivos
    if (product.isActive === false) {
      return;
    }

    // 3. Usamos el helper
    const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(product);

    // Alerta de stock bajo
    if (isLowStock) {
      alerts.push(`¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.`);
    }

    // Alerta de caducidad
    if (isNearingExpiry) {
      const message = expiryDays === 0 ?
        `¡Atención! ${product.name} caduca hoy.` :
        `¡Atención! ${product.name} caduca en ${expiryDays} días.`;
      alerts.push(message);
    }
  });

  return alerts;
}


export default function Ticker() {
  // 3. Lee los datos directamente del store centralizado
  const menu = useDashboardStore((state) => state.menu);
  const isLoading = useDashboardStore((state) => state.isLoading);

  const messages = useMemo(() => {
    if (isLoading || !menu) return promotionalMessages;

    try {
      const alerts = generateAlertMessages(menu);
      if (alerts.length === 0) {
        return promotionalMessages;
      }
      return alerts;
    } catch (error) {
      console.error('Error generando alertas:', error);
      return promotionalMessages; // ✅ Fallback seguro
    }
  }, [menu, isLoading]);

  return (
    // ... (El JSX de retorno no cambia) ...
    <div id="notification-ticker-container" className="notification-ticker-container">
      <div className="ticker-wrap">
        <div className="ticker-move">
          {messages.map((msg, index) => (
            <div key={index} className="ticker-item">
              {msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}