// utils.js

/**
 * Muestra un modal con un mensaje. Puede funcionar como un simple "Aceptar"
 * o como un modal de confirmación con una acción a ejecutar.
 * @param {string} message El mensaje a mostrar.
 * @param {function | null} onConfirm La función a ejecutar si el usuario confirma. Si es null, funciona como un modal simple.
 * @param {object} options Opciones adicionales, como un botón extra.
 */
export function showMessageModal(message, onConfirm = null, options = {}) {
    const messageModal = document.getElementById('message-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalButtons = messageModal.querySelector('.modal-buttons');

    if (!modalMessage || !messageModal || !modalButtons) {
        console.error('Modal elements not found!');
        return;
    }

    modalMessage.textContent = message;
    modalButtons.innerHTML = ''; // Limpiar botones previos

    const confirmMode = typeof onConfirm === 'function';

    if (options.extraButton) {
        const extraButton = document.createElement('button');
        extraButton.textContent = options.extraButton.text;
        extraButton.className = 'btn btn-secondary'; // Asignamos una clase para estilo
        extraButton.onclick = () => {
            messageModal.classList.add('hidden');
            options.extraButton.action();
        };
        modalButtons.appendChild(extraButton);
    }

    if (confirmMode) {
        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Sí, continuar';
        confirmButton.className = 'btn btn-confirm';
        confirmButton.onclick = () => {
            messageModal.classList.add('hidden');
            onConfirm();
        };
        modalButtons.appendChild(confirmButton);

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.className = 'btn btn-cancel';
        cancelButton.onclick = () => {
            messageModal.classList.add('hidden');
        };
        modalButtons.appendChild(cancelButton);
    } else {
        const acceptButton = document.createElement('button');
        acceptButton.textContent = 'Aceptar';
        acceptButton.className = 'btn btn-modal';
        acceptButton.onclick = () => {
            messageModal.classList.add('hidden');
        };
        modalButtons.appendChild(acceptButton);
    }

    messageModal.classList.remove('hidden');
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