// src/components/layout/Ticker.jsx
import React, { useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductStore } from '../../store/useProductStore';
import { useAppStore } from '../../store/useAppStore';
import { getProductAlerts } from '../../services/utils';
import './Ticker.css';
import Logger from '../../services/Logger';
import { Rocket, Package, Sparkles, AlertTriangle, Clock, Shield } from 'lucide-react';

// ============================================================
//  CONSTANTES
// ============================================================

/** Máximo de alertas de inventario que se muestran en el ticker */
const MAX_INVENTORY_ALERTS = 8;

/** Umbral mínimo de productos para mostrar alerta de backup */
const BACKUP_ALERT_THRESHOLD = 5;

/** Segundos base de animación por cada mensaje */
const SECONDS_PER_MESSAGE = 10;

/** Duración mínima de la animación en segundos */
const MIN_ANIMATION_DURATION = 15;

// Niveles de urgencia (menor número = mayor urgencia)
const URGENCY = {
  CRITICAL: 0,   // Caduca hoy / stock agotado
  WARNING: 1,    // Caduca pronto / stock bajo
  INFO: 2,       // Backup, promocionales
};

const promotionalMessages = [
  { icon: Rocket, text: "¡Potencia tu negocio con Lanzo POS!", urgency: URGENCY.INFO },
  { icon: Package, text: "Gestiona tu inventario de forma fácil y rápida.", urgency: URGENCY.INFO },
  { icon: Sparkles, text: "¡Sigue creciendo tu negocio con nosotros!", urgency: URGENCY.INFO }
];

// ============================================================
//  FUNCIONES AUXILIARES (puras, sin side-effects)
// ============================================================

/**
 * Calcula los días calendario restantes hasta una fecha.
 * No muta los objetos Date originales.
 */
