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