// src/components/layout/Ticker.jsx
import React, { useMemo, useEffect } from 'react';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';
import Logger from '../../services/Logger';
import { Rocket, Package, Sparkles, AlertTriangle, Clock } from 'lucide-react';

const promotionalMessages = [
  { icon: Rocket, text: "¡Potencia tu negocio con Lanzo POS!" },
  { icon: Package, text: "Gestiona tu inventario de forma fácil y rápida." },
  { icon: Sparkles, text: "¡Sigue creciendo tu negocio con nosotros!" }
];

function getBackupAlertMessage() {
  const postponedUntil = localStorage.getItem('backup_postponed_until');
  if (postponedUntil && new Date() < new Date(postponedUntil)) {
    return null;
  }

  const lastBackup = localStorage.getItem('last_backup_date');
  if (!lastBackup) {
    return { icon: AlertTriangle, text: "No has realizado ninguna copia de seguridad. Ve a Configuración > Exportar." };
  }

  const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 7) {
    return { icon: AlertTriangle, text: `Hace ${diffDays} días que no respaldas tus datos. ¡Haz una copia hoy!` };
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
      alerts.push({ icon: Package, text: `¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.` });
    }

    if (isNearingExpiry) {
      const message = expiryDays === 0 ?
        `¡Atención! ${product.name} caduca hoy.` :
        `¡Atención! ${product.name} caduca en ${expiryDays} días.`;
      alerts.push({ icon: Clock, text: message });
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

  const [backupUpdateTick, setBackupUpdateTick] = React.useState(0);
  useEffect(() => {
    const handleBackupUpdate = () => setBackupUpdateTick(prev => prev + 1);
    window.addEventListener('backup_status_changed', handleBackupUpdate);
    return () => window.removeEventListener('backup_status_changed', handleBackupUpdate);
  }, []);

  // Log para debug (solo en desarrollo)
  useEffect(() => {
    if (import.meta.env.DEV) {
      Logger.log('[Ticker Debug]', {
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

      const copy = {
        icon: AlertTriangle,
        text: `Tu licencia ha caducado. El sistema se bloqueará ${dayText}. Renueva tu plan para evitar interrupciones.`
      };

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
      Logger.error('Error generando alertas:', error);
      return { messages: promotionalMessages, isPriority: false };
    }
  }, [licenseStatus, gracePeriodEnds, licenseDetails, menu, isLoading, backupUpdateTick]);

  const containerClasses = [
    'notification-ticker-container',
    isPriority ? 'priority-warning' : ''
  ].filter(Boolean).join(' ');

  return (
    <div id="notification-ticker-container" className={containerClasses}>
      <div className="ticker-wrap">
        <div className="ticker-move">
          {messages.map((msg, index) => {
            const Icon = msg.icon;
            return (
              <div key={`${index}-${isPriority}`} className="ticker-item" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                {Icon && <Icon size={18} />}
                <span>{msg.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}