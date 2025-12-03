// utils.js

// 1. Importa la nueva función 'show' de tu store
import { showMessage } from '../store/useMessageStore';
import toast from 'react-hot-toast';

/**
 * Muestra un mensaje al usuario.
 * - Si hay 'onConfirm', usa el MODAL (porque requiere interacción).
 * - Si NO hay 'onConfirm', usa un TOAST (rápido y no intrusivo).
 */
export function showMessageModal(message, onConfirm = null, options = {}) {

  // CASO A: Es una Confirmación (Ej: "¿Eliminar cliente?") -> USAR MODAL
  if (typeof onConfirm === 'function') {
    showMessage(message, onConfirm, options);
    return;
  }

  // CASO B: Es solo información -> USAR TOAST
  // Detectamos si es error buscando palabras clave o si pasas options.type
  const isError = options.type === 'error' ||
    message.toLowerCase().includes('error') ||
    message.toLowerCase().includes('falló') ||
    message.startsWith('⚠️');

  if (isError) {
    toast.error(message, { duration: 4000 });
  } else {
    toast.success(message, { duration: 3000 });
  }
}

/**
 * Genera un identificador unico universal (UUID v4).
 * Mucho mas seguro que Date.now() para evitar duplicados.
 * Ejemplo: '3b12f1df-5232-4e6c-8a8b-1a2b3c4d5e6f'
 */

export const generateID = (prefix = '') => {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
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
 */
export const compressImage = (
  file,
  targetSize = 300, // 300px es perfecto para tarjetas de POS
  quality = 0.6     // 60% calidad en WebP es muy ligero y se ve bien
) => {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error("El archivo no es una imagen válida."));
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onload = () => {
      // Usamos un pequeño delay para no congelar la UI
      setTimeout(() => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext("2d");

          let sourceX = 0;
          let sourceY = 0;
          let sourceWidth = img.width;
          let sourceHeight = img.height;

          // Recorte cuadrado centrado (Center Crop)
          if (sourceWidth > sourceHeight) {
            sourceX = (sourceWidth - sourceHeight) / 2;
            sourceWidth = sourceHeight;
          } else if (sourceHeight > sourceWidth) {
            sourceY = (sourceHeight - sourceWidth) / 2;
            sourceHeight = sourceWidth;
          }

          canvas.width = targetSize;
          canvas.height = targetSize;

          // Dibujar imagen redimensionada
          ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetSize, targetSize);

          // Convertir a WebP (Formato de nueva generación, muy ligero)
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(objectUrl);

              if (!blob) {
                reject(new Error("Error al procesar imagen."));
                return;
              }

              // Creamos un nuevo archivo WebP
              const newFileName = file.name.replace(/\.[^/.]+$/, "") + '.webp';
              const webpFile = new File([blob], newFileName, {
                type: 'image/webp',
                lastModified: Date.now()
              });

              resolve(webpFile);
            },
            'image/webp',
            quality
          );
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Error durante el procesamiento."));
        }
      }, 50);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Error al cargar la imagen."));
    };
  });
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
    console.error('LocalStorage error:', e);
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

  // 1. Revisar si está agotado
  const isOutOfStock = product.trackStock && product.stock <= 0;

  // 2. Revisar stock bajo (solo si no está agotado)
  if (
    product.trackStock &&
    product.stock > 0 &&
    product.stock < LOW_STOCK_THRESHOLD
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
  console.log(`Buscando API para: ${barcode}`);

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
      console.log('Producto no encontrado en OpenFoodFacts (404).');
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

      console.log('Producto encontrado:', productData);
      return { success: true, product: productData };

    } else {
      // La API respondió OK, pero el producto no estaba (status: 0)
      console.log('Producto no encontrado en OpenFoodFacts (status 0).');
      return { success: false, error: 'Producto no encontrado' };
    }
  } catch (error) { // Esto ahora solo captura errores REALES (ej. sin internet)
    console.error('Error al llamar a la API de OpenFoodFacts:', error);
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
        console.log(`Solicitud de persistencia: ${result ? 'CONCEDIDA ✅' : 'DENEGADA ⚠️'}`);
        return result;
      }
      return true; // Ya estaba persistente
    } catch (error) {
      console.error("Error solicitando persistencia:", error);
      return false;
    }
  }
  return false;
};