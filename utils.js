// utils.js

/**
 * Muestra un modal con un mensaje. Puede funcionar como un simple "Aceptar"
 * o como un modal de confirmación con una acción a ejecutar.
 * @param {string} message El mensaje a mostrar.
 * @param {function | null} onConfirm La función a ejecutar si el usuario confirma. Si es null, funciona como un modal simple.
 */
export function showMessageModal(message, onConfirm = null) {
    const messageModal = document.getElementById('message-modal');
    const modalMessage = document.getElementById('modal-message');
    const closeModalBtn = document.getElementById('close-modal-btn');

    if (!modalMessage || !messageModal || !closeModalBtn) return;

    modalMessage.textContent = message;
    messageModal.classList.remove('hidden');

    const confirmMode = typeof onConfirm === 'function';

    closeModalBtn.textContent = confirmMode ? 'Sí, continuar' : 'Aceptar';

    // Se usa .onclick para reemplazar cualquier listener anterior y evitar ejecuciones múltiples
    closeModalBtn.onclick = () => {
        messageModal.classList.add('hidden');
        if (confirmMode) onConfirm();
    };
}

/**
 * Comprime una imagen a un tamaño máximo y calidad específicos.
 * @param {File} file El archivo de imagen a comprimir.
 * @param {number} maxWidth El ancho máximo de la imagen resultante.
 * @param {number} quality La calidad de la imagen resultante (0 a 1).
 * @returns {Promise<string>} Una promesa que resuelve con la URL en base64 de la imagen comprimida.
 */
export const compressImage = (
    file,
    maxWidth = 800,
    maxHeight= 800,
    quality = 0.6
) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.getElementById("canvas");
        const ctx = canvas.getContext("2d");

        img.onload = () => {
            //mantener proporciones
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
                const retio = Math.min(maxWidth / width, maxHeight / height);
                width = width * ratio;
                height = height * ratio;
            }

            canvas.width = width;
            canvas.height = height;

            //dibujar en el canvas
            ctx.drawImage(img, 0, 0, width, height);
            //convertir a Blob comprimido
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error("Error al comprimir la imagen"));
                        return;
                    }
                    //convertir Blob a file para que se pueda subir
                    const compressedfile = new File([blob], file.name, {
                        type: "image/jpeg",
                        lastModified: Date.now(),
                    });
                    resolve(compressedFile);
                },
                "image/jpeg",
                quality
            );
        };
        img.onerror = () => reject(new Error("Error al cargar la imagen"));
        img.src = URL.createObjetURL(file);
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