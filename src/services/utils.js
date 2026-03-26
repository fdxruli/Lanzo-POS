// utils.js

// 1. Importa la nueva función 'show' de tu store
import { showMessage } from '../store/useMessageStore';
import toast from 'react-hot-toast';
import Logger from './Logger';
import { getAvailableStock } from './db/utils';

/**
 * Muestra un mensaje al usuario.
 * - Si hay 'onConfirm', usa el MODAL (porque requiere interacción).
 * - Si NO hay 'onConfirm', usa un TOAST (rápido y no intrusivo).
 */
export function showMessageModal(message, onConfirm = null, options = {}) {

  // CASO A: Es una Confirmación (Modal)
  if (typeof onConfirm === 'function') {
    showMessage(message, onConfirm, options);
    return;
  }

  // CASO B: Es solo información (Toast)

  // 1. NUEVO: Soporte para ADVERTENCIA (Naranja)
  if (options.type === 'warning') {
    toast(message, {
      icon: '⚠️',
      style: {
        border: '1px solid #FFB800',
        padding: '12px',
        color: '#713200',
        background: '#FFFAE5', // Fondo cremita suave
      },
      duration: 4000
    });
    return;
  }

  // 2. Detección de ERROR (Rojo)
  const isError = options.type === 'error' ||
    message.toLowerCase().includes('error') ||
    message.toLowerCase().includes('falló') ||
    message.startsWith('⚠️');

  if (isError) {
    toast.error(message, { duration: 4000 });
  } else {
    // 3. Por defecto: ÉXITO (Verde)
    toast.success(message, { duration: 3000 });
  }
}

/**
 * Genera un identificador único universal y ordenable cronológicamente (K-Sortable).
 * Combina un timestamp en Base36 con entropía de un UUID para evitar colisiones,
 * asegurando que la paginación de Dexie.js respete el orden de creación.
 */
export const generateID = (prefix = '') => {
  // 1. Timestamp en milisegundos a Base36 (alfanumérico corto).
  // Como el tiempo avanza, esta cadena siempre será alfabéticamente mayor que las anteriores.
  const timestamp = Date.now().toString(36);

  // 2. Entropía (Tomamos un fragmento del UUID para hacerlo único)
  const entropy = crypto.randomUUID().split('-')[0];

  // Resultado ej: 'cust_m0jg1z00_3b12f1df'
  const id = `${timestamp}_${entropy}`;

  return prefix ? `${prefix}_${id}` : id;
};

/**
 * Convierte un archivo (File/Blob) a una cadena Base64 para guardar en BD local.
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Comprime, recorta a cuadrado y convierte una imagen a WebP.
 * OPTIMIZADO PARA USO LOCAL: Calidad 0.6 y 300px es suficiente para tarjetas.
 * @param {File|Blob} file - Archivo de imagen a procesar.
 * @param {number} targetSize - Tamaño objetivo en píxeles (ancho y alto).
 * @param {number} quality - Calidad de compresión (0 a 1).
 * @returns {Promise<File>} - Promesa que resuelve en un objeto File en formato WebP.
 */
export const compressImage = async (file, targetSize = 150, quality = 0.6) => {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error("El archivo no es una imagen válida.");
  }

  // Decodificar la imagen en un hilo en segundo plano
  const bitmap = await createImageBitmap(file);

  try {
    // Verificar soporte para OffscreenCanvas
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(targetSize, targetSize)
      : document.createElement('canvas');

    const ctx = canvas.getContext('2d');

    // Configurar dimensiones del recorte cuadrado centrado
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;

    if (sourceWidth > sourceHeight) {
      sourceX = (sourceWidth - sourceHeight) / 2;
      sourceWidth = sourceHeight;
    } else if (sourceHeight > sourceWidth) {
      sourceY = (sourceHeight - sourceWidth) / 2;
      sourceHeight = sourceWidth;
    }

    // Configurar dimensiones del canvas
    canvas.width = targetSize;
    canvas.height = targetSize;

    // Dibujar la imagen recortada y redimensionada
    ctx.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetSize, targetSize);

    // Convertir el canvas a un Blob en formato WebP
    const blob = await new Promise((resolve, reject) => {
      if (canvas instanceof OffscreenCanvas) {
        canvas.convertToBlob({ type: 'image/webp', quality })
          .then(resolve)
          .catch(reject);
      } else {
        canvas.toBlob((resultBlob) => {
          if (!resultBlob) {
            reject(new Error("El navegador falló al generar la compresión de la imagen (memoria insuficiente o error de canvas)."));
            return;
          }
          resolve(resultBlob);
        }, 'image/webp', quality);
      }
    });

    // Crear un nuevo objeto File a partir del Blob
    return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
  } finally {
    // Liberar memoria del bitmap
    bitmap.close();
  }
};

