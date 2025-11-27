// utils.js

// 1. Importa la nueva función 'show' de tu store
import { showMessage } from '../store/useMessageStore';

/**
 * Muestra un modal con un mensaje.
 * ¡YA NO MANIPULA EL DOM! Ahora llama al store de React.
 */
export function showMessageModal(message, onConfirm = null, options = {}) {
  // 2. Reemplaza TODO el cuerpo de la función con esta línea:
  showMessage(message, onConfirm, options);
}

/**
 * Comprime, recorta a cuadrado y convierte una imagen a WebP.
 * @param {File} file El archivo de imagen a comprimir.
 * @param {number} targetSize El tamaño (ancho y alto) de la imagen resultante.
 * @param {number} quality La calidad de WebP (0 a 1). 0.7 es un buen balance.
 * @returns {Promise<File>} Una promesa que resuelve con el nuevo archivo de imagen .webp.
 */
export const compressImage = (
  file,
  targetSize = 300, // Un solo tamaño para ancho y alto
  quality = 0.7 // Calidad de compresión para WebP
) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = img.width;
      let sourceHeight = img.height;

      // Lógica para el recorte cuadrado (sin cambios)
      if (sourceWidth > sourceHeight) {
        sourceX = (sourceWidth - sourceHeight) / 2;
        sourceWidth = sourceHeight;
      } else if (sourceHeight > sourceWidth) {
        sourceY = (sourceHeight - sourceWidth) / 2;
        sourceHeight = sourceWidth;
      }

      canvas.width = targetSize;
      canvas.height = targetSize;

      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetSize, targetSize);

      // ======================================================
      // ¡LA MAGIA OCURRE AQUÍ!
      // ======================================================

      // 1. Usamos 'toBlob' que es asíncrono y mejor que 'toDataURL'
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Error al crear el blob de la imagen."));
            return;
          }
          // 2. Creamos un nuevo objeto File con el formato WebP
          const newFileName = file.name.split('.')[0] + '.webp';
          const webpFile = new File([blob], newFileName, {
            type: 'image/webp', // 3. El tipo es WebP
            lastModified: Date.now()
          });
          resolve(webpFile); // Devolvemos el ARCHIVO, no un Base64
        },
        'image/webp', // 4. Solicitamos el formato WebP
        quality       // 5. Aplicamos la calidad
      );
      // ======================================================
    };

    img.onerror = (err) => reject(new Error("Error al cargar la imagen."));
    img.src = URL.createObjectURL(file);
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