/**
 * BOT WEB WORKER
 * Procesamiento de NLP e inteligencia del bot fuera del hilo principal
 * @module workers/bot.worker
 */

import {
  detectIntent,
  extractEntities,
  generateResponse,
  getProactiveSuggestions
} from '../utils/botIntelligence.js';

// botIntelligence imports services/db, which also imports BackupRiskEvaluator.
// Keep that chain worker-safe: no UI/browser-only work should run at import time.

/**
 * @typedef {Object} BotRequestPayload
 * @property {string} messageId - UUID único para rastrear la solicitud
 * @property {string} text - Texto de entrada del usuario
 * @property {Object} [context] - Datos contextuales opcionales
 * @property {number} [context.cartCount]
 * @property {number} [context.cartTotal]
 * @property {number} [context.lowStockCount]
 * @property {number} [context.licenseDays]
 * @property {Object} [context.license]
 * @property {string[]} [context.businessType]
 * @property {Object} [context.stats]
 */

/**
 * @typedef {Object} BotResponsePayload
 * @property {string} messageId - UUID que coincide con la solicitud
 * @property {boolean} success - Indica si el procesamiento fue exitoso
 * @property {Object} [response] - Respuesta del bot (si success=true)
 * @property {string} response.title
 * @property {string} response.message
 * @property {string[]} [response.tips]
 * @property {Array<{label:string,path:string,icon?:string}>} [response.actions]
 * @property {Object} [error] - Error details (si success=false)
 * @property {string} error.code
 * @property {string} error.message
 */

/**
 * @typedef {Object} BotErrorPayload
 * @property {string} messageId
 * @property {boolean} success - false
 * @property {Object} error
 * @property {string} error.code
 * @property {string} error.message
 * @property {string} [error.stack]
 */

// ============================================================
// MANEJO DE MENSAJES
// ============================================================

/**
 * Procesa una solicitud de procesamiento de mensaje del bot
 * @param {BotRequestPayload} payload
 * @returns {Promise<BotResponsePayload>}
 */
const processBotMessage = async (payload) => {
  const { messageId, text, context = {} } = payload;

  if (!messageId || typeof messageId !== 'string') {
    throw new Error('INVALID_MESSAGE_ID: messageId es requerido y debe ser string');
  }

  if (!text || typeof text !== 'string') {
    throw new Error('INVALID_INPUT: text es requerido y debe ser string');
  }

  // Ejecutar procesamiento de intención
  const intent = detectIntent(text);
  
  // Extraer entidades
  const entities = extractEntities(text);
  entities.originalMessage = text;

  // Generar respuesta
  const response = await generateResponse(intent, entities, context);

  return {
    messageId,
    success: true,
    response
  };
};

/**
 * Obtiene sugerencias proactivas del bot
 * @param {Object} payload
 * @param {string} payload.messageId
 * @param {Object} [payload.context]
 * @param {string|null} [payload.context.lastBackupDate]
 * @returns {Promise<{messageId:string,success:true,suggestions:Array}>}
 */
const processProactiveSuggestions = async (payload) => {
  const { messageId, context = {} } = payload;

  if (!messageId) {
    throw new Error('INVALID_MESSAGE_ID: messageId es requerido');
  }

  const options = {};
  if (context.lastBackupDate !== undefined) {
    options.lastBackupDate = context.lastBackupDate;
  }

  const suggestion = await getProactiveSuggestions(options);

  return {
    messageId,
    success: true,
    suggestions: suggestion ? [suggestion] : []
  };
};

// ============================================================
// EVENT LISTENER PRINCIPAL
// ============================================================

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  // Manejo de tipos de mensaje
  try {
    switch (type) {
      case 'PROCESS_MESSAGE': {
        const result = await processBotMessage(payload);
        self.postMessage(result);
        break;
      }

      case 'GET_PROACTIVE_SUGGESTIONS': {
        const result = await processProactiveSuggestions(payload);
        self.postMessage(result);
        break;
      }

      case 'PING': {
        // Health check para verificar que el worker está activo
        self.postMessage({
          messageId: payload?.messageId,
          success: true,
          type: 'PONG'
        });
        break;
      }

      default: {
        self.postMessage({
          messageId: payload?.messageId,
          success: false,
          error: {
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Tipo de mensaje no soportado: ${type}`
          }
        });
      }
    }
  } catch (error) {
    // Captura cualquier error no manejado y lo envía al hilo principal
    self.postMessage({
      messageId: payload?.messageId,
      success: false,
      error: {
        code: error.name || 'WORKER_PROCESSING_ERROR',
        message: error.message,
        stack: error.stack
      }
    });
  }
};

// Manejo de errores no capturados
self.onerror = (error) => {
   
  console.error('[BotWorker] Error no capturado:', error);
  // No podemos enviar un postMessage aquí sin messageId context
  return false;
};

// Manejo de rechazo de promesas no capturadas
self.onunhandledrejection = (event) => {
   
  console.error('[BotWorker] Promesa rechazada no manejada:', event.reason);
  event.preventDefault();
};
