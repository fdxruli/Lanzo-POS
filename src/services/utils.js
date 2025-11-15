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
 * Comprime una imagen a un tamaño máximo y calidad específicos.
 * @param {File} file El archivo de imagen a comprimir.
 * @param {number} maxWidth El ancho máximo de la imagen resultante.
 * @param {number} quality La calidad de la imagen resultante (0 a 1).
 * @returns {Promise<string>} Una promesa que resuelve con la URL en base64 de la imagen comprimida.
 */
// Dentro de utils.js

export const compressImage = (
    file,
    targetSize = 300, // Un solo tamaño para ancho y alto
    quality = 0.7
) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas'); // No necesitas un canvas en el HTML
        const ctx = canvas.getContext("2d");

        img.onload = () => {
            let sourceX = 0;
            let sourceY = 0;
            let sourceWidth = img.width;
            let sourceHeight = img.height;

            // Lógica para el recorte cuadrado
            if (sourceWidth > sourceHeight) { // Imagen horizontal
                sourceX = (sourceWidth - sourceHeight) / 2;
                sourceWidth = sourceHeight;
            } else if (sourceHeight > sourceWidth) { // Imagen vertical
                sourceY = (sourceHeight - sourceWidth) / 2;
                sourceHeight = sourceWidth;
            }
            // Si ya es cuadrada, no hace nada

            canvas.width = targetSize;
            canvas.height = targetSize;

            // Dibuja la parte recortada de la imagen en el canvas
            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetSize, targetSize);
            
            // Convierte el canvas a una URL de datos base64
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            resolve(dataUrl); // Devolvemos la imagen como base64
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
    if (!response.ok) {
      throw new Error('Respuesta de red no fue exitosa');
    }

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
      // Producto no encontrado en la base de datos
      console.log('Producto no encontrado en OpenFoodFacts.');
      return { success: false, error: 'Producto no encontrado' };
    }
  } catch (error) {
    console.error('Error al llamar a la API de OpenFoodFacts:', error);
    return { success: false, error: `Error de red: ${error.message}` };
  }
}
