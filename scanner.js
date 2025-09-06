// scanner.js
import { showMessageModal } from './utils.js';
import { STORES } from './database.js';

// Las dependencias (funciones de app.js) se pasarán durante la inicialización
let loadDataWithCache;
let addItemToOrder;

// --- ELEMENTOS DEL DOM ---
const scanBarcodeBtn = document.getElementById('scan-barcode-btn');
const scannerModal = document.getElementById('scanner-modal');
const closeScannerBtn = document.getElementById('close-scanner-btn');
const scanForInputBtn = document.getElementById('scan-for-input-btn');
const scannerVideo = document.getElementById('scanner-video');
const cameraSelect = document.getElementById('camera-select');
const scannerControls = document.getElementById('scanner-controls');
const scannerOverlay = document.getElementById('scanner-overlay'); // Nuevo elemento para el overlay

// --- VARIABLES DEL MÓDULO ---
let scannerTarget = null;
let codeReader = null;
let selectedDeviceId = null;
let scanTimeout = null;
let isScanning = false;
let scanRegion = null; // Región de escaneo

// Configuración de formatos de código soportados
const SUPPORTED_FORMATS = [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.EAN_8,
];

// Función para calcular la región de escaneo
const calculateScanRegion = (video) => {
    if (!video.videoWidth || !video.videoHeight) return null;

    // Definimos un rectángulo central del 60% de ancho y 30% de alto
    const width = video.videoWidth * 0.6;
    const height = video.videoHeight * 0.3;
    const x = (video.videoWidth - width) / 2;
    const y = (video.videoHeight - height) / 2;

    return { x, y, width, height };
};

// Función para actualizar el overlay visual
const updateScannerOverlay = () => {
    if (!scannerVideo || !scannerOverlay) return;

    // Calculamos las dimensiones del video en pantalla
    const videoRect = scannerVideo.getBoundingClientRect();

    // Posicionamos el overlay sobre el video
    scannerOverlay.style.width = `${videoRect.width}px`;
    scannerOverlay.style.height = `${videoRect.height}px`;
    scannerOverlay.style.top = `${videoRect.top}px`;
    scannerOverlay.style.left = `${videoRect.left}px`;

    // Creamos el rectángulo de escaneo
    const scanWidth = videoRect.width * 0.6;
    const scanHeight = videoRect.height * 0.3;
    const scanX = (videoRect.width - scanWidth) / 2;
    const scanY = (videoRect.height - scanHeight) / 2;

    // Actualizamos el pseudo-elemento del overlay
    scannerOverlay.style.setProperty('--scan-width', `${scanWidth}px`);
    scannerOverlay.style.setProperty('--scan-height', `${scanHeight}px`);
    scannerOverlay.style.setProperty('--scan-x', `${scanX}px`);
    scannerOverlay.style.setProperty('--scan-y', `${scanY}px`);
};

