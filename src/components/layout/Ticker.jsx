import React, { useMemo } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore'; 
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';

const promotionalMessages = [
  "🚀 ¡Potencia tu negocio con Lanzo POS!",
  "📦 Gestiona tu inventario de forma fácil y rápida.",
  "✨ ¡Sigue creciendo tu negocio con nosotros!"
];

// Función auxiliar para revisar el estado del backup
function getBackupAlertMessage() {
  const lastBackup = localStorage.getItem('last_backup_date');
  if (!lastBackup) return "⚠️ No has realizado ninguna copia de seguridad. Ve a Configuración > Exportar.";
  
  const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 7) {
    return `⚠️ Hace ${diffDays} días que no respaldas tus datos. ¡Haz una copia hoy!`;
  }
  return null;
}

function generateAlertMessages(menu) {
  const alerts = [];

  // 1. Agregar alerta de Backup si es necesario (Prioridad Media)
  // Solo mostramos esto en el ticker si hay datos (menu.length > 0)
  if (menu.length > 5) {
      const backupMsg = getBackupAlertMessage();
      if (backupMsg) alerts.push(backupMsg);
  }

  menu.forEach(product => {
    if (product.isActive === false) return;
    const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(product); 
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

function getDaysRemaining(endDate) {
  if (!endDate) return 0;
  const now = new Date();
  const end = new Date(endDate);
  const diffTime = end - now;
  if (diffTime <= 0) return 0;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function Ticker() {
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const gracePeriodEnds = useAppStore((state) => state.gracePeriodEnds);

  const menu = useProductStore((state) => state.menu);
  const isLoading = useProductStore((state) => state.isLoading)

  const { messages, isPriority } = useMemo(() => {
    // 1. Prioridad MÁXIMA: Licencia
    if (licenseStatus === 'grace_period' && gracePeriodEnds) {
      const days = getDaysRemaining(gracePeriodEnds);
      const dayText = days === 1 ? '1 día' : `${days} días`;
      const copy = `Tu licencia ha caducado. El sistema se bloqueará en ${dayText}. Renueva tu plan para evitar interrupciones.`;
      
      return {
        messages: [copy, copy, copy], 
        isPriority: true 
      };
    }

    if (isLoading || !menu) {
      return { messages: promotionalMessages, isPriority: false };
    }

    try {
      // 2. Alertas Normales (Backup + Stock + Caducidad)
      const alerts = generateAlertMessages(menu); 
      
      if (alerts.length === 0) {
        return { messages: promotionalMessages, isPriority: false };
      }
      return { messages: alerts, isPriority: false };
    } catch (error) {
      console.error('Error generando alertas:', error);
      return { messages: promotionalMessages, isPriority: false };
    }
  }, [licenseStatus, gracePeriodEnds, menu, isLoading]);
  
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