function getDaysRemaining(endDate) {
  if (!endDate) return 0;

  const now = new Date();
  const end = new Date(endDate);

  // Normalizar a medianoche para comparar DÍAS calendario
  // Usamos nuevos objetos para no mutar los originales
  const nowNormalized = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endNormalized = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  const diffTime = endNormalized.getTime() - nowNormalized.getTime();

  // Si la fecha ya pasó
  if (diffTime < 0) return 0;

  // Convertir milisegundos a días
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Genera el texto descriptivo de los días restantes.
 */
function getDayText(days) {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

/**
 * Verifica si se debe mostrar una alerta de backup basándose en localStorage.
 * Retorna un objeto de alerta o null.
 */
function getBackupAlertMessage() {
  const postponedUntil = localStorage.getItem('backup_postponed_until');
  if (postponedUntil && new Date() < new Date(postponedUntil)) {
    return null;
  }

  const lastBackup = localStorage.getItem('last_backup_date');
  if (!lastBackup) {
    return {
      icon: Shield,
      text: "No has realizado ninguna copia de seguridad. Ve a Configuración > Exportar.",
      urgency: URGENCY.WARNING,
      route: '/configuracion'
    };
  }

  const diffTime = Math.abs(Date.now() - new Date(lastBackup).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 7) {
    return {
      icon: Shield,
      text: `Hace ${diffDays} días que no respaldas tus datos. ¡Haz una copia hoy!`,
      urgency: URGENCY.WARNING,
      route: '/configuracion'
    };
  }
  return null;
}

/**
 * Genera alertas de inventario a partir del menú de productos.
 * Ordena por urgencia y limita la cantidad de resultados.
 */
function generateAlertMessages(menu) {
  const alerts = [];

  // Alerta de backup (solo si el usuario tiene datos significativos)
  if (menu.length > BACKUP_ALERT_THRESHOLD) {
    const backupMsg = getBackupAlertMessage();
    if (backupMsg) alerts.push(backupMsg);
  }

  menu.forEach(product => {
    if (product.isActive === false) return;
    const { isLowStock, isNearingExpiry, expiryDays } = getProductAlerts(product);

    if (isLowStock) {
      alerts.push({
        icon: Package,
        text: `¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.`,
        urgency: URGENCY.WARNING,
        route: '/productos'
      });
    }

    if (isNearingExpiry) {
      const isCritical = expiryDays === 0;
      const message = isCritical
        ? `¡Atención! ${product.name} caduca hoy.`
        : `¡Atención! ${product.name} caduca en ${expiryDays} días.`;

      alerts.push({
        icon: Clock,
        text: message,
        urgency: isCritical ? URGENCY.CRITICAL : URGENCY.WARNING,
        route: '/productos'
      });
    }
  });

  // Ordenar por urgencia (crítico primero) y limitar
  alerts.sort((a, b) => a.urgency - b.urgency);
  return alerts.slice(0, MAX_INVENTORY_ALERTS);
}

// ============================================================
//  COMPONENTE PRINCIPAL
// ============================================================

export default function Ticker() {
  const navigate = useNavigate();

  // --- Estado de Licencia ---
  const licenseStatus = useAppStore((state) => state.licenseStatus);
  const gracePeriodEnds = useAppStore((state) => state.gracePeriodEnds);
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  // --- Estado de Productos ---
  const menu = useProductStore((state) => state.menu);
  const isLoading = useProductStore((state) => state.isLoading);

  // --- Tick para re-evaluar backup ---
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

  // ============================================================
  //  CÁLCULO DE MENSAJES (Memoizado)
  // ============================================================

  const { messages, isPriority } = useMemo(() => {

    // --- VALIDACIÓN 1: Período de Gracia por Status ---
    if (licenseStatus === 'grace_period' && gracePeriodEnds) {
      const days = getDaysRemaining(gracePeriodEnds);
      const dayText = getDayText(days);

      const copy = {
        icon: AlertTriangle,
        text: `Tu licencia ha caducado. El sistema se bloqueará ${dayText}. Renueva tu plan para evitar interrupciones.`,
        urgency: URGENCY.CRITICAL,
        route: '/configuracion'
      };

      return {
        messages: [copy, copy, copy],
        isPriority: true
      };
    }

    // --- VALIDACIÓN 2: Período de Gracia por Fechas (Fallback) ---
    if (licenseDetails && gracePeriodEnds) {
      const now = new Date();
      const graceDate = new Date(gracePeriodEnds);
      const expiryDate = licenseDetails.expires_at ? new Date(licenseDetails.expires_at) : null;

      // Si ya expiró pero aún estamos en gracia
      if (expiryDate && expiryDate < now && graceDate > now) {
        const days = getDaysRemaining(gracePeriodEnds);
        const dayText = getDayText(days);

        const copy = {
          icon: AlertTriangle,
          text: `Tu licencia ha caducado. El sistema se bloqueará ${dayText}. Renueva tu plan para evitar interrupciones.`,
          urgency: URGENCY.CRITICAL,
          route: '/configuracion'
        };

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

  // ============================================================
  //  VELOCIDAD DINÁMICA DE ANIMACIÓN
  // ============================================================

  const animationDuration = useMemo(() => {
    const count = messages.length;
    // Prioridad: la animación va más rápido para urgencia
    if (isPriority) return Math.max(MIN_ANIMATION_DURATION, count * 8);
    return Math.max(MIN_ANIMATION_DURATION, count * SECONDS_PER_MESSAGE);
  }, [messages.length, isPriority]);

  // ============================================================
  //  HANDLER DE CLICK EN ALERTAS
  // ============================================================

  const handleAlertClick = useCallback((msg) => {
    if (msg.route) {
      navigate(msg.route);
    }
  }, [navigate]);

  // ============================================================
  //  RENDER
  // ============================================================

  const containerClasses = [
    'notification-ticker-container',
    isPriority ? 'priority-warning' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      id="notification-ticker-container"
      className={containerClasses}
      role="marquee"
      aria-label="Notificaciones del sistema"
      aria-live="polite"
    >
      <div className="ticker-wrap">
        <div
          className="ticker-move"
          style={{ animationDuration: `${animationDuration}s` }}
        >
          {messages.map((msg, index) => {
            const Icon = msg.icon;
            const isClickable = !!msg.route;

            // Clase CSS de urgencia
            let urgencyClass = 'urgency-info';
            if (msg.urgency === URGENCY.CRITICAL) urgencyClass = 'urgency-critical';
            else if (msg.urgency === URGENCY.WARNING) urgencyClass = 'urgency-warning';

            return (
              <div
                key={`${msg.text}-${index}`}
                className={`ticker-item ${urgencyClass} ${isClickable ? 'ticker-item-clickable' : ''}`}
                onClick={isClickable ? () => handleAlertClick(msg) : undefined}
                role={isClickable ? 'link' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleAlertClick(msg);
                  }
                } : undefined}
              >
                {Icon && <Icon size={18} aria-hidden="true" />}
                <span>{msg.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}