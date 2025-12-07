// src/components/layout/Ticker.jsx
import React, { useMemo, useEffect } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore'; 
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';

const promotionalMessages = [
  "🚀 ¡Potencia tu negocio con Lanzo POS!",
  "📦 Gestiona tu inventario de forma fácil y rápida.",
  "✨ ¡Sigue creciendo tu negocio con nosotros!"
];

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
  
  // Normalizar a medianoche para comparar DÍAS calendario
  now.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  
  const diffTime = end.getTime() - now.getTime();
  
  // Si la fecha ya pasó
  if (diffTime < 0) return 0;
  
  // Convertir milisegundos a días
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function Ticker() {
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const gracePeriodEnds = useAppStore((state) => state.gracePeriodEnds);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const menu = useProductStore((state) => state.menu);
  const isLoading = useProductStore((state) => state.isLoading);

  // Log para debug (solo en desarrollo)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[Ticker Debug]', {
        licenseStatus,
        gracePeriodEnds,
        isGracePeriod: licenseStatus === 'grace_period',
        daysRemaining: gracePeriodEnds ? getDaysRemaining(gracePeriodEnds) : null
      });
    }
  }, [licenseStatus, gracePeriodEnds]);

  const { messages, isPriority } = useMemo(() => {
    
    // --- VALIDACIÓN 1: Período de Gracia por Status ---
    // Si el status es explícitamente 'grace_period', mostramos alerta
    if (licenseStatus === 'grace_period' && gracePeriodEnds) {
      const days = getDaysRemaining(gracePeriodEnds);
      
      let dayText = '';
      if (days <= 0) dayText = 'hoy';
      else if (days === 1) dayText = 'mañana';
      else dayText = `en ${days} días`;

      const copy = `⚠️ Tu licencia ha caducado. El sistema se bloqueará ${dayText}. Renueva tu plan para evitar interrupciones.`;
      
      return {
        messages: [copy, copy, copy], 
        isPriority: true 
      };
    }

    // --- VALIDACIÓN 2: Período de Gracia por Fechas (Fallback) ---
    // Por si el status no se actualizó pero las fechas sí
    if (licenseDetails && gracePeriodEnds) {
      const now = new Date();
      const graceDate = new Date(gracePeriodEnds);
      const expiryDate = licenseDetails.expires_at ? new Date(licenseDetails.expires_at) : null;

      // Si ya expiró pero aún estamos en gracia
      if (expiryDate && expiryDate < now && graceDate > now) {
        const days = getDaysRemaining(gracePeriodEnds);
        
        let dayText = '';
        if (days <= 0) dayText = 'hoy';
        else if (days === 1) dayText = 'mañana';
        else dayText = `en ${days} días`;

        const copy = `⚠️ Tu licencia ha caducado. El sistema se bloqueará ${dayText}. Renueva tu plan para evitar interrupciones.`;
        
        return {
          messages: [copy, copy, copy], 
          isPriority: true 
        };
      }
    }

    // --- VALIDACIÓN 3: Alertas de Inventario ---
    if (isLoading || !menu || menu.length === 0) {
      return { messages: promotionalMessages, isPriority: false };
    }

    try {
      const alerts = generateAlertMessages(menu); 
      
      if (alerts.length === 0) {
        return { messages: promotionalMessages, isPriority: false };
      }
      
      return { messages: alerts, isPriority: false };
    } catch (error) {
      console.error('Error generando alertas:', error);
      return { messages: promotionalMessages, isPriority: false };
    }
  }, [licenseStatus, gracePeriodEnds, licenseDetails, menu, isLoading]);
  
  const containerClasses = [
    'notification-ticker-container',
    isPriority ? 'priority-warning' : ''
  ].filter(Boolean).join(' ');

  return (
    <div id="notification-ticker-container" className={containerClasses}>
      <div className="ticker-wrap">
        <div className="ticker-move">
          {messages.map((msg, index) => (
            <div key={`${index}-${isPriority}`} className="ticker-item">
              {msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}