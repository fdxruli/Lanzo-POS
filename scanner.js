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
const scannerOverlay = document.getElementById('scanner-overlay');

// --- VARIABLES DEL MÓDULO ---
let scannerTarget = null;
let codeReader = null;
let selectedDeviceId = null;
let scanTimeout = null;
let isScanning = false;

// --- CONFIGURACIÓN DE FORMATOS DE CÓDIGO ---
// Añadimos más formatos comunes como CODE_128
const SUPPORTED_FORMATS = [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.EAN_8,
];

/**
 * Inicia el escáner, solicitando acceso a la cámara y configurando los dispositivos.
 */
const startScanner = async () => {
    if (!scannerModal || !scannerVideo || !cameraSelect) return;

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('La cámara no es compatible con este navegador.');
        }

        // --- OPTIMIZACIÓN DE CÁMARA ---
        // Pedimos la cámara trasera por defecto ("environment") y una resolución HD.
        const constraints = {
            video: {
                facingMode: "environment", // Prioriza la cámara trasera
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        codeReader = new ZXing.BrowserMultiFormatReader();
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

            // Intenta seleccionar la cámara trasera inteligentemente
            const rearCamera = videoInputDevices.find(device =>
                device.label.toLowerCase().includes('back') ||
                device.label.toLowerCase().includes('rear') ||
                device.label.toLowerCase().includes('trasera')
            );
            selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;
            cameraSelect.value = selectedDeviceId;

            scannerModal.classList.remove('hidden');
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

/**
 * Inicia el proceso de decodificación desde un dispositivo de video específico.
 * @param {string} deviceId - El ID del dispositivo de la cámara.
 */
const decodeFromDevice = (deviceId) => {
    if (codeReader) {
        codeReader.reset();
    }

    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true); // Pide a la librería que se esfuerce más

    codeReader.decodeFromVideoDevice(deviceId, 'scanner-video', (result, err) => {
        if (result) {
            if (!isScanning) {
                isScanning = true;
                // --- MEJORA: Vibración para feedback ---
                if (navigator.vibrate) {
                    navigator.vibrate(100); // Vibra por 100ms
                }
                handleScanResult(result.getText());

                clearTimeout(scanTimeout);
                scanTimeout = setTimeout(() => {
                    isScanning = false;
                }, 1500); // Aumentamos un poco el tiempo de espera para evitar lecturas dobles
            }
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.error('Error de escaneo:', err);
        }
    }).catch(err => {
        console.error(`Error al decodificar desde el dispositivo ${deviceId}:`, err);
    });
};

/**
 * Detiene el escáner y cierra el modal.
 */
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
};

/**
 * Procesa el código de barras una vez que es detectado.
 * @param {string} code - El código de barras detectado.
 */
const handleScanResult = async (code) => {
    const currentTarget = scannerTarget;
    const trimmedCode = code ? code.trim() : "";

    stopScanner(); // Detiene el escáner para evitar lecturas continuas

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
            currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (error) {
        console.error("Error al procesar el resultado del escaneo:", error);
        showMessageModal("Ocurrió un error al procesar el código.");
    }
};

/**
 * Inicializa el módulo del escáner, configurando los listeners de eventos.
 * @param {object} dependencies - Objeto con las dependencias de app.js.
 */
export function initScannerModule(dependencies) {
    loadDataWithCache = dependencies.loadDataWithCache;
    addItemToOrder = dependencies.addItemToOrder;

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

    console.log('Scanner module initialized with optimizations.');
}
