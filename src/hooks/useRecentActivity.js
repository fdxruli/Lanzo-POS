// src/hooks/useRecentActivity.js
import { useState, useEffect, useRef } from 'react';

/**
 * Hook personalizado para rastrear la última actividad del usuario en la página
 * 
 * Escucha eventos de interacción (click, keydown, mousemove) y mantiene un registro
 * de la última actividad. Marca al usuario como "activo" durante 5 segundos después
 * de cada interacción.
 * 
 * @returns {Object} Objeto con información de actividad
 * @property {Date|null} lastActivity - Timestamp de la última actividad detectada
 * @property {boolean} isActive - true si hubo actividad en los últimos 5 segundos
 * 
 * @example
 * const { lastActivity, isActive } = useRecentActivity();
 * 
 * return (
 *   <div>
 *     {isActive && <span>Usuario activo</span>}
 *     <small>Última actividad: {lastActivity?.toLocaleTimeString()}</small>
 *   </div>
 * );
 */
export const useRecentActivity = () => {
  const [lastActivity, setLastActivity] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const activityTimerRef = useRef(null);

  useEffect(() => {
    const updateActivity = () => {
      const now = new Date();
      setLastActivity(now);
      setIsActive(true);

      // Limpiar timer anterior para evitar múltiples timers concurrentes
      if (activityTimerRef.current) {
        clearTimeout(activityTimerRef.current);
      }

      // Resetear estado "activo" después de 5 segundos sin actividad
      activityTimerRef.current = setTimeout(() => {
        setIsActive(false);
      }, 5000);
    };

    // Escuchar eventos de actividad del usuario
    // passive: true optimiza el rendimiento al indicar que no llamaremos preventDefault()
    window.addEventListener('click', updateActivity, { passive: true });
    window.addEventListener('keydown', updateActivity, { passive: true });
    window.addEventListener('mousemove', updateActivity, { passive: true });

    // Cleanup: Remover listeners y limpiar timer al desmontar
    // CRÍTICO para prevenir fugas de memoria
    return () => {
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('mousemove', updateActivity);
      
      if (activityTimerRef.current) {
        clearTimeout(activityTimerRef.current);
      }
    };
  }, []); // Array vacío: solo se ejecuta al montar/desmontar

  return { lastActivity, isActive };
};