const startScanner = async () => {
    if (!scannerModal || !scannerVideo || !cameraSelect) return;
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('La cámara no es compatible con este navegador.');
        }

        codeReader = new ZXing.BrowserMultiFormatReader();
        // Define las restricciones para solicitar una mejor resolución de la cámara
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        codeReader = new ZXing.BrowserMultiFormatReader(null, { constraints });
        const videoInputDevices = await codeReader.listVideoInputDevices();

        cameraSelect.innerHTML = '';
        if (videoInputDevices.length > 0) {
            videoInputDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Cámara ${cameraSelect.length + 1}`;
                cameraSelect.appendChild(option);
            });

            scannerControls.style.display = videoInputDevices.length > 1 ? 'block' : 'none';
            const rearCamera = videoInputDevices.find(device =>
                device.label.toLowerCase().includes('back') ||
                device.label.toLowerCase().includes('rear') ||
                device.label.toLowerCase().includes('trasera')
            );

            selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;
            cameraSelect.value = selectedDeviceId;
            scannerModal.classList.remove('hidden');

            // Configuramos el listener para actualizar el overlay cuando el video esté listo
            scannerVideo.addEventListener('loadedmetadata', () => {
                scanRegion = calculateScanRegion(scannerVideo);
                updateScannerOverlay();
            });

            // Iniciamos el escaneo
            decodeFromDevice(selectedDeviceId);
        } else {
            showMessageModal('No se encontraron cámaras en este dispositivo.');
        }
    } catch (error) {
        console.error('Error al iniciar el escáner:', error);
        let message = 'No se pudo acceder a la cámara. Asegúrate de haber dado los permisos necesarios.';
        if (error.name === "NotAllowedError") {
            message = "Has bloqueado el acceso a la cámara. Por favor, habilítalo en la configuración de tu navegador.";
        }
        showMessageModal(message);
    }
};

const decodeFromDevice = (deviceId) => {
    if (codeReader) {
        codeReader.reset();
    }

    // Configurar hints para optimizar la detección
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

    // Si tenemos una región de escaneo definida, la usamos
    const options = scanRegion ? { hints, region: scanRegion } : { hints };

    codeReader.decodeFromVideoDevice(deviceId, 'scanner-video', (result, err) => {
        if (result) {
            // Implementar throttling para evitar múltiples lecturas rápidas
            if (!isScanning) {
                isScanning = true;
                handleScanResult(result.getText());

                // Restablecer el estado después de un breve período
                clearTimeout(scanTimeout);
                scanTimeout = setTimeout(() => {
                    isScanning = false;
                }, 1000); // 1 segundo de bloqueo entre lecturas
            }
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.error('Error de escaneo:', err);
        }
    }, options).catch(err => {
        console.error(`Error al decodificar desde el dispositivo ${deviceId}:`, err);
    });
};

const stopScanner = () => {
    if (codeReader) {
        codeReader.reset();
    }
    if (scannerModal) {
        scannerModal.classList.add('hidden');
    }
    if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
    }
    isScanning = false;
    scannerTarget = null;
    scanRegion = null;
};

const handleScanResult = async (code) => {
    // 1. Guardar el objetivo y el código ANTES de limpiar el estado
    const currentTarget = scannerTarget;
    const trimmedCode = code ? code.trim() : "";

    // 2. Ahora, detener el escáner y limpiar las variables globales
    stopScanner();

    // 3. Procesar el resultado usando las variables locales guardadas
    if (!trimmedCode) {
        console.warn("El escaneo resultó en un código vacío.");
        return;
    }

    try {
        if (currentTarget === 'addToOrder') {
            const menu = await loadDataWithCache(STORES.MENU);
            const product = menu.find(p => p.barcode === trimmedCode);
            if (product) {
                addItemToOrder(product);
            } else {
                showMessageModal(`Producto con código de barras "${trimmedCode}" no encontrado.`);
            }
        } else if (currentTarget && typeof currentTarget.value !== 'undefined') {
            currentTarget.value = trimmedCode;
            // Disparamos un evento para que cualquier listener en el campo se active
            currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (error) {
        console.error("Error al procesar el resultado del escaneo:", error);
        showMessageModal("Ocurrió un error al procesar el código.");
    }
};

/**
 * Inicializa el módulo del escáner y configura los event listeners.
 * @param {object} dependencies - Un objeto con las funciones necesarias de app.js.
 */
export function initScannerModule(dependencies) {
    // Asigna las funciones pasadas a las variables locales
    loadDataWithCache = dependencies.loadDataWithCache;
    addItemToOrder = dependencies.addItemToOrder;

    // --- EVENT LISTENERS ---
    if (scanBarcodeBtn) {
        scanBarcodeBtn.addEventListener('click', () => {
            scannerTarget = 'addToOrder';
            startScanner();
        });
    }
    if (scanForInputBtn) {
        scanForInputBtn.addEventListener('click', () => {
            scannerTarget = document.getElementById('product-barcode');
            startScanner();
        });
    }
    if (closeScannerBtn) {
        closeScannerBtn.addEventListener('click', stopScanner);
    }
    if (cameraSelect) {
        cameraSelect.addEventListener('change', () => {
            selectedDeviceId = cameraSelect.value;
            decodeFromDevice(selectedDeviceId);
        });
    }

    // Actualizar overlay cuando la ventana cambia de tamaño
    window.addEventListener('resize', updateScannerOverlay);

    console.log('Scanner module initialized.');
}