/**
 * Calcula si el color de texto debería ser blanco o negro para un contraste adecuado
 * con un color de fondo hexadecimal.
 * @param {string} hexColor El color de fondo en formato hexadecimal (ej. "#FFFFFF").
 * @returns {string} Retorna '#000000' (negro) o '#ffffff' (blanco).
 */
export const getContrastColor = (hexColor) => {
  const r = parseInt(hexColor.slice(1, 3), 16) / 255;
  const g = parseInt(hexColor.slice(3, 5), 16) / 255;
  const b = parseInt(hexColor.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#000000' : '#ffffff';
};

/**
 * Verifica si el LocalStorage está habilitado y es funcional en el navegador.
 * @returns {boolean} `true` si LocalStorage está disponible, de lo contrario `false`.
 */
export const isLocalStorageEnabled = () => {
  try {
    const testKey = 'lanzo-test';
    const testValue = 'test-value-' + Date.now();
    localStorage.setItem(testKey, testValue);
    const value = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    return value === testValue;
  } catch (e) {
    Logger.error('LocalStorage error:', e);
    return false;
  }
};

/**
 * Normaliza una cadena de fecha para asegurar consistencia a través de zonas horarias.
 * @param {string} dateString La cadena de fecha a normalizar.
 * @returns {Date} El objeto Date normalizado.
 */
export const normalizeDate = (dateString) => {
  const date = new Date(dateString);
  return new Date(date.getTime() + date.getTimezoneOffset() * 60000);
};

export const LOW_STOCK_THRESHOLD = 5;
export const EXPIRY_DAYS_THRESHOLD = 7;

/**
 * Calcula el estado de alerta de un producto (stock y caducidad).
 * @param {object} product - El objeto del producto a revisar.
 * @returns {{isLowStock: boolean, isNearingExpiry: boolean, isOutOfStock: boolean, expiryDays: number|null}}
 */
export const getProductAlerts = (product) => {
  let isLowStock = false;
  let isNearingExpiry = false;
  let expiryDays = null;
  const availableStock = getAvailableStock(product);

  // 1. Revisar si está agotado
  const isOutOfStock = product.trackStock && availableStock <= 0;

  // 2. Revisar stock bajo (solo si no está agotado)
  if (
    product.trackStock &&
    availableStock > 0 &&
    availableStock < LOW_STOCK_THRESHOLD
  ) {
    isLowStock = true;
  }

  // 3. Revisar caducidad
  if (product.expiryDate) {
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Comparamos solo fechas

    // Asumimos que la fecha guardada (ej. '2025-11-20')
    // se interpreta correctamente en la zona horaria local.
    const expiryDate = new Date(product.expiryDate);

    const diffTime = expiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= EXPIRY_DAYS_THRESHOLD) {
      isNearingExpiry = true;
      expiryDays = diffDays;
    }
  }

  return { isLowStock, isNearingExpiry, isOutOfStock, expiryDays };
};

/**
 * Prepara y abre un enlace de WhatsApp "Click to Chat".
 * @param {string} phone - El número de teléfono del cliente (sin código de país).
 * @param {string} message - El mensaje pre-escrito.
 */
export function sendWhatsAppMessage(phone, message) {
  // --- ¡IMPORTANTE! ---
  // Asumimos que todos los números son de México (código 52).
  // Si tienes clientes internacionales, necesitarás un campo de "código de país"
  // para el cliente.
  const countryCode = '52';

  // Limpiar el teléfono de espacios, guiones, etc.
  const cleanPhone = phone.replace(/[\s-()]/g, '');
  const fullPhone = `${countryCode}${cleanPhone}`;

  // Formatear el mensaje para la URL
  const encodedMessage = encodeURIComponent(message);

  // Crear la URL
  const url = `https://wa.me/${fullPhone}?text=${encodedMessage}`;

  // Abrir WhatsApp en una nueva pestaña
  window.open(url, '_blank');
}

/**
 * Busca un código de barras en la API de OpenFoodFacts.
 * @param {string} barcode El código de barras a buscar.
 * @returns {Promise<object>} Un objeto con { success: true, product: {...} } o { success: false, error: "..." }
 */
export async function lookupBarcodeInAPI(barcode) {
  Logger.log(`Buscando API para: ${barcode}`);

  // Usamos la v2 de la API, pidiendo solo los campos que necesitamos
  const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=product_name,image_front_url,brands`;

  try {
    const response = await fetch(url);

    // ======================================================
    // ¡AQUÍ ESTÁ LA MEJORA!
    // ======================================================
    // Primero, revisamos si es un 404. Esto no es un error,
    // es un resultado: "no encontrado".
    if (response.status === 404) {
      Logger.log('Producto no encontrado en OpenFoodFacts (404).');
      return { success: false, error: 'Producto no encontrado' };
    }

    // Si no es 404, pero sigue sin estar OK (ej. 500, 403),
    // entonces SÍ es un error de red.
    if (!response.ok) {
      throw new Error(`Respuesta de red no fue exitosa: ${response.statusText}`);
    }
    // ======================================================
    // FIN DE LA MEJORA
    // ======================================================

    const data = await response.json();

    if (data.status === 1 && data.product) {
      // ¡Producto encontrado!
      const product = data.product;
      const productData = {
        name: product.product_name || '',
        image: product.image_front_url || null,
        brand: product.brands || '',
      };

      Logger.log('Producto encontrado:', productData);
      return { success: true, product: productData };

    } else {
      // La API respondió OK, pero el producto no estaba (status: 0)
      Logger.log('Producto no encontrado en OpenFoodFacts (status 0).');
      return { success: false, error: 'Producto no encontrado' };
    }
  } catch (error) { // Esto ahora solo captura errores REALES (ej. sin internet)
    Logger.error('Error al llamar a la API de OpenFoodFacts:', error);
    return { success: false, error: `Error de red: ${error.message}` };
  }
}

export const roundCurrency = (amount) => {
  if (typeof amount !== 'number') return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

/**
 * Intenta activar el almacenamiento persistente del navegador.
 * Esto evita que el navegador borre los datos automáticamente si falta espacio.
 */
export const tryEnablePersistence = async () => {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const result = await navigator.storage.persist();
        Logger.log(`Solicitud de persistencia: ${result ? 'CONCEDIDA ✅' : 'DENEGADA ⚠️'}`);
        return result;
      }
      return true; // Ya estaba persistente
    } catch (error) {
      Logger.error("Error solicitando persistencia:", error);
      return false;
    }
  }
  return false;
};

/**
 * Guarda en LocalStorage de forma segura, manejando errores de cuota llena.
 * Intenta limpiar caché vieja y reintentar antes de rendirse.
 * @param {string} key - La clave a guardar.
 * @param {string} value - El valor (string) a guardar.
 * @returns {boolean} - true si se guardó, false si falló.
 */
export const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    // 1. Detectar variantes de error de cuota (Chrome, Firefox, Safari)
    const isQuotaError = error && (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.message?.toLowerCase().includes('quota')
    );

    if (isQuotaError) {
      Logger.warn('💾 LocalStorage lleno. Intentando limpieza de emergencia...');

      // 2. Estrategia: Borrar keys no críticas (cachés, flags temporales)
      // Agrega aquí cualquier key que sea seguro borrar
      const keysToClean = [
        'lanzo_last_active',
        'retry-lazy-refreshed',
        'lanzo-test',
        'loglevel',
        'debug'
      ];

      keysToClean.forEach(k => {
        if (k !== key) { // No borrar lo que estamos intentando guardar si colisiona
          try { localStorage.removeItem(k); } catch (e) { /* ignorar */ }
        }
      });

      // 3. Reintentar Guardado
      try {
        localStorage.setItem(key, value);
        Logger.log('✅ Espacio recuperado. Guardado exitoso.');
        return true;
      } catch (retryError) {
        // 4. Fallo definitivo: Avisar al usuario usando tu modal existente
        Logger.error("❌ Fallo crítico: Memoria llena irrecoverable.");

        showMessageModal(
          '⚠️ ALERTA DE MEMORIA\n\nEl navegador no tiene espacio para guardar datos. Es posible que pierdas tu sesión si recargas.\n\nPor favor, borra datos de navegación antiguos.',
          null,
          { type: 'error' }
        );
        return false;
      }
    }

    // Otros errores (ej. Modo Incógnito estricto en Safari a veces bloquea setItem completamente)
    Logger.error("Error de acceso a LocalStorage:", error);
    return false;
  }
};

/**
 * Verificación ROBUSTA de conexión a Internet.
 * navigator.onLine solo verifica conexión a la red local (LAN/Router),
 * no salida real a internet (WAN).
 * * Estrategia: "Ping" ligero a un recurso de alta disponibilidad.
 * @returns {Promise<boolean>}
 */
export const checkInternetConnection = async () => {
  // 1. Primer filtro rápido: Si el navegador sabe que no hay red, creéle.
  if (!navigator.onLine) {
    return false;
  }

  // 2. Verificación real (Ping Fetch)
  try {
    // Usamos 'no-store' para que no nos engañe la caché del navegador.
    // Usamos un timeout corto (5000ms) para no congelar la UX.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Hacemos ping a la propia URL del sitio (si está hosteado) o un CDN confiable.
    // Usar la favicon de Google es un truco común, o un endpoint de tu API "health".
    // Aquí usamos un HEAD request para descargar lo menos posible.
    // NOTA: Asegúrate de que la URL permita CORS o usa 'no-cors' (opaco).
    await fetch('https://www.google.com/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return true; // Si no lanzó error, hay salida.
  } catch (error) {
    Logger.warn('⚠️ Check de internet fallido:', error.message);
    return false;
  }
};

export const getStableDeviceId = () => {
  let deviceId = localStorage.getItem('lanzo_device_id');
  if (!deviceId) {
    // Generar un ID simple si no existe
    deviceId = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('lanzo_device_id', deviceId);
  }
  return deviceId;
};
