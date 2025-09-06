import { showMessageModal } from './utils.js';
import { STORES } from './database.js';

const SCAN_TARGETS = {
    ADD_TO_ORDER: 'addToOrder',
}

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
let scanAttempts = 0;
let lastScannedCode = '';

// --- CONFIGURACIÓN DE FORMATOS DE CÓDIGO ---
const SUPPORTED_FORMATS = [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.CODABAR,
    // QR Code para el futuro
    ZXing.BarcodeFormat.QR_CODE,
];

// --- OPTIMIZACIONES DE RENDIMIENTO ---
// Preparamos un canvas para procesamiento de imagen
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

/**
 * Inicia el escáner, solicitando acceso a la cámara y configurando los dispositivos.
 */
const startScanner = async () => {
    if (!scannerModal || !scannerVideo || !cameraSelect) return;

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('La cámara no es compatible con este navegador.');
        }

        // Configuración optimizada para POS
        const constraints = {
            video: {
                facingMode: "environment",
                width: { ideal: 1280, max: 1920 },  // Reducimos resolución para mejor rendimiento
                height: { ideal: 720, max: 1080 },
                // Priorizamos framerate sobre resolución para escaneo rápido
                frameRate: { ideal: 30, min: 20 }
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

            // Intenta seleccionar la cámara trasera
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

    // Configuramos hints para optimizar el escaneo
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, false); // Mejor rendimiento
    hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true); // Escanear códigos invertidos

    // Configuración de constraints para el dispositivo seleccionado
    const constraints = {
        deviceId: { exact: deviceId },
        video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    codeReader.decodeFromVideoDevice(
        deviceId, 
        'scanner-video', 
        (result, err) => {
            if (result) {
                const code = result.text;
                
                // Evitar procesar el mismo código múltiples veces
                if (!isScanning && code !== lastScannedCode) {
                    isScanning = true;
                    lastScannedCode = code;
                    
                    // Feedback háptico
                    if (navigator.vibrate) {
                        navigator.vibrate(100);
                    }
                    
                    handleScanResult(code);

                    // Prevenir escaneos duplicados por un breve periodo
                    clearTimeout(scanTimeout);
                    scanTimeout = setTimeout(() => {
                        isScanning = false;
                        scanAttempts = 0;
                    }, 1000);
                }
            }
            
            if (err) {
                if (!(err instanceof ZXing.NotFoundException)) {
                    console.warn('Error de escaneo:', err);
                }
                
                // Incrementar contador de intentos fallidos
                scanAttempts++;
                
                // Si hay muchos intentos fallidos, intentar mejorar la imagen
                if (scanAttempts > 15) {
                    applyImageEnhancement();
                    scanAttempts = 0;
                }
            }
        },
        {
            constraints: constraints,
            // Enfocamos en el área central (región de interés)
            regionOfInterest: {
                x: Math.round(scannerVideo.videoWidth * 0.2),
                y: Math.round(scannerVideo.videoHeight * 0.2),
                width: Math.round(scannerVideo.videoWidth * 0.6),
                height: Math.round(scannerVideo.videoHeight * 0.6)
            }
        }
    ).catch(err => {
        console.error(`Error al decodificar desde el dispositivo ${deviceId}:`, err);
    });
};

/**
 * Aplica mejoras a la imagen para facilitar el escaneo
 */
const applyImageEnhancement = () => {
    if (!scannerVideo.videoWidth || !scannerVideo.videoHeight) return;
    
    // Configurar canvas con las dimensiones del video
    offscreenCanvas.width = scannerVideo.videoWidth;
    offscreenCanvas.height = scannerVideo.videoHeight;
    
    // Dibujar el frame actual en el canvas
    offscreenCtx.drawImage(scannerVideo, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    // Obtener los datos de la imagen
    const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    const data = imageData.data;
    
    // Aplicar contraste para mejorar la legibilidad del código de barras
    const contrast = 1.5; // Aumentar contraste
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    
    for (let i = 0; i < data.length; i += 4) {
        // Ajustar contraste
        data[i] = factor * (data[i] - 128) + 128;     // R
        data[i + 1] = factor * (data[i + 1] - 128) + 128; // G
        data[i + 2] = factor * (data[i + 2] - 128) + 128; // B
        
        // Convertir a escala de grises (más eficiente para el escaneo)
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = data[i + 1] = data[i + 2] = avg;
    }
    
    // Devolver la imagen procesada al canvas
    offscreenCtx.putImageData(imageData, 0, 0);
    
    // Intentar escanear desde la imagen mejorada
    try {
        codeReader.decodeFromCanvas(offscreenCanvas, (result, err) => {
            if (result) {
                handleScanResult(result.text);
            }
        });
    } catch (error) {
        console.warn("Error al procesar imagen mejorada:", error);
    }
};

/**
 * Detiene el escáner y cierra el modal.
 */
const stopScanner = () => {
    if (codeReader) {
        codeReader.reset();
        codeReader = null;
    }
    if (scannerModal) {
        scannerModal.classList.add('hidden');
    }
    if (scanTimeout) {
        clearTimeout(scanTimeout);
        scanTimeout = null;
    }
    isScanning = false;
    scanAttempts = 0;
    scannerTarget = null;
    lastScannedCode = '';
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
        if (currentTarget === SCAN_TARGETS.ADD_TO_ORDER) {
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
            scannerTarget = SCAN_TARGETS.ADD_TO_ORDER;
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

    console.log('Scanner module optimized for POS environment.');
}