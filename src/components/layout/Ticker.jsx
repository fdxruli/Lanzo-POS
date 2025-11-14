// src/components/layout/Ticker.jsx
import React, { useMemo } from 'react';
import { useDashboard } from '../../hooks/useDashboard';
import './Ticker.css';

// Constantes de tu ticker.js original
const LOW_STOCK_THRESHOLD = 5;
const EXPIRY_DAYS_THRESHOLD = 7;

const promotionalMessages = [
  "🚀 ¡Potencia tu negocio con Lanzo POS!",
  "📦 Gestiona tu inventario de forma fácil y rápida.",
  "✨ ¡Sigue creciendo tu negocio con nosotros!"
];

/**
 * Esta es la lógica de 'getProductAlerts' de tu ticker.js,
 * pero ahora usa el 'menu' que le pasamos.
 */
function getProductAlerts(menu) {
  const alerts = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  menu.forEach(product => {
    // No generar alertas para productos inactivos
    if (product.isActive === false) {
      return;
    }

    // Alerta de stock bajo
    if (product.trackStock && product.stock > 0 && product.stock < LOW_STOCK_THRESHOLD) {
      alerts.push(`¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.`);
    }

    // Alerta de caducidad
    if (product.expiryDate) {
      const expiryDate = new Date(product.expiryDate);
      const diffTime = expiryDate - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= EXPIRY_DAYS_THRESHOLD) {
        const message = diffDays === 0 ?
          `¡Atención! ${product.name} caduca hoy.` :
          `¡Atención! ${product.name} caduca en ${diffDays} días.`;
        alerts.push(message);
      }
    }
  });
  
  return alerts;
}

export default function Ticker() {
  // 1. Obtenemos el 'menu' del hook que ya carga los datos
  const { menu, isLoading } = useDashboard();

  // 2. Usamos 'useMemo' para recalcular las alertas SOLO si el 'menu' cambia
  const messages = useMemo(() => {
    if (isLoading || !menu) return promotionalMessages; // Mensajes por defecto
    
    const alerts = getProductAlerts(menu);
    
    if (alerts.length === 0) {
      return promotionalMessages;
    }
    return alerts;
  }, [menu, isLoading]); // Depende de 'menu' y 'isLoading'

  // 3. Renderizamos el HTML/CSS de tu 'ticker.js' y 'styles.css'
  return (
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