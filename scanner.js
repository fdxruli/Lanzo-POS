import { showMessageModal } from './utils.js';
import { STORES } from './database.js';

const SCAN_TARGETS = {
    ADD_TO_ORDER: 'addToOrder',
    PRODUCT_INPUT: 'productInput' // Un nuevo target para claridad
}

// Dependencias de app.js
let loadDataWithCache;
let addMultipleItemsToOrder;

// --- ELEMENTOS DEL DOM ---
const scanBarcodeBtn = document.getElementById('scan-barcode-btn');
const scannerModal = document.getElementById('scanner-modal');
const closeScannerBtn = document.getElementById('close-scanner-btn');
const scanForInputBtn = document.getElementById('scan-for-input-btn');
const scannerVideo = document.getElementById('scanner-video');
// --- Elementos del modal mejorado ---
const modalContent = scannerModal.querySelector('.modal-content');
const modalTitle = scannerModal.querySelector('.modal-title');
const scannedItemsList = document.getElementById('scanned-items-list');
const scannerTotal = document.getElementById('scanner-total');
const confirmScanBtn = document.getElementById('confirm-scan-btn');


// --- VARIABLES DEL MÓDULO ---
let scannerTarget = null;
let targetInputElement = null; // Guardará la referencia al input del producto
let codeReader = null;
let selectedDeviceId = null;
let lastCode = '';
let lastScanTime = 0;
const cooldown = 1000; // 1 segundo de enfriamiento
let scannedItems = [];

// ... (SUPPORTED_FORMATS se mantiene igual)
const SUPPORTED_FORMATS = [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.CODABAR, ZXing.BarcodeFormat.QR_CODE,
];

/**
 * --- NUEVO: Actualiza la UI del modal según el modo ---
 */
const updateScannerUI = (mode) => {
    if (!modalContent || !modalTitle) return;

    if (mode === SCAN_TARGETS.ADD_TO_ORDER) {
        modalTitle.textContent = 'Escanear Productos';
        modalContent.classList.remove('simple-scan-mode');
        modalContent.classList.add('pos-scan-mode');
    } else { // Modo para input
        modalTitle.textContent = 'Escanear Código de Barras';
        modalContent.classList.add('simple-scan-mode');
        modalContent.classList.remove('pos-scan-mode');
    }
};

/**
 * Inicia el escáner, configurando la UI según el target.
 */
const startScanner = async () => {
    if (!scannerModal || !scannerVideo) return;

    // Configurar la UI ANTES de mostrar el modal
    updateScannerUI(scannerTarget);

    scannedItems = [];
    renderScannedItems();

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('La cámara no es compatible con este navegador.');
        }

        codeReader = new ZXing.BrowserMultiFormatReader();
        const videoInputDevices = await codeReader.listVideoInputDevices();

        if (videoInputDevices.length > 0) {
            // Intenta encontrar la cámara trasera por defecto
            const rearCamera = videoInputDevices.find(d => d.label.toLowerCase().includes('back'));
            selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;

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
 * Procesa el resultado del escaneo según el modo activo.
 */
const handleScanResult = async (code) => {
    const trimmedCode = code ? code.trim() : "";
    if (!trimmedCode) return;

    // --- LÓGICA CONDICIONAL ---
    if (scannerTarget === SCAN_TARGETS.ADD_TO_ORDER) {
        const menu = await loadDataWithCache(STORES.MENU);
        const product = menu.find(p => p.barcode === trimmedCode);

        if (product) {
            const existingItem = scannedItems.find(item => item.id === product.id);
            if (existingItem) {
                existingItem.quantity++;
            } else {
                scannedItems.push({ ...product, quantity: 1 });
            }
            renderScannedItems();
        } else {
            showMessageModal(`Producto con código de barras "${trimmedCode}" no encontrado.`);
        }
    } else if (scannerTarget === SCAN_TARGETS.PRODUCT_INPUT && targetInputElement) {
        targetInputElement.value = trimmedCode;
        // Disparamos un evento para que cualquier listener en el input reaccione
        targetInputElement.dispatchEvent(new Event('input', { bubbles: true }));
        stopScanner(); // En este modo, cerramos el modal inmediatamente
    }
};

// ... (renderScannedItems, stopScanner, decodeFromDevice se mantienen sin cambios)
const renderScannedItems = () => {
    if (!scannedItemsList || !scannerTotal) return;
    scannedItemsList.innerHTML = '';
    if (scannedItems.length === 0) {
        scannedItemsList.innerHTML = '<p class="empty-message">Aún no hay productos escaneados.</p>';
        scannerTotal.textContent = '$0.00';
        return;
    }
    let currentTotal = 0;
    scannedItems.forEach(item => {
        const itemTotal = item.price * item.quantity;
        currentTotal += itemTotal;
        const itemElement = document.createElement('div');
        itemElement.className = 'scanned-item';
        itemElement.innerHTML = `
            <span class="scanned-item-name">${item.name}</span>
            <div class="scanned-item-controls">
                <button class="quantity-btn" data-id="${item.id}" data-change="-1">-</button>
                <span class="quantity-value">${item.quantity}</span>
                <button class="quantity-btn" data-id="${item.id}" data-change="1">+</button>
            </div>
            <span class="scanned-item-price">$${itemTotal.toFixed(2)}</span>
            <button class="remove-item-btn" data-id="${item.id}">X</button>
        `;
        scannedItemsList.appendChild(itemElement);
    });
    scannerTotal.textContent = `$${currentTotal.toFixed(2)}`;
};

const stopScanner = () => {
    if (codeReader) {
        codeReader.reset();
        codeReader = null;
    }
    if (scannerModal) scannerModal.classList.add('hidden');
    lastCode = '';
    lastScanTime = 0;
    scannerTarget = null;
    targetInputElement = null;
    scannedItems = [];
    renderScannedItems();
};

const decodeFromDevice = (deviceId) => {
    if (codeReader) codeReader.reset();
    codeReader.decodeFromVideoDevice(
        deviceId, 'scanner-video', (result, err) => {
            if (result) {
                const code = result.text.trim();
                const now = Date.now();

                if (code === lastCode && (now - lastScanTime < cooldown)) {
                    // Mismo código, demasiado pronto, ignorar.
                    return;
                }

                // Si es un código nuevo O el mismo código después del cooldown
                lastCode = code;
                lastScanTime = now;

                if (navigator.vibrate) navigator.vibrate(100);
                handleScanResult(code);
            }
            if (err && !(err instanceof ZXing.NotFoundException)) {
                // No loguear NotFoundException, es muy común y llena la consola
                console.warn('Error de escaneo:', err);
            }
        }
    ).catch(err => console.error(`Error al decodificar:`, err));
};


/**
 * Inicializa el módulo, asignando los targets correctos a cada botón.
 */
export function initScannerModule(dependencies) {
    loadDataWithCache = dependencies.loadDataWithCache;
    addMultipleItemsToOrder = dependencies.addMultipleItemsToOrder;

    if (scanBarcodeBtn) {
        scanBarcodeBtn.addEventListener('click', () => {
            scannerTarget = SCAN_TARGETS.ADD_TO_ORDER;
            startScanner();
        });
    }

    if (scanForInputBtn) {
        scanForInputBtn.addEventListener('click', () => {
            scannerTarget = SCAN_TARGETS.PRODUCT_INPUT;
            targetInputElement = document.getElementById('product-barcode');
            startScanner();
        });
    }

    if (closeScannerBtn) closeScannerBtn.addEventListener('click', stopScanner);

    if (confirmScanBtn) confirmScanBtn.addEventListener('click', () => {
        if (scannedItems.length > 0) addMultipleItemsToOrder(scannedItems);
        stopScanner();
    });

    if (scannedItemsList) {
        scannedItemsList.addEventListener('click', e => {
            const button = e.target.closest('button[data-id]');
            if (!button) return;
            const { id, change } = button.dataset;
            const itemIndex = scannedItems.findIndex(i => i.id === id);
            if (itemIndex === -1) return;
            if (button.classList.contains('quantity-btn')) {
                scannedItems[itemIndex].quantity += parseInt(change);
                if (scannedItems[itemIndex].quantity <= 0) scannedItems.splice(itemIndex, 1);
            } else if (button.classList.contains('remove-item-btn')) {
                scannedItems.splice(itemIndex, 1);
            }
            renderScannedItems();
        });
    }

    console.log('Conditional scanner module initialized.');
}