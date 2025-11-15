// src/components/layout/Ticker.jsx
import React, { useMemo } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { useAppStore } from '../../store/useAppStore'; // <-- 1. Importa el App Store
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';

const promotionalMessages = [
  "🚀 ¡Potencia tu negocio con Lanzo POS!",
  "📦 Gestiona tu inventario de forma fácil y rápida.",
  "✨ ¡Sigue creciendo tu negocio con nosotros!"
];

function generateAlertMessages(menu) {
  const alerts = [];
  menu.forEach(product => {
    if (product.isActive === false) return;
    const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(product); //
    if (isLowStock) {
      alerts.push(`¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.`);
    }
    if (isNearingExpiry) {
      const message = expiryDays === 0 ?
        `¡Atención! ${product.name} caduca hoy.` :
        `¡Atención! ${product.name} caduca en ${expiryDays} días.`;
      alerts.push(message);
    }
  });
  return alerts;
}

// <-- 2. NUEVO Helper para calcular días restantes
function getDaysRemaining(endDate) {
  if (!endDate) return 0;
  const now = new Date();
  const end = new Date(endDate);
  const diffTime = end - now;
  if (diffTime <= 0) return 0;
  // Usamos Math.ceil para redondear hacia arriba (si faltan 6.1 días, son 7 días)
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function Ticker() {
  // <-- 3. Lee el estado de la licencia
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const gracePeriodEnds = useAppStore((state) => state.gracePeriodEnds);

  // Lee el estado del dashboard (para los mensajes normales)
  const menu = useDashboardStore((state) => state.menu);
  const isLoading = useDashboardStore((state) => state.isLoading);

  // <-- 4. Lógica de mensajes MODIFICADA
  const { messages, isPriority } = useMemo(() => {
    // ¡LÓGICA DE PRIORIDAD!
    if (licenseStatus === 'grace_period' && gracePeriodEnds) {
      const days = getDaysRemaining(gracePeriodEnds);
      const dayText = days === 1 ? '1 día' : `${days} días`;
      
      // ¡Tu mensaje tipo copywriting!
      const copy = `Tu licencia ha caducado. El sistema se bloqueará en ${dayText}. Renueva tu plan para evitar interrupciones.`;
      
      return {
        messages: [copy, copy, copy], // Repetimos el mensaje para llenar el ticker
        isPriority: true // Bandera para cambiar el estilo
      };
    }

    // Lógica normal (existente)
    if (isLoading || !menu) {
      return { messages: promotionalMessages, isPriority: false };
    }
    try {
      const alerts = generateAlertMessages(menu); //
      if (alerts.length === 0) {
        return { messages: promotionalMessages, isPriority: false };
      }
      return { messages: alerts, isPriority: false };
    } catch (error) {
      console.error('Error generando alertas:', error);
      return { messages: promotionalMessages, isPriority: false };
    }
  }, [licenseStatus, gracePeriodEnds, menu, isLoading]);
  
  // <-- 5. Aplicar clases CSS dinámicas
  const containerClasses = [
    'notification-ticker-container',
    isPriority ? 'priority-warning' : ''
  ].filter(Boolean).join(' ');

  return (
    <div id="notification-ticker-container" className={containerClasses}>
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