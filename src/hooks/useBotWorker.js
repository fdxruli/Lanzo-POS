/**
 * HOOK useBotWorker
 * Interface React para comunicación con Bot Web Worker via Promesas
 * @module hooks/useBotWorker
 */

import { useEffect, useRef, useCallback } from 'react';

/**
 * @typedef {Object} BotResponse
 * @property {string} title
 * @property {string} message
 * @property {string[]} [tips]
 * @property {Array<{label:string,path:string,icon?:string,highlight?:boolean}>} [actions]
 */

/**
 * @typedef {Object} UseBotWorkerReturn
 * @property {(text:string,context?:Object)=>Promise<BotResponse>} askBot - Función para consultar al bot
 * @property {()=>Promise<Array>} getSuggestions - Obtiene sugerencias proactivas
 * @property {boolean} isReady - Indica si el worker está listo
 * @property {string|null} error - Error actual si existe
 */

/**
 * Genera un ID único para rastrear mensajes
 * @returns {string} UUID v4 simplificado
 */
const generateMessageId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Hook para comunicación asíncrona con el Bot Worker
 * @returns {UseBotWorkerReturn}
 */
export const useBotWorker = () => {
  const workerRef = useRef(null);
  const pendingPromisesRef = useRef(new Map());
  const isReadyRef = useRef(false);
  const errorRef = useRef(null);

  // ============================================================
  // INICIALIZACIÓN DEL WORKER
  // ============================================================

  useEffect(() => {
    // Instanciar worker con sintaxis de módulos de Vite
    const worker = new Worker(
      new URL('../workers/bot.worker.js', import.meta.url),
      { type: 'module' }
    );

    workerRef.current = worker;

    /**
     * Manejador de mensajes del worker
     * @param {MessageEvent} event
     */
    const handleMessage = (event) => {
      const { messageId, success, response, error, suggestions } = event.data;

      // Ignorar mensajes sin messageId (ej: PONG)
      if (!messageId) return;

      const pending = pendingPromisesRef.current.get(messageId);
      if (!pending) {
         
        console.warn(`[useBotWorker] Respuesta con messageId desconocido: ${messageId}`);
        return;
      }

      // Limpiar el pending primero para evitar fugas
      pendingPromisesRef.current.delete(messageId);

      if (success) {
        // Resolver con la respuesta apropiada según el tipo
        if (response) {
          pending.resolve(response);
        } else if (suggestions !== undefined) {
          pending.resolve(suggestions);
        } else {
          pending.resolve(event.data);
        }
      } else {
        // Rechazar con el error del worker
        const workerError = new Error(error?.message || 'Error desconocido del worker');
        workerError.code = error?.code || 'WORKER_ERROR';
        workerError.stack = error?.stack;
        pending.reject(workerError);
      }
    };

    /**
     * Manejador de errores del worker
     * @param {ErrorEvent} errorEvent
     */
    const handleError = (errorEvent) => {
       
      console.error('[useBotWorker] Error del Worker:', errorEvent);
      errorRef.current = errorEvent.message;

      // Rechazar todas las promesas pendientes
      pendingPromisesRef.current.forEach((pending) => {
        const error = new Error('Worker error: ' + errorEvent.message);
        error.code = 'WORKER_RUNTIME_ERROR';
        pending.reject(error);
      });
      pendingPromisesRef.current.clear();
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);

    // Health check inicial
    const pingWorker = () => {
      return new Promise((resolve) => {
        const pingId = generateMessageId();
        const timeoutId = setTimeout(() => {
          pendingPromisesRef.current.delete(pingId);
          resolve(false);
        }, 5000);

        const originalResolve = (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        };

        // Sobrescribir temporalmente el handler para el ping
        const pingHandler = (event) => {
          if (event.data?.type === 'PONG' && event.data?.messageId === pingId) {
            worker.removeEventListener('message', pingHandler);
            originalResolve(true);
          }
        };

        worker.addEventListener('message', pingHandler);
        worker.postMessage({
          type: 'PING',
          payload: { messageId: pingId }
        });
      });
    };

    // Verificar que el worker esté listo
    pingWorker().then((ready) => {
      isReadyRef.current = ready;
      if (!ready) {
        errorRef.current = 'Worker no respondió al health check';
      }
    });

    // ============================================================
    // CLEANUP
    // ============================================================

    return () => {
      // Rechazar todas las promesas pendientes
      pendingPromisesRef.current.forEach((pending, id) => {
        const error = new Error('Worker terminado antes de recibir respuesta');
        error.code = 'WORKER_TERMINATED';
        pending.reject(error);
      });
      pendingPromisesRef.current.clear();

      // Remover listeners y terminar worker
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.terminate();

      workerRef.current = null;
      isReadyRef.current = false;
    };
  }, []);

  // ============================================================
  // API PÚBLICA
  // ============================================================

  /**
   * Envía un mensaje al worker y retorna una Promise
   * @param {string} type - Tipo de operación
   * @param {Object} payload - Datos a enviar
   * @returns {Promise<any>}
   */
  const sendMessage = useCallback((type, payload = {}) => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current;

      if (!worker) {
        const error = new Error('Worker no está inicializado');
        error.code = 'WORKER_NOT_INITIALIZED';
        reject(error);
        return;
      }

      const messageId = generateMessageId();

      // Timeout de seguridad (30 segundos)
      const timeoutId = setTimeout(() => {
        pendingPromisesRef.current.delete(messageId);
        const error = new Error(`Timeout esperando respuesta del worker para ${type}`);
        error.code = 'WORKER_TIMEOUT';
        reject(error);
      }, 30000);

      // Guardar referencia de la promesa
      pendingPromisesRef.current.set(messageId, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      // Enviar mensaje al worker
      worker.postMessage({
        type,
        payload: {
          ...payload,
          messageId
        }
      });
    });
  }, []);

  /**
   * Consulta al bot con un mensaje de texto
   * @param {string} text - Mensaje del usuario
   * @param {Object} [context] - Datos contextuales
   * @returns {Promise<BotResponse>}
   */
  const askBot = useCallback(async (text, context = {}) => {
    if (!text || typeof text !== 'string') {
      throw new Error('El texto de entrada debe ser un string no vacío');
    }

    return sendMessage('PROCESS_MESSAGE', { text, context });
  }, [sendMessage]);

  /**
   * Obtiene sugerencias proactivas del bot
   * @returns {Promise<Array>}
   */
  const getSuggestions = useCallback(async () => {
    return sendMessage('GET_PROACTIVE_SUGGESTIONS', {});
  }, [sendMessage]);

  // ============================================================
  // RETORNO
  // ============================================================

  return {
    askBot,
    getSuggestions,
    get isReady() { return isReadyRef.current; },
    get error() { return errorRef.current; }
  };
};

export default useBotWorker;
