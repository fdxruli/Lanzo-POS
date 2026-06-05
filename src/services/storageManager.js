/**
 * StorageManager - Gestor de Persistencia para PWA Offline-First
 * Implementa StorageManager API (navigator.storage) para intentar que IndexedDB
 * no sea purgado por el SO.
 *
 * CRÍTICO: La persistencia local NO es inmutable. Apple/Safari (iOS/iPadOS)
 * no respeta estrictamente navigator.storage.persist() y purgará los datos
 * si el dispositivo entra en estado crítico de almacenamiento, incluso en
 * PWAs instaladas en la pantalla de inicio.
 *
 * SIEMPRE se requiere un mecanismo de respaldo o sincronización externa para
 * garantizar la seguridad total de los datos.
 */

import Logger from './Logger';

// Umbrales de alerta
const QUOTA_CRITICAL_THRESHOLD = 0.9; // 90%
const QUOTA_WARNING_THRESHOLD = 0.75;  // 75%

/**
 * Estados globales del storage
 */
export const StorageState = {
  UNKNOWN: 'unknown',
  REQUESTING: 'requesting',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
  VOLATILE: 'volatile', // "Best-Effort" - Safari, navegadores privados
};

/**
 * Gestión centralizada del StorageManager API
 */
class StorageManagerService {
  constructor() {
    this.persistenceState = StorageState.UNKNOWN;
    this.quotaUsage = {
      usage: 0,
      quota: 0,
      percentUsed: 0,
    };
    this.lastCheckTime = 0;
    this.estimateCache = null;
    this.CACHE_TTL = 30000; // 30 segundos
    this.listeners = new Set(); // Para notificaciones en tiempo real
    this._initialized = false;
  }

  /**
   * Determina si el navegador soporta StorageManager API
   */
  isSupported() {
    return !!(
      navigator?.storage &&
      typeof navigator.storage.persist === 'function' &&
      typeof navigator.storage.estimate === 'function'
    );
  }

  /**
   * Registra listener para cambios de estado del storage
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notifica a todos los listeners
   */
  _notify() {
    this.listeners.forEach(callback => {
      try {
        callback({
          state: this.persistenceState,
          quota: this.quotaUsage,
        });
      } catch (err) {
        Logger.error('Error en listener de StorageManager:', err);
      }
    });
  }

  /**
   * FASE 0: Comprueba si la persistencia YA fue concedida previamente
   * usando navigator.storage.persisted() — sin volver a solicitarla.
   * Es la forma más fiable y no-destructiva de saber el estado real al arrancar.
   * No consume el "prompt" del navegador ni muestra diálogos.
   * Retorna: true (ya concedida) | false (no concedida o no soportada)
   */
  async isPersisted() {
    if (!this.isSupported()) return false;
    try {
      const persisted = await navigator.storage.persisted();
      if (persisted) {
        this.persistenceState = StorageState.GRANTED;
        this._notify();
        Logger.info('✓ Persistencia verificada: ya concedida previamente');
      }
      return persisted;
    } catch (err) {
      Logger.error('Error verificando persistencia actual:', err);
      return false;
    }
  }

  /**
   * FASE 1: Verifica el estado actual de persistencia sin hacer cambios
   * Retorna: 'granted' | 'denied' | 'prompt' | 'unsupported'
   */
  async checkPersistenceStatus() {
    if (!this.isSupported()) {
      this.persistenceState = StorageState.UNSUPPORTED;
      Logger.warn('StorageManager API no soportada en este navegador');
      return StorageState.UNSUPPORTED;
    }

    try {
      // Detectar si ya fue otorgado (sin solicitar)
      const permission = await navigator.permissions.query?.({ name: 'persistent-storage' });

      if (permission?.state === 'granted') {
        this.persistenceState = StorageState.GRANTED;
        Logger.info('✓ Persistencia ya otorgada');
        return StorageState.GRANTED;
      }

      if (permission?.state === 'denied') {
        this.persistenceState = StorageState.DENIED;
        Logger.warn('⚠️ Persistencia denegada - Modo volátil activado');
        return StorageState.DENIED;
      }

      // 'prompt' - requiere interacción del usuario
      // CRITICO: asignar a this.persistenceState para que initialize() lo detecte
      this.persistenceState = 'prompt';
      return 'prompt';
    } catch (err) {
      Logger.error('Error verificando persistencia:', err);
      return StorageState.UNKNOWN;
    }
  }

  /**
   * FASE 2: Solicita persistencia explícitamente
   * Maneja la lógica de navegadores agresivos (Safari en iPhone sin instalación)
   * Retorna: true (éxito) | false (negado o error)
   */
  async requestPersistence() {
    if (this.persistenceState === StorageState.GRANTED) {
      return true;
    }

    if (this.persistenceState === StorageState.UNSUPPORTED) {
      Logger.warn('No se puede solicitar persistencia: API no disponible');
      return false;
    }

    if (this.persistenceState === StorageState.REQUESTING) {
      Logger.warn('Solicitud de persistencia ya en progreso');
      return new Promise(resolve => {
        const unsubscribe = this.subscribe(({ state }) => {
          if (state !== StorageState.REQUESTING) {
            unsubscribe();
            resolve(state === StorageState.GRANTED);
          }
        });
      });
    }

    this.persistenceState = StorageState.REQUESTING;
    this._notify();

    try {
      const persisted = await navigator.storage.persist();

      if (persisted) {
        this.persistenceState = StorageState.GRANTED;
        Logger.info('✅ PERSISTENCIA OTORGADA - (Nota: iOS/Safari aún puede purgar datos si el espacio es crítico)');
      } else {
        // El navegador mostró el prompt y el usuario rechazó,
        // o Safari sin instalación PWA (siempre retorna false)
        this.persistenceState = StorageState.DENIED;
        Logger.warn(
          '❌ PERSISTENCIA RECHAZADA\n' +
          'Safari/iOS: La persistencia absoluta no está soportada. Mantén espacio libre en tu dispositivo.\n' +
          'Chrome/Firefox: verifica permisos del sitio'
        );
      }

      this._notify();
      return persisted;
    } catch (err) {
      Logger.error('Error solicitando persistencia:', err);
      this.persistenceState = StorageState.DENIED;
      this._notify();
      return false;
    }
  }

  /**
   * FASE 3: Estima cuota y uso actual
   * Implementa caching para reducir llamadas costosas
   * Retorna: { usage, quota, percentUsed, isCritical, isWarning }
   */
  async estimateQuota(forceRefresh = false) {
    // Evita llamadas excesivas (max 1 cada 30 segundos)
    if (!forceRefresh && this.estimateCache && Date.now() - this.lastCheckTime < this.CACHE_TTL) {
      return this.estimateCache;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

      this.quotaUsage = {
        usage,
        quota,
        percentUsed: Math.round(percentUsed * 100) / 100,
        isCritical: percentUsed >= QUOTA_CRITICAL_THRESHOLD,
        isWarning: percentUsed >= QUOTA_WARNING_THRESHOLD && percentUsed < QUOTA_CRITICAL_THRESHOLD,
      };

      this.lastCheckTime = Date.now();
      this.estimateCache = this.quotaUsage;
      this._notify();

      Logger.debug(
        `Storage: ${Math.round(usage / 1024 / 1024)}MB / ${Math.round(quota / 1024 / 1024)}MB ` +
        `(${this.quotaUsage.percentUsed}%)`
      );

      return this.quotaUsage;
    } catch (err) {
      Logger.error('Error estimando cuota:', err);
      return {
        usage: 0,
        quota: 0,
        percentUsed: 0,
        isCritical: false,
        isWarning: false,
        error: true,
      };
    }
  }

  /**
   * VALIDACION DE BOOT: Comprueba si la app puede iniciar seguramente
   * Retorna objeto con estado crítico para bloquear operaciones peligrosas
   */
  async validateBootConditions() {
    const quota = await this.estimateQuota();

    // CORRECCIÓN: isVolatile = true si el estado NO es 'granted'.
    // 'prompt', 'unknown', 'denied' y 'unsupported' son todos volátiles.
    const isVolatile = this.persistenceState !== StorageState.GRANTED;

    return {
      canStart: true, // La app siempre inicia, pero con advertencias
      isSafe: !isVolatile && !quota.isCritical,
      isVolatile,
      isCritical: quota.isCritical,
      isWarning: quota.isWarning,
      persistenceState: this.persistenceState,
      quota,
      recommendation: this._generateRecommendation(this.persistenceState, quota),
    };
  }

  /**
   * BLOQUEO DE OPERACIONES: Verifica si es seguro cobrar una venta
   * Retorna: { allowed: boolean, reason?: string }
   */
  async canProcessSale() {
    const quota = await this.estimateQuota(true);

    if (quota.error) {
      Logger.warn('No se pudo verificar cuota - permitiendo venta por seguridad de UX');
      return { allowed: true };
    }

    if (quota.isCritical) {
      return {
        allowed: false,
        reason: `Almacenamiento CRITICO: ${Math.round(quota.usage / 1024 / 1024)}MB de ${Math.round(quota.quota / 1024 / 1024)}MB. Libera espacio o haz un respaldo INMEDIATO. Riesgo alto de purga del SO.`,
        severity: 'critical',
      };
    }

    if (quota.isWarning) {
      return {
        allowed: true,
        reason: `Advertencia: ${quota.percentUsed}% de almacenamiento usado. Considera hacer un respaldo.`,
        severity: 'warning',
      };
    }

    return { allowed: true };
  }

  /**
   * Genera mensajes legibles para el usuario
   */
  _generateRecommendation(status, quota) {
    const messages = [];

    if (status === StorageState.DENIED) {
      messages.push('⚠️ MODO VOLÁTIL: Permiso de persistencia denegado');
      messages.push('🔧 Solución: Verifica permisos. En iOS, asegúrate de mantener siempre espacio libre y haz respaldos.');
    } else if (status === StorageState.UNSUPPORTED) {
      messages.push('⚠️ MODO VOLÁTIL: Navegador no soporta persistencia');
      messages.push('🔧 Solución: Usa un navegador moderno. En iOS mantén espacio libre en disco.');
    } else if (status === 'prompt') {
      messages.push('⏳ Solicitud de persistencia pendiente');
      messages.push('🔧 Solución: Otorga el permiso de almacenamiento. (Nota: en iOS haz respaldos periódicos).');
    } else if (status === StorageState.UNKNOWN) {
      messages.push('⚠️ Estado de persistencia desconocido');
      messages.push('🔧 Solución: Recarga la app y haz respaldos frecuentes.');
    }

    if (quota.isCritical) {
      messages.push(`🔴 CRITICO: Almacenamiento ${quota.percentUsed}% lleno`);
    } else if (quota.isWarning) {
      messages.push(`🟡 Advertencia: Almacenamiento ${quota.percentUsed}% lleno`);
    }

    return messages;
  }

  /**
   * Hook de inicialización (llamar en main.jsx antes de montar React)
   */
  async initialize() {
    if (this._initialized) return;
    this._initialized = true;

    Logger.info('🔒 Iniciando StorageManager...');

    try {
      // Fase 0: Verificar si la persistencia YA fue concedida en sesiones previas.
      // navigator.storage.persisted() es no-destructiva: no muestra diálogos,
      // no consume el "prompt" del navegador, y refleja el estado real del SO.
      const alreadyPersisted = await this.isPersisted();

      if (!alreadyPersisted) {
        // Fase 1: Verificar el estado formal del permiso
        await this.checkPersistenceStatus();

        // Fase 2: Solo solicitar si hay posibilidad real de obtenerlo.
        // NO intentar si ya fue denegado: el navegador recuerda el rechazo.
        // Nota: En iOS, incluso con PWA, el SO puede purgar datos bajo presión de espacio.
        const shouldRequest = (
          this.persistenceState === 'prompt' ||
          this.persistenceState === StorageState.UNKNOWN
        );
        if (shouldRequest) {
          Logger.info('Solicitando permiso de persistencia...');
          await this.requestPersistence();
        }
      }

      // Fase 3: Estimar cuota disponible
      await this.estimateQuota();

      // Retornar estado para que la UI pueda reaccionar
      const conditions = await this.validateBootConditions();

      if (conditions.isVolatile) {
        Logger.warn('⚠️ ADVERTENCIA DE DATOS: Almacenamiento en modo volátil', {
          persistenceState: this.persistenceState,
          details: conditions.recommendation,
        });
      } else {
        Logger.info('✅ Almacenamiento con persistencia (Nota: iOS no garantiza inmutabilidad absoluta)');
      }

      return conditions;
    } catch (err) {
      Logger.error('Error fatal en StorageManager.initialize():', err);
      return {
        canStart: true,
        isSafe: false,
        isVolatile: true,
        isCritical: false,
        isWarning: true,
        error: err.message,
      };
    }
  }

  /**
   * Para debugging: estado completo del servicio
   */
  getState() {
    return {
      persistenceState: this.persistenceState,
      quotaUsage: this.quotaUsage,
      isSupported: this.isSupported(),
      initialized: this._initialized,
    };
  }
}

// Singleton export
export const storageManager = new StorageManagerService();

export default storageManager;
