// app.js
import { showMessageModal, compressImage, getContrastColor, isLocalStorageEnabled, normalizeDate } from './utils.js';
import { initDB, saveData, loadData, deleteData, STORES } from './database.js';
import { initScannerModule } from './scanner.js';
import { initCustomersModule } from './customers.js';
import { createDashboardModule } from './dashboard.js';
import { createBusinessTipsModule } from './business-tips.js';
import { initializeDonationSection } from './donation-seccion.js';
import { initCajaModule, validarCaja, getCajaActual } from './caja.js';
import { createTickerModule } from './ticker.js';

// --- LÓGICA PARA MENSAJES DINÁMICOS EN VENTA A GRANEL ---
    const updateBulkMessages = () => {
        const purchaseQty = parseFloat(bulkPurchaseQuantityInput.value);
        const purchaseCost = parseFloat(bulkPurchaseCostInput.value);
        const salePrice = parseFloat(bulkSalePriceInput.value);
        const unit = bulkPurchaseUnitInput.value;

        let costPerUnit = 0;
        if (purchaseQty > 0 && purchaseCost > 0) {
            costPerUnit = purchaseCost / purchaseQty;
            bulkCostPerUnitMessage.textContent = `El costo por ${unit} es de ${costPerUnit.toFixed(2)}.`;
            bulkCostPerUnitMessage.style.display = 'block';
        } else {
            bulkCostPerUnitMessage.style.display = 'none';
        }

        if (costPerUnit > 0 && salePrice > 0) {
            const profitMargin = ((salePrice - costPerUnit) / salePrice) * 100; // Corregido para margen sobre el precio de venta
            bulkProfitMarginMessage.textContent = `Con este precio estás ganando un ${profitMargin.toFixed(2)}%.`;
            bulkProfitMarginMessage.style.display = 'block';
        } else {
            bulkProfitMarginMessage.style.display = 'none';
        }
    };

    // --- LÓGICA PARA MENSAJES DINÁMICOS EN VENTA POR UNIDAD ---
    const updateUnitMessages = () => {
        if (!productCostInput || !productPriceInput || !unitProfitMarginMessage) return;

        const cost = parseFloat(productCostInput.value);
        const price = parseFloat(productPriceInput.value);

        if (cost > 0 && price > 0) {
            const profitMargin = ((price - cost) / price) * 100; // Corregido para margen sobre el precio de venta
            unitProfitMarginMessage.textContent = `Con este precio estás ganando un ${profitMargin.toFixed(2)}%.`;
            unitProfitMarginMessage.style.display = 'block';
        } else {
            unitProfitMarginMessage.style.display = 'none';
        }
    };

document.addEventListener('DOMContentLoaded', () => {

    // --- VARIABLES GLOBALES Y DATOS INICIALES ---
    let isAppUnlocked = false;
    let order = [];
    let dashboard, businessTips, ticker; // Declarar módulos aquí
    let customersForSale = []; // Variable para guardar los clientes cargados

    const initialMenu = [
        {
            id: 'burger-classic',
            name: 'Hamburguesa Clásica',
            price: 8.50,
            cost: 5.00,
            description: 'Carne 100% res, lechuga, tomate y salsa especial.',
            image: 'https://placehold.co/150x100/FFC107/000000?text=Clásica',
            ingredients: [], // Nuevo campo para ingredientes
            stock: 20, // Cantidad inicial en inventario
            categoryId: '',
            TrackEvent: true
        }
    ];
    const defaultTheme = {
        id: 'theme',
        primaryColor: '#374151',
        secondaryColor: '#3b82f6',
        backgroundColor: '#f3f4f6',
        cardBackgroundColor: '#ffffff',
        textColor: '#374151',
        cardTextColor: '#374151',
        fontSize: 'medium',
        layoutDensity: 'spacious'
    };
    // Variables para la gestión de ingredientes
    let currentIngredients = [];
    let editingProductId = null;

    // --- SISTEMA DE CACHÉ PARA DATOS FRECUENTES ---
    const dataCache = {
        menu: null,
        company: null,
        theme: null,
        categories: null,
        lastUpdated: {
            menu: 0,
            company: 0,
            theme: 0,
            categories: 0
        }
    };

    const loadDataWithCache = async (storeName, key = null, maxAge = 300000) => {
        const now = Date.now();

        // Check cache for the specific storeName
        const cachedData = dataCache[storeName];
        const lastUpdated = dataCache.lastUpdated[storeName];

        if (cachedData !== null && (now - lastUpdated < maxAge)) {
            // Cache is fresh
            if (key) {
                // If a key is requested, and cachedData is an array, try to find the item
                if (Array.isArray(cachedData)) {
                    const item = cachedData.find(item => item.id === key);
                    if (item) return item;
                } else if (cachedData.id === key) {
                    // If cachedData is a single object and matches the key
                    return cachedData;
                }
                // If key is requested but not found in cache, or cache is not an array when expected,
                // proceed to load from DB.
            } else {
                // No key requested, return the whole cached data (expected to be an array for MENU)
                return cachedData;
            }
        }

        // Cache is stale or item not found in cache, load from IndexedDB
        const data = await loadData(storeName, key);

        // Update cache based on storeName and whether a key was used
        if (key === null) {
            // If loading the whole store (no key), cache the entire result
            dataCache[storeName] = data;
            dataCache.lastUpdated[storeName] = now;
        } else {
            // If loading a single item by key:
            // For stores that are typically arrays (like MENU), update the item within the cached array
            if (storeName === STORES.MENU && Array.isArray(dataCache[storeName])) {
                const index = dataCache[storeName].findIndex(item => item.id === key);
                if (index > -1) {
                    dataCache[storeName][index] = data; // Update existing item
                } else {
                    dataCache[storeName].push(data); // Add new item if not present
                }
                // No need to update lastUpdated for the whole array here, as it's a partial update.
                // The full array's lastUpdated will be set when it's fully reloaded.
            } else {
                // For other stores or if the cache isn't an array, just cache the single item
                dataCache[storeName] = data;
                dataCache.lastUpdated[storeName] = now;
            }
        }
        return data;
    };

    // --- FUNCIÓN AUXILIAR PARA ACTUALIZACIÓN GRANULAR DE CACHÉ ---
    const updateMenuCache = (productData) => {
        // Solo proceder si la caché del menú ya ha sido cargada alguna vez
        if (dataCache.menu && Array.isArray(dataCache.menu)) {
            const index = dataCache.menu.findIndex(p => p.id === productData.id);

            if (index > -1) {
                // Si el producto ya existe en la caché, lo actualizamos
                dataCache.menu[index] = productData;
                console.log('Cache: Producto actualizado', productData.name);
            } else {
                // Si es un producto nuevo, lo añadimos al final
                dataCache.menu.push(productData);
                console.log('Cache: Producto nuevo añadido', productData.name);
            }
        }
        // Si la caché es null, no hacemos nada. Se cargará de la base de datos
        // la próxima vez que se necesite, lo cual es el comportamiento esperado.
    };

    // Función para guardar licencia en cookies (fallback) idexedDB
    const saveLicenseToCookie = (licenseData) => {
        const cookieValue = JSON.stringify(licenseData);
        const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días
        document.cookie = `lanzo_license=${encodeURIComponent(cookieValue)}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict; Secure`;
        console.log('License saved to cookie as fallback');
    };
    // Función para obtener licencia de cookies
    const getLicenseFromCookie = () => {
        const match = document.cookie.match(/lanzo_license=([^;]+)/);
        if (match) {
            try {
                return JSON.parse(decodeURIComponent(match[1]));
            } catch (e) {
                console.error('Error parsing license from cookie:', e);
            }
        }
        return null;
    };
    // saveLicenseToIndexedDB para también guardar en cookie
    const saveLicenseToIndexedDB = async (licenseData) => {
        try {
            await saveData(STORES.COMPANY, {
                id: 'license_backup',
                data: licenseData,
                timestamp: new Date().toISOString()
            });
            saveLicenseToCookie(licenseData); // Agrega fallback
            console.log('License backed up to IndexedDB and cookie');
        } catch (error) {
            console.error('Error saving license to IndexedDB:', error);
        }
    };
    // getLicenseFromIndexedDB para fallback a cookie
    const getLicenseFromIndexedDB = async () => {
        try {
            const backup = await loadData(STORES.COMPANY, 'license_backup');
            if (backup && backup.data) {
                const now = new Date();
                const expiryDate = new Date(backup.data.expires_at);
                if (expiryDate > now) {
                    console.log('License found in IndexedDB backup');
                    return backup.data;
                }
            }
        } catch (error) {
            console.error('Error retrieving license from IndexedDB:', error);
        }
        // Fallback a cookie si IndexedDB falla
        const cookieLicense = getLicenseFromCookie();
        if (cookieLicense) {
            console.log('License restored from cookie');
            return cookieLicense;
        }
        return null;
    };
    // --- DETECCIÓN DE NAVEGADOR EDGE ---
    const isEdgeBrowser = () => {
        return /Edg/.test(navigator.userAgent);
    };
    // --- FUNCIÓN DE RENOVACIÓN AUTOMÁTICA DE LICENCIA ---
    const renewLicenseAutomatically = async () => {
        try {
            const savedLicenseJSON = localStorage.getItem('lanzo_license');
            if (savedLicenseJSON) {
                const savedLicense = JSON.parse(savedLicenseJSON);
                // Renovar si falta menos de 7 días para expirar
                const expiryDate = normalizeDate(savedLicense.expires_at);
                const now = new Date();
                const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
                if (daysUntilExpiry < 7 && daysUntilExpiry > 0) {
                    console.log('License expiring soon, attempting renewal');
                    const renewalResult = await renewLicense(savedLicense.license_key);
                    if (renewalResult.valid) {
                        // Actualizar almacenamientos
                        localStorage.setItem('lanzo_license', JSON.stringify(renewalResult.details));
                        await saveLicenseToIndexedDB(renewalResult.details);
                        renderLicenseInfo(renewalResult.details);
                        console.log('License renewed successfully');
                    }
                }
            }
        } catch (error) {
            console.error('Error in automatic license renewal:', error);
        }
    };
    // Función para normalizar productos existentes
    function normalizeProducts(products) {
        if (!Array.isArray(products)) {
            console.error('normalizeProducts: Expected an array, got:', products);
            return [];
        }
        return products.map(item => {
            if (!item || typeof item !== 'object') {
                console.warn('normalizeProducts: Invalid product item:', item);
                return item;
            }
            return {
                ...item,
                trackStock: item.trackStock !== undefined ? item.trackStock : (typeof item.stock === 'number' && item.stock > 0)
            };
        });
    }

    // --- ELEMENTOS DEL DOM ---
    const sections = {
        pos: document.getElementById('pos-section'),
        caja: document.getElementById('caja-section'),
        productManagement: document.getElementById('product-management-section'),
        customers: document.getElementById('customers-section'),
        dashboard: document.getElementById('dashboard-section'),
        company: document.getElementById('company-section'),
        donation: document.getElementById('donation-section')
    };
    const navCompanyName = document.getElementById('nav-company-name');
    const navCompanyLogo = document.getElementById('nav-company-logo');
    const menuItemsContainer = document.getElementById('menu-items');
    const orderListContainer = document.getElementById('order-list');
    const emptyOrderMessage = document.getElementById('empty-order-message');
    const posTotalSpan = document.getElementById('pos-total');
    const productForm = document.getElementById('product-form');
    const productIdInput = document.getElementById('product-id');
    const productNameInput = document.getElementById('product-name');
    const productDescriptionInput = document.getElementById('product-description');
    const productPriceInput = document.getElementById('product-price');
    const productCostInput = document.getElementById('product-cost');
    const productStockInput = document.getElementById('product-stock');
    const productFormTitle = document.getElementById('product-form-title');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const productListContainer = document.getElementById('product-list');
    const emptyProductMessage = document.getElementById('empty-product-message');
    const productImageFileInput = document.getElementById('product-image-file');
    const imagePreview = document.getElementById('image-preview');
    const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';
    const messageModal = document.getElementById('message-modal');
    const modalMessage = document.getElementById('modal-message');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const paymentModal = document.getElementById('payment-modal');
    const paymentTotal = document.getElementById('payment-total');
    const paymentAmountInput = document.getElementById('payment-amount');
    const paymentChange = document.getElementById('payment-change');
    const confirmPaymentBtn = document.getElementById('confirm-payment-btn');
    const saleCustomerInput = document.getElementById('sale-customer-input');
    const customerDatalist = document.getElementById('customer-list-datalist');
    const saleCustomerId = document.getElementById('sale-customer-id');
    const companyForm = document.getElementById('company-form');
    const companyNameInput = document.getElementById('company-name');
    const companyPhoneInput = document.getElementById('company-phone');
    const companyAddressInput = document.getElementById('company-address');
    const companyLogoPreview = document.getElementById('company-logo-preview');
    const companyLogoFileInput = document.getElementById('company-logo-file');
    const themeForm = document.getElementById('theme-form');
    const primaryColorInput = document.getElementById('primary-color');
    const secondaryColorInput = document.getElementById('secondary-color');
    const backgroundColorInput = document.getElementById('background-color');
    const cardBackgroundColorInput = document.getElementById('card-background-color');
    const textColorInput = document.getElementById('text-color');
    const cardTextColorInput = document.getElementById('card-text-color');
    const fontSizeSelect = document.getElementById('font-size');
    const layoutDensitySelect = document.getElementById('layout-density');
    const resetThemeBtn = document.getElementById('reset-theme-btn');
    const loadingScreen = document.getElementById('loading-screen');
    // Elementos para la calculadora de costos
    const costHelpButton = document.getElementById('cost-help-button');
    const costCalculationModal = document.getElementById('cost-calculation-modal');
    const categoryModalButton = document.getElementById('category-modal-button');
    const categoryModal = document.getElementById('category-modal');
    const categoryFormContainer = document.getElementById('category-form-container');
    const categoryIdInput = document.getElementById('category-id');
    const categoryNameInput = document.getElementById('category-name');
    const saveCategoryBtn = document.getElementById('save-category-btn');
    const cancelCategoryEditBtn = document.getElementById('cancel-category-edit-btn');
    const categoryListContainer = document.getElementById('category-list');
    const closeCategoryModalBtn = document.getElementById('close-category-modal-btn');
    const productCategorySelect = document.getElementById('product-category');
    const categoryFiltersContainer = document.getElementById('category-filters');
    const ingredientNameInput = document.getElementById('ingredient-name');
    const ingredientCostInput = document.getElementById('ingredient-cost');
    const ingredientQuantityInput = document.getElementById('ingredient-quantity');
    const addIngredientButton = document.getElementById('add-ingredient');
    const ingredientListContainer = document.getElementById('ingredient-list');
    const ingredientTotalElement = document.getElementById('ingredient-total');
    const assignCostButton = document.getElementById('assign-cost');
    const closeCostModalButton = document.getElementById('close-cost-modal');
    const rememberDeviceCheckbox = document.getElementById('remember-device');

    // ▼▼ NUEVO: ELEMENTOS PARA CARRUSEL DE ALERTAS Y FECHA DE CADUCIDAD ▼▼
    const productExpiryDateInput = document.getElementById('product-expiry-date');
    // ▲▲ FIN DE NUEVOS ELEMENTOS ▲▲

    // --- NUEVOS ELEMENTOS DEL DOM PARA VENTA A GRANEL Y UNIDAD ---
    const saleTypeSelect = document.getElementById('sale-type');
    const unitOptions = document.getElementById('unit-options');
    const bulkOptions = document.getElementById('bulk-options');
    const stockUnitLabel = document.getElementById('stock-unit-label');
    const bulkPurchaseQuantityInput = document.getElementById('bulk-purchase-quantity');
    const bulkPurchaseUnitInput = document.getElementById('bulk-purchase-unit');
    const bulkPurchaseCostInput = document.getElementById('bulk-purchase-cost');
    const bulkSalePriceInput = document.getElementById('bulk-sale-price');
    const bulkCostPerUnitMessage = document.getElementById('bulk-cost-per-unit-message');
    const bulkProfitMarginMessage = document.getElementById('bulk-profit-margin-message');
    const unitProfitMarginMessage = document.getElementById('unit-profit-margin-message');

    // --- LÓGICA PARA MENSAJES DINÁMICOS EN VENTA A GRANEL ---
    const updateBulkMessages = () => {
        const purchaseQty = parseFloat(bulkPurchaseQuantityInput.value);
        const purchaseCost = parseFloat(bulkPurchaseCostInput.value);
        const salePrice = parseFloat(bulkSalePriceInput.value);
        const unit = bulkPurchaseUnitInput.value;

        let costPerUnit = 0;
        if (purchaseQty > 0 && purchaseCost > 0) {
            costPerUnit = purchaseCost / purchaseQty;
            bulkCostPerUnitMessage.textContent = `El costo por ${unit} es de ${costPerUnit.toFixed(2)}.`;
            bulkCostPerUnitMessage.style.display = 'block';
        } else {
            bulkCostPerUnitMessage.style.display = 'none';
        }

        if (costPerUnit > 0 && salePrice > 0) {
            const profitMargin = ((salePrice - costPerUnit) / costPerUnit) * 100;
            bulkProfitMarginMessage.textContent = `Con este precio estás ganando un ${profitMargin.toFixed(2)}%.`;
            bulkProfitMarginMessage.style.display = 'block';
        } else {
            bulkProfitMarginMessage.style.display = 'none';
        }
    };

    // --- LÓGICA PARA MENSAJES DINÁMICOS EN VENTA POR UNIDAD ---
    const updateUnitMessages = () => {
        if (!productCostInput || !productPriceInput || !unitProfitMarginMessage) return;

        const cost = parseFloat(productCostInput.value);
        const price = parseFloat(productPriceInput.value);

        if (cost > 0 && price > 0) {
            const profitMargin = ((price - cost) / cost) * 100;
            unitProfitMarginMessage.textContent = `Con este precio estás ganando un ${profitMargin.toFixed(2)}%.`;
            unitProfitMarginMessage.style.display = 'block';
        } else {
            unitProfitMarginMessage.style.display = 'none';
        }
    };

    // --- LÓGICA PARA FORMULARIO DE PRODUCTO DINÁMICO (UNIDAD/GRANEL) ---
    const conversionFactors = {
        // Peso
        'kg': { 'g': 1000, 'lb': 2.20462, 'oz': 35.274 },
        'g': { 'kg': 0.001, 'lb': 0.00220462, 'oz': 0.035274 },
        'lb': { 'kg': 0.453592, 'g': 453.592, 'oz': 16 },
        'oz': { 'kg': 0.0283495, 'g': 28.3495, 'lb': 0.0625 },
        // Volumen
        'L': { 'ml': 1000, 'gal': 0.264172 },
        'ml': { 'L': 0.001, 'gal': 0.000264172 },
        'gal': { 'L': 3.78541, 'ml': 3785.41 },
        // Longitud
        'm': { 'cm': 100 },
        'cm': { 'm': 0.01 }
    };

    // Función auxiliar para obtener el nombre completo de la unidad
    const getUnitFullName = (unit) => {
        const unitNames = {
            'kg': 'Kilogramos (kg)',
            'g': 'Gramos (g)',
            'lb': 'Libras (lb)',
            'oz': 'Onzas (oz)',
            'L': 'Litros (L)',
            'ml': 'Mililitros (ml)',
            'gal': 'Galones (gal)',
            'm': 'Metros (m)',
            'cm': 'Centímetros (cm)'
        };
        return unitNames[unit] || unit;
    };




    const updateProductForm = () => {
        if (!saleTypeSelect) {
            console.error('El elemento saleTypeSelect no está definido.');
            return;
        }
        if (!unitOptions) {
            console.error('El elemento unitOptions no está definido.');
            return;
        }
        if (!bulkOptions) {
            console.error('El elemento bulkOptions no está definido.');
            return;
        }
        if (!productStockInput) {
            console.error('El elemento productStockInput no está definido.');
            return;
        }
        if (!productPriceInput) {
            console.error('El elemento productPriceInput no está definido.');
            return;
        }
        if (!productCostInput) {
            console.error('El elemento productCostInput no está definido.');
            return;
        }

        const saleType = saleTypeSelect.value;
        if (saleType === 'unit') {
            unitOptions.classList.remove('hidden');
            bulkOptions.classList.add('hidden');
            stockUnitLabel.textContent = 'El stock se maneja en unidades/piezas.';
            productStockInput.setAttribute('step', '1');
            productStockInput.parentElement.classList.remove('hidden'); // Show stock field
            productPriceInput.setAttribute('required', 'true');
            productCostInput.setAttribute('required', 'true');
        } else { // bulk
            unitOptions.classList.add('hidden');
            bulkOptions.classList.remove('hidden');
            stockUnitLabel.textContent = `El stock es la cantidad total en la unidad de compra (ej: si compras en kg, el stock es en kg).`;
            productStockInput.setAttribute('step', 'any');
            productStockInput.parentElement.classList.add('hidden'); // Hide stock field
            productPriceInput.removeAttribute('required');
            productCostInput.removeAttribute('required');
            updateBulkMessages();
        }
    };
    
    // --- ▲▲ FIN DE NUEVA LÓGICA ▲▲ ---

    // --- FUNCIONES PARA LA CALCULADORA DE COSTOS ---
    const openCostCalculator = async () => {
        // Obtener el ID del producto que se está editando (si existe)
        editingProductId = productIdInput.value;
        // Si ya tenemos ingredientes cargados (desde editProductForm), no los volvemos a cargar
        if (currentIngredients.length === 0 && editingProductId) {
            try {
                const ingredientsData = await loadData(STORES.INGREDIENTS, editingProductId);
                currentIngredients = ingredientsData ? ingredientsData.ingredients : [];
            } catch (error) {
                console.error('Error loading ingredients:', error);
                currentIngredients = [];
            }
        }
        // Mostrar ingredientes en la lista
        renderIngredientList();
        // Mostrar el modal
        if (costCalculationModal) costCalculationModal.classList.remove('hidden');
    };
    const closeCostCalculator = () => {
        if (costCalculationModal) costCalculationModal.classList.add('hidden');
    };
    const addIngredient = () => {
        const name = ingredientNameInput.value.trim();
        const cost = parseFloat(ingredientCostInput.value);
        const quantity = parseInt(ingredientQuantityInput.value) || 1;
        if (!name || isNaN(cost) || cost <= 0) {
            showMessageModal('Por favor, ingresa un nombre y costo válidos para el ingrediente.');
            return;
        }
        currentIngredients.push({
            id: Date.now(), // ID único para este ingrediente
            name,
            cost,
            quantity
        });
        // Limpiar campos de entrada
        ingredientNameInput.value = '';
        ingredientCostInput.value = '';
        ingredientQuantityInput.value = '1';
        // Actualizar la lista y el total
        renderIngredientList();
    };
    const removeIngredient = (id) => {
        currentIngredients = currentIngredients.filter(ing => ing.id !== id);
        renderIngredientList();
    };
    const renderIngredientList = () => {
        if (!ingredientListContainer) return;
        ingredientListContainer.innerHTML = '';
        if (currentIngredients.length === 0) {
            ingredientListContainer.innerHTML = '<p>No hay ingredientes agregados.</p>';
            if (ingredientTotalElement) ingredientTotalElement.textContent = 'Total: $0.00';
            return;
        }
        let total = 0;
        currentIngredients.forEach(ingredient => {
            const ingredientTotal = ingredient.cost * ingredient.quantity;
            total += ingredientTotal;
            const ingredientElement = document.createElement('div');
            ingredientElement.className = 'ingredient-item';
            ingredientElement.innerHTML = `
                        <span>${ingredient.name} x${ingredient.quantity}</span>
                        <span>$${ingredientTotal.toFixed(2)} 
                            <button class="btn-remove" data-id="${ingredient.id}">X</button>
                        </span>
                    `;
            ingredientListContainer.appendChild(ingredientElement);
        });
        // Agregar event listeners a los botones de eliminar
        ingredientListContainer.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id);
                removeIngredient(id);
            });
        });
        if (ingredientTotalElement) ingredientTotalElement.textContent = `Total: $${total.toFixed(2)}`;
    };
    const assignCostToProduct = () => {
        const total = currentIngredients.reduce((sum, ing) => sum + (ing.cost * ing.quantity), 0);
        if (productCostInput) productCostInput.value = total.toFixed(2);
        closeCostCalculator();
    };
    const saveIngredients = async () => {
        if (editingProductId) {
            try {
                await saveData(STORES.INGREDIENTS, {
                    productId: editingProductId,
                    ingredients: currentIngredients
                });
            } catch (error) {
                console.error('Error saving ingredients:', error);
            }
        }
    };
    // --- GESTIÓN DE CATEGORÍAS ---
    const renderCategories = async () => {
        try {
            const categories = await loadData(STORES.CATEGORIES);
            dataCache.categories = categories;
            dataCache.lastUpdated.categories = Date.now();

            if (categoryListContainer) {
                categoryListContainer.innerHTML = '';
                if (categories.length === 0) {
                    categoryListContainer.innerHTML = '<p>No hay categorías creadas.</p>';
                } else {
                    categories.forEach(cat => {
                        const div = document.createElement('div');
                        div.className = 'category-item-managed';
                        div.innerHTML = `
                    <span>${cat.name}</span>
                    <div class="category-item-controls">
                        <button class="edit-category-btn" data-id="${cat.id}">✏️</button>
                        <button class="delete-category-btn" data-id="${cat.id}">🗑️</button>
                    </div>
                `;
                        categoryListContainer.appendChild(div);
                    });
                }
            }

            if (productCategorySelect) {
                const currentValue = productCategorySelect.value;
                productCategorySelect.innerHTML = '<option value="">Sin categoría</option>';
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    productCategorySelect.appendChild(option);
                });
                if (categories.some(cat => cat.id === currentValue)) {
                    productCategorySelect.value = currentValue;
                }
            }

            if (categoryFiltersContainer) {
                const activeFilter = categoryFiltersContainer.querySelector('.category-filter-btn.active');
                const activeCategoryId = activeFilter ? activeFilter.dataset.id : null;
                categoryFiltersContainer.innerHTML = '';

                const allButton = document.createElement('button');
                allButton.className = 'category-filter-btn' + (!activeCategoryId ? ' active' : '');
                allButton.textContent = 'Todos';
                allButton.addEventListener('click', () => {
                    // CORRECCIÓN: Obtener la barra de búsqueda y su valor aquí
                    const searchInput = document.getElementById('pos-product-search');
                    const searchTerm = searchInput ? searchInput.value : '';
                    renderMenu(null, searchTerm);
                    document.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
                    allButton.classList.add('active');
                });
                categoryFiltersContainer.appendChild(allButton);

                categories.forEach(cat => {
                    const button = document.createElement('button');
                    button.className = 'category-filter-btn' + (activeCategoryId === cat.id ? ' active' : '');
                    button.textContent = cat.name;
                    button.dataset.id = cat.id;
                    button.addEventListener('click', () => {
                        // CORRECCIÓN: Obtener la barra de búsqueda y su valor aquí
                        const searchInput = document.getElementById('pos-product-search');
                        const searchTerm = searchInput ? searchInput.value : '';
                        renderMenu(cat.id, searchTerm);
                        document.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
                        button.classList.add('active');
                    });
                    categoryFiltersContainer.appendChild(button);
                });
            }
        } catch (error) {
            console.error('Error rendering categories:', error);
            showMessageModal('Error al cargar las categorías.');
        }
    };
    const saveCategory = async () => {
        const id = categoryIdInput.value;
        const name = categoryNameInput.value.trim();
        if (!name) {
            showMessageModal('El nombre de la categoría no puede estar vacío.');
            return;
        }
        try {
            const categoryData = {
                id: id || `cat-${Date.now()}`,
                name
            };
            await saveData(STORES.CATEGORIES, categoryData);
            // Invalidar la caché de categorías para forzar una nueva carga
            dataCache.categories = null;
            dataCache.lastUpdated.categories = 0;
            showMessageModal(`Categoría "${name}" guardada.`);
            resetCategoryForm();
            // Actualizar todas las partes de la UI que dependen de categorías
            await renderCategories(); // Esto actualiza filtros y selects
            // Si estamos en la sección de gestión de productos, actualizarla también
            if (document.getElementById('product-management-section').classList.contains('active')) {
                renderProductManagement();
            }
            // Si estamos en el POS, actualizar el menú por si hay filtros aplicados
            if (document.getElementById('pos-section').classList.contains('active')) {
                renderMenu();
            }
        } catch (error) {
            console.error('Error saving category:', error);
            if (error.name === 'ConstraintError') {
                showMessageModal('Ya existe una categoría con ese nombre.');
            } else {
                showMessageModal('Error al guardar la categoría.');
            }
        }
    };
    const editCategory = async (id) => {
        try {
            const category = await loadData(STORES.CATEGORIES, id);
            if (category) {
                if (categoryIdInput) categoryIdInput.value = category.id;
                if (categoryNameInput) categoryNameInput.value = category.name;
                if (saveCategoryBtn) saveCategoryBtn.textContent = 'Actualizar Categoría';
                if (cancelCategoryEditBtn) cancelCategoryEditBtn.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error loading category for editing:', error);
        }
    };
    const deleteCategory = async (id) => {
        try {
            const category = await loadData(STORES.CATEGORIES, id);
            if (!category) return;
            showMessageModal(`¿Seguro que quieres eliminar la categoría "${category.name}"? Los productos en esta categoría quedarán sin categoría.`, async () => {
                await deleteData(STORES.CATEGORIES, id);
                // Invalidar caché de categorías
                dataCache.categories = null;
                // Des-asignar esta categoría de todos los productos
                const products = await loadDataWithCache(STORES.MENU);
                const productsToUpdate = products.filter(p => p.categoryId === id);
                for (const product of productsToUpdate) {
                    product.categoryId = '';
                    await saveData(STORES.MENU, product);
                }
                // Invalidar caché de menú
                dataCache.menu = null;
                showMessageModal('Categoría eliminada.');
                await renderCategories();
                await renderProductManagement();
            });
        } catch (error) {
            console.error('Error deleting category:', error);
            showMessageModal('Error al eliminar la categoría.');
        }
    };
    const resetCategoryForm = () => {
        if (categoryIdInput) categoryIdInput.value = '';
        if (categoryNameInput) categoryNameInput.value = '';
        if (saveCategoryBtn) saveCategoryBtn.textContent = 'Guardar Categoría';
        if (cancelCategoryEditBtn) cancelCategoryEditBtn.classList.add('hidden');
    };
    // --- NAVEGACIÓN Y VISIBILIDAD ---
    const showSection = (sectionId) => {
        // Ocultar todas las secciones
        Object.values(sections).forEach(section => {
            if (section) section.classList.remove('active');
        });

        // Mostrar la sección seleccionada
        const sectionElement = document.getElementById(`${sectionId}-section`);
        if (sectionElement) sectionElement.classList.add('active');

        // Actualizar el botón activo en el menú de navegación
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.section === sectionId);
        });

        // Lógica específica de cada sección
        if (sectionId === 'pos') renderMenu();
        if (sectionId === 'caja') document.dispatchEvent(new Event('cajaOpened'));
        if (sectionId === 'product-management') renderProductManagement();
        if (sectionId === 'dashboard' && dashboard) dashboard.renderDashboard();
        if (sectionId === 'company') renderCompanyData();

        // Cerrar el menú móvil si está abierto
        const navLinksContainer = document.getElementById('main-nav-links');
        const backdrop = document.getElementById('backdrop');
        if (navLinksContainer && navLinksContainer.classList.contains('open')) {
            navLinksContainer.classList.remove('open');
            if (backdrop) backdrop.classList.remove('open');
        }
    };

    const applyTheme = (theme) => {
        document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
        document.documentElement.style.setProperty('--secondary-color', theme.secondaryColor);
        document.documentElement.style.setProperty('--background-color', theme.backgroundColor);
        document.documentElement.style.setProperty('--card-background-color', theme.cardBackgroundColor);
        document.documentElement.style.setProperty('--text-color', theme.textColor);
        document.documentElement.style.setProperty('--card-text-color', theme.cardTextColor);
        document.body.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
        document.body.classList.add(`font-size-${theme.fontSize}`);
        document.body.classList.remove('layout-compact', 'layout-spacious');
        document.body.classList.add(`layout-${theme.layoutDensity}`);
    };
    const renderThemeSettings = async () => {
        try {
            let theme = await loadDataWithCache(STORES.THEME, 'theme');
            if (!theme) {
                console.log('No theme data found, initializing with default');
                theme = { ...defaultTheme };
                await saveData(STORES.THEME, theme);
                dataCache.theme = theme;
                dataCache.lastUpdated.theme = Date.now();
            }
            if (primaryColorInput) primaryColorInput.value = theme.primaryColor;
            if (secondaryColorInput) secondaryColorInput.value = theme.secondaryColor;
            if (backgroundColorInput) backgroundColorInput.value = theme.backgroundColor;
            if (cardBackgroundColorInput) cardBackgroundColorInput.value = theme.cardBackgroundColor;
            if (textColorInput) textColorInput.value = theme.textColor;
            if (cardTextColorInput) cardTextColorInput.value = theme.cardTextColor;
            if (fontSizeSelect) fontSizeSelect.value = theme.fontSize;
            if (layoutDensitySelect) layoutDensitySelect.value = theme.layoutDensity;
            applyTheme(theme);
        } catch (error) {
            console.error('Error loading theme settings:', error.message);
            showMessageModal(`Error al cargar configuración de tema: ${error.message}`);
        }
    };
    const saveThemeSettings = async (e) => {
        e.preventDefault();
        try {
            const themeData = {
                id: 'theme',
                primaryColor: primaryColorInput ? primaryColorInput.value : defaultTheme.primaryColor,
                secondaryColor: secondaryColorInput ? secondaryColorInput.value : defaultTheme.secondaryColor,
                backgroundColor: backgroundColorInput ? backgroundColorInput.value : defaultTheme.backgroundColor,
                cardBackgroundColor: cardBackgroundColorInput ? cardBackgroundColorInput.value : defaultTheme.cardBackgroundColor,
                textColor: textColorInput ? textColorInput.value : defaultTheme.textColor,
                cardTextColor: cardTextColorInput ? cardTextColorInput.value : defaultTheme.cardTextColor,
                fontSize: fontSizeSelect ? fontSizeSelect.value : defaultTheme.fontSize,
                layoutDensity: layoutDensitySelect ? layoutDensitySelect.value : defaultTheme.layoutDensity
            };
            await saveData(STORES.THEME, themeData);
            // Actualizar caché
            dataCache.theme = themeData;
            dataCache.lastUpdated.theme = Date.now();
            applyTheme(themeData);
            showMessageModal('Configuración de tema guardada.');
        } catch (error) {
            console.error('Error saving theme settings:', error.message);
            showMessageModal(`Error al guardar configuración de tema: ${error.message}`);
        }
    };
    const resetTheme = async () => {
        try {
            await saveData(STORES.THEME, defaultTheme);
            // Actualizar caché
            dataCache.theme = defaultTheme;
            dataCache.lastUpdated.theme = Date.now();
            if (primaryColorInput) primaryColorInput.value = defaultTheme.primaryColor;
            if (secondaryColorInput) secondaryColorInput.value = defaultTheme.secondaryColor;
            if (backgroundColorInput) backgroundColorInput.value = defaultTheme.backgroundColor;
            if (cardBackgroundColorInput) cardBackgroundColorInput.value = defaultTheme.cardBackgroundColor;
            if (textColorInput) textColorInput.value = defaultTheme.textColor;
            if (cardTextColorInput) cardTextColorInput.value = defaultTheme.cardTextColor;
            if (fontSizeSelect) fontSizeSelect.value = defaultTheme.fontSize;
            if (layoutDensitySelect) layoutDensitySelect.value = defaultTheme.layoutDensity;
            applyTheme(defaultTheme);
            showMessageModal('Tema restablecido a valores predeterminados.');
        } catch (error) {
            console.error('Error resetting theme:', error.message);
            showMessageModal(`Error al restablecer tema: ${error.message}`);
        }
    };
    const renderMenu = async (filterCategoryId = null, searchTerm = '') => {
        if (!menuItemsContainer) return;
        try {
            let menu = await loadDataWithCache(STORES.MENU);
            menu = normalizeProducts(menu).filter(item => item.isActive !== false);

            if (filterCategoryId) {
                menu = menu.filter(item => item.categoryId === filterCategoryId);
            }
            if (searchTerm) {
                const lowerCaseSearchTerm = searchTerm.toLowerCase();
                menu = menu.filter(item => item.name.toLowerCase().includes(lowerCaseSearchTerm));
            }

            menuItemsContainer.innerHTML = '';
            if (menu.length === 0) {
                menuItemsContainer.innerHTML = `<p class="empty-message">No hay productos.</p>`;
                return;
            }

            // ▼▼ MODIFICADO: LÓGICA PARA INDICADORES VISUALES ▼▼
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            menu.forEach(item => {
                const menuItemDiv = document.createElement('div');
                menuItemDiv.className = 'menu-item';

                // Verificar stock bajo
                if (item.trackStock && item.stock > 0 && item.stock < 5) {
                    menuItemDiv.classList.add('low-stock-warning');
                }

                // Verificar caducidad
                if (item.expiryDate) {
                    const expiryDate = new Date(item.expiryDate);
                    const diffTime = expiryDate - now;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays <= 7) {
                        menuItemDiv.classList.add('nearing-expiry-warning');
                    }
                }
                // ▲▲ FIN DE MODIFICACIÓN ▲▲

                let stockInfo = '';
                if (item.trackStock) {
                    stockInfo = item.stock > 0 ?
                        `<div class="stock-info">Stock: ${item.stock}</div>` :
                        `<div class="stock-info out-of-stock-label">AGOTADO</div>`;
                } else {
                    stockInfo = `<div class="stock-info no-stock-label">Sin seguimiento</div>`;
                }

                menuItemDiv.innerHTML = `
                    <img class="menu-item-image" src="${item.image || defaultPlaceholder}" alt="${item.name}" onerror="this.onerror=null;this.src='${defaultPlaceholder}';">
                    <h3 class="menu-item-name">${item.name}</h3>
                    <p class="menu-item-price">$${item.price.toFixed(2)}</p>
                    ${stockInfo}
                `;
                if (!item.trackStock || item.stock > 0) {
                    menuItemDiv.addEventListener('click', () => addItemToOrder(item));
                }
                menuItemsContainer.appendChild(menuItemDiv);
            });
        } catch (error) {
            console.error('Error loading menu:', error.message);
            showMessageModal(`Error al cargar el menú: ${error.message}`);
        }
    };
    
    // Función addItemToOrder mejorada
    const addItemToOrder = async (item) => {
        try {
            const existingItemInOrder = order.find(orderItem => orderItem.id === item.id);

            // --- LÓGICA PARA PRODUCTOS A GRANEL ---
            if (item.saleType === 'bulk') {
                if (existingItemInOrder) {
                    // Si ya está en el pedido, enfocamos su campo de cantidad para que el usuario edite
                    showMessageModal(`"${item.name}" ya está en el pedido. Puedes ajustar la cantidad directamente.`);
                    // Pequeño truco para que el navegador haga scroll y enfoque el input
                    setTimeout(() => {
                        const input = orderListContainer.querySelector(`input[data-id="${item.id}"]`);
                        if (input) input.focus();
                    }, 100);
                } else {
                    // Añadimos el producto a granel con cantidad null. El usuario deberá ingresarla.
                    order.push({
                        ...item,
                        quantity: null, // Cantidad nula para indicar que debe ser ingresada
                        exceedsStock: false
                    });
                }
                updateOrderDisplay();
                return;
            }

            // --- LÓGICA EXISTENTE PARA PRODUCTOS POR UNIDAD ---
            const hasStockControl = item.trackStock !== undefined ? item.trackStock :
                (typeof item.stock === 'number' && item.stock > 0);

            if (!hasStockControl) {
                if (existingItemInOrder) {
                    existingItemInOrder.quantity++;
                } else {
                    order.push({
                        ...item,
                        quantity: 1,
                        exceedsStock: false,
                        trackStock: false
                    });
                }
                updateOrderDisplay();
                return;
            }

            const currentProduct = await loadDataWithCache(STORES.MENU, item.id);
            if (!currentProduct) {
                showMessageModal(`El producto "${item.name}" no está disponible en este momento.`);
                return;
            }

            const currentQuantityInOrder = existingItemInOrder ? existingItemInOrder.quantity : 0;
            if (currentQuantityInOrder >= currentProduct.stock) {
                showMessageModal(
                    `No hay suficiente stock de "${item.name}". Solo quedan ${currentProduct.stock} unidades. ¿Desea agregarlo de todas formas?`,
                    () => {
                        if (existingItemInOrder) {
                            existingItemInOrder.quantity++;
                            existingItemInOrder.exceedsStock = true;
                        } else {
                            order.push({ ...item, quantity: 1, exceedsStock: true });
                        }
                        updateOrderDisplay();
                    }
                );
                return;
            }

            if (existingItemInOrder) {
                existingItemInOrder.quantity++;
                if (existingItemInOrder.exceedsStock && existingItemInOrder.quantity <= currentProduct.stock) {
                    existingItemInOrder.exceedsStock = false;
                }
            } else {
                order.push({ ...item, quantity: 1, exceedsStock: false });
            }
            updateOrderDisplay();

        } catch (error) {
            console.error('Error adding item to order:', error);
            showMessageModal('Error al agregar el producto al pedido.');
        }
    };
    const updateOrderDisplay = async () => {
        if (!orderListContainer || !emptyOrderMessage || !posTotalSpan) return;
        orderListContainer.innerHTML = '';
        emptyOrderMessage.classList.toggle('hidden', order.length > 0);

        for (const item of order) {
            const orderItemDiv = document.createElement('div');
            orderItemDiv.className = 'order-item';

            // --- RENDERIZADO PARA PRODUCTOS A GRANEL ---
            if (item.saleType === 'bulk') {
                const unitName = item.bulkData?.purchase?.unit || 'cantidad';
                const currentProduct = await loadDataWithCache(STORES.MENU, item.id);
                const stockDisponible = currentProduct ? currentProduct.stock : item.stock;
                
                let stockWarning = '';
                if (item.trackStock) {
                    if (item.quantity > stockDisponible) {
                        orderItemDiv.classList.add('exceeds-stock');
                        stockWarning = `<div class="stock-warning exceeds-stock-warning">¡Excede stock! Disp: ${stockDisponible} ${unitName}</div>`;
                    } else if (item.quantity > 0 && stockDisponible < LOW_STOCK_THRESHOLD) {
                         orderItemDiv.classList.add('low-stock');
                        stockWarning = `<div class="stock-warning low-stock-warning">Stock bajo: ${stockDisponible} ${unitName}</div>`;
                    }
                }

                orderItemDiv.innerHTML = `
                    <div class="order-item-info">
                        <span class="order-item-name">${item.name}</span>
                        <span class="order-item-price">$${item.price.toFixed(2)} por ${unitName}</span>
                         ${stockWarning}
                    </div>
                    <div class="order-item-controls bulk-controls">
                        <input type="number" class="order-item-quantity-input" data-id="${item.id}" 
                               placeholder="Ingrese ${unitName}" value="${item.quantity > 0 ? item.quantity : ''}" 
                               step="0.01" min="0">
                        <span class="unit-label">${unitName}</span>
                        <button class="remove-item-btn" data-id="${item.id}">X</button>
                    </div>
                `;
            } 
            // --- RENDERIZADO PARA PRODUCTOS POR UNIDAD (LÓGICA EXISTENTE MEJORADA) ---
            else {
                const hasStockControl = item.trackStock !== undefined ? item.trackStock : (typeof item.stock === 'number' && item.stock > 0);
                if (!hasStockControl) {
                    orderItemDiv.innerHTML = `
                        <div class="order-item-info">
                            <span class="order-item-name">${item.name}</span>
                            <span class="order-item-price">$${item.price.toFixed(2)} c/u</span>
                            <div class="stock-warning no-stock-tracking">Sin control de stock</div>
                        </div>
                        <div class="order-item-controls">
                            <button class="quantity-btn decrease" data-id="${item.id}" data-change="-1">-</button>
                            <span class="quantity-value">${item.quantity}</span>
                            <button class="quantity-btn increase" data-id="${item.id}" data-change="1">+</button>
                            <button class="remove-item-btn" data-id="${item.id}">X</button>
                        </div>
                    `;
                } else {
                    const currentProduct = await loadDataWithCache(STORES.MENU, item.id, 60000);
                    if (!currentProduct) {
                        // Manejo si el producto ya no existe
                        orderItemDiv.classList.add('error-item');
                        orderItemDiv.innerHTML = `... (código para producto no disponible)`;
                        continue;
                    }

                    if (item.exceedsStock) orderItemDiv.classList.add('exceeds-stock');
                    else if (currentProduct.stock < 5) orderItemDiv.classList.add('low-stock');
                    
                    let stockWarning = '';
                    if (item.exceedsStock) {
                        stockWarning = `<div class="stock-warning exceeds-stock-warning">¡Excede stock! (Solo ${currentProduct.stock} disp.)</div>`;
                    } else if (currentProduct.stock < 5) {
                        stockWarning = `<div class="stock-warning low-stock-warning">Stock bajo: ${currentProduct.stock} unidades</div>`;
                    }
                    
                    orderItemDiv.innerHTML = `
                        <div class="order-item-info">
                            <span class="order-item-name">${item.name}</span>
                            <span class="order-item-price">$${item.price.toFixed(2)} c/u</span>
                            ${stockWarning}
                        </div>
                        <div class="order-item-controls">
                            <button class="quantity-btn decrease" data-id="${item.id}" data-change="-1">-</button>
                            <span class="quantity-value">${item.quantity}</span>
                            <button class="quantity-btn increase" data-id="${item.id}" data-change="1"
                                    ${item.quantity >= currentProduct.stock && !item.exceedsStock ? 'disabled' : ''}>+</button>
                            <button class="remove-item-btn" data-id="${item.id}">X</button>
                        </div>
                    `;
                }
            }
            orderListContainer.appendChild(orderItemDiv);
        }

        // --- ASIGNACIÓN DE EVENT LISTENERS ---
        orderListContainer.querySelectorAll('.quantity-btn').forEach(btn => btn.addEventListener('click', handleQuantityChange));
        orderListContainer.querySelectorAll('.remove-item-btn').forEach(btn => btn.addEventListener('click', handleRemoveItem));
        orderListContainer.querySelectorAll('.order-item-quantity-input').forEach(input => input.addEventListener('input', handleBulkQuantityInput));
        
        calculateTotals();
    };
     const handleBulkQuantityInput = (e) => {
        const id = e.target.dataset.id;
        const itemInOrder = order.find(i => i.id === id);
        if (itemInOrder) {
            const newQuantity = parseFloat(e.target.value);
            // Actualizamos la cantidad en el objeto del pedido
            itemInOrder.quantity = isNaN(newQuantity) || newQuantity <= 0 ? null : newQuantity;
            
            // Recalculamos totales y actualizamos la UI para mostrar advertencias de stock si es necesario
            calculateTotals();
            // Para no redibujar todo, solo actualizamos las clases de advertencia
             const currentProduct = loadDataWithCache(STORES.MENU, id).then(p => {
                if (p && p.trackStock) {
                    const orderItemDiv = e.target.closest('.order-item');
                    const warningDiv = orderItemDiv.querySelector('.stock-warning');
                    if (warningDiv) warningDiv.remove(); // Limpiar advertencia previa

                    if (itemInOrder.quantity > p.stock) {
                        itemInOrder.exceedsStock = true;
                        orderItemDiv.classList.add('exceeds-stock');
                        orderItemDiv.classList.remove('low-stock');
                        e.target.closest('.order-item-info').insertAdjacentHTML('beforeend', `<div class="stock-warning exceeds-stock-warning">¡Excede stock! Disp: ${p.stock} ${p.bulkData.purchase.unit}</div>`);
                    } else {
                        itemInOrder.exceedsStock = false;
                        orderItemDiv.classList.remove('exceeds-stock');
                    }
                }
            });
        }
    };
    
    /**
     * NUEVA FUNCIÓN (refactorizada): Maneja los botones +/-.
     */
    const handleQuantityChange = async (e) => {
        const { id, change } = e.currentTarget.dataset;
        const itemIndex = order.findIndex(i => i.id === id);
        if (itemIndex > -1) {
            // Lógica existente para productos por unidad...
             updateOrderDisplay(); // Redibuja al final
        }
    };
    
    /**
     * NUEVA FUNCIÓN (refactorizada): Maneja el botón de eliminar.
     */
    const handleRemoveItem = (e) => {
        const id = e.currentTarget.dataset.id;
        order = order.filter(i => i.id !== id);
        updateOrderDisplay();
    };

    const calculateTotals = () => {
        if (!posTotalSpan) return;
        const total = order.reduce((sum, item) => {
            // Solo sumamos si la cantidad es un número válido y mayor que cero
            if (item.quantity && !isNaN(item.quantity) && item.quantity > 0) {
                return sum + (item.price * item.quantity);
            }
            return sum;
        }, 0);
        posTotalSpan.textContent = `$${total.toFixed(2)}`;
    };

    const openPaymentProcess = async () => {
        if (!paymentModal || !paymentTotal || !paymentAmountInput || !paymentChange) return;
        if (order.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }
        // --- NUEVA VALIDACIÓN ---
        const bulkItemsWithoutQuantity = order.filter(item => 
            item.saleType === 'bulk' && (!item.quantity || isNaN(item.quantity) || item.quantity <= 0)
        );

        if (bulkItemsWithoutQuantity.length > 0) {
            const productNames = bulkItemsWithoutQuantity.map(item => item.name).join(', ');
            showMessageModal(`Por favor, ingresa una cantidad válida para los siguientes productos: ${productNames}.`);
            return;
        }
        // --- FIN DE LA NUEVA VALIDACIÓN ---

        if (!paymentModal || !paymentTotal || !paymentAmountInput || !paymentChange) return;

        // Elementos del DOM
        const customerInput = document.getElementById('sale-customer-input');
        const customerDatalist = document.getElementById('customer-list-datalist');
        const customerIdInput = document.getElementById('sale-customer-id');

        // 1. Cargar clientes y poblar el datalist
        try {
            customersForSale = await loadData(STORES.CUSTOMERS);
            customerDatalist.innerHTML = ''; // Limpiar opciones anteriores
            customersForSale.forEach(customer => {
                const option = document.createElement('option');
                // Mostramos nombre y teléfono para evitar confusiones con nombres repetidos
                option.value = `${customer.name} - ${customer.phone}`;
                option.dataset.id = customer.id; // Guardamos el ID en un atributo data
                customerDatalist.appendChild(option);
            });
            customerInput.setAttribute('list', 'customer-list-datalist');
        } catch (error) {
            console.error('Error loading customers for sale:', error);
        }

        // 2. Limpiar valores anteriores y mostrar modal
        const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        paymentTotal.textContent = `${total.toFixed(2)}`;
        paymentAmountInput.value = '';
        paymentChange.textContent = '$0.00';

        // Limpiar selección de cliente anterior
        customerInput.value = '';
        customerIdInput.value = '';

        paymentModal.classList.remove('hidden');
        paymentAmountInput.focus();
    };
    const processOrder = async () => {
        const cajaActual = getCajaActual();
        if (!cajaActual || cajaActual.estado !== 'abierta') {
            showMessageModal(
                'No se puede procesar la venta. No hay una caja abierta y activa. Por favor, ve a la seccion de "Caja" para abrir una.',
                null,
                {
                    extraButton: {
                        text: 'Ir a Caja',
                        action: () => showSection('caja')
                    }
                }
            );
            return;
        }
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return;
        }
        try {
            let insufficientStockItems = [];
            let exceedsStockItems = [];
            // 1. Validar stock ANTES de procesar (solo para productos con control)
            for (const orderItem of order) {
                const product = await loadData(STORES.MENU, orderItem.id);
                if (product && product.trackStock) {
                    if (product.stock < orderItem.quantity) {
                        if (orderItem.exceedsStock) {
                            exceedsStockItems.push({
                                name: orderItem.name,
                                requested: orderItem.quantity,
                                available: product.stock
                            });
                        } else {
                            insufficientStockItems.push({
                                name: orderItem.name,
                                requested: orderItem.quantity,
                                available: product.stock
                            });
                        }
                    }
                }
            }
            // 2. Si hay productos con stock insuficiente, pedir confirmación
            if (insufficientStockItems.length > 0 || exceedsStockItems.length > 0) {
                let message = "¡Atención! ";
                if (insufficientStockItems.length > 0) {
                    message += "Stock insuficiente para:\n";
                    message += insufficientStockItems.map(item =>
                        `- ${item.name}: Solicitadas ${item.requested}, Disponibles ${item.available}`
                    ).join('\n');
                }
                if (exceedsStockItems.length > 0) {
                    if (insufficientStockItems.length > 0) message += "\n\n";
                    message += "Productos que exceden el stock:\n";
                    message += exceedsStockItems.map(item =>
                        `- ${item.name}: Solicitadas ${item.requested}, Disponibles ${item.available}`
                    ).join('\n');
                }
                message += "\n\n¿Deseas procesar el pedido de todas formas?";
                showMessageModal(message, async () => {
                    // El usuario confirmó que quiere procesar a pesar del stock insuficiente
                    await completeOrderProcessing(insufficientStockItems, exceedsStockItems);
                });
                return;
            }
            // 3. Si no hay problemas de stock, procesar normally
            await completeOrderProcessing([], []);
        } catch (error) {
            console.error('Error processing order:', error.message);
            showMessageModal(`Error al procesar el pedido: ${error.message}`);
        }
    };
    const completeOrderProcessing = async (insufficientStockItems, exceedsStockItems) => {
        try {
            const processedItems = [];
            for (const orderItem of order) {
                const product = await loadData(STORES.MENU, orderItem.id);
                let stockDeducted = 0;
                if (product && product.trackStock) {
                    stockDeducted = Math.min(orderItem.quantity, product.stock);
                    product.stock = Math.max(0, product.stock - stockDeducted);
                    await saveData(STORES.MENU, product);
                }
                processedItems.push({
                    ...orderItem,
                    stockDeducted: stockDeducted
                });
            }

            const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const customerInput = document.getElementById('sale-customer-input');
            const customerNameAndPhone = customerInput.value;
            let customerId = null;
            const selectedCustomer = customersForSale.find(c => `${c.name} - ${c.phone}` === customerNameAndPhone);
            if (selectedCustomer) {
                customerId = selectedCustomer.id;
            }

            const sale = {
                timestamp: new Date().toISOString(),
                items: processedItems,
                total,
                customerId,
                hadStockIssues: insufficientStockItems.length > 0 || exceedsStockItems.length > 0,
                exceedsStock: exceedsStockItems.length > 0
            };
            await saveData(STORES.SALES, sale);
            
            if (paymentModal) paymentModal.classList.add('hidden');
            showMessageModal('¡Pedido procesado exitosamente!');
            order = [];
            updateOrderDisplay();
            renderMenu();
            if (dashboard) dashboard.renderDashboard();
            renderProductManagement();
            
            // ▼▼ MODIFICADO: Actualizar alertas después de una venta ▼▼
            if(ticker) await ticker.updateAlerts();

        } catch (error) {
            console.error('Error completing order processing:', error.message);
            showMessageModal(`Error al completar el procesamiento del pedido: ${error.message}`);
        }
    };
    const renderCompanyData = async () => {
        try {
            let companyData = await loadDataWithCache(STORES.COMPANY, 'company');
            if (!companyData) {
                console.log('No company data found, initializing with default');
                companyData = { id: 'company', name: 'Lanzo Negocio', phone: '', address: '', logo: '' };
                await saveData(STORES.COMPANY, companyData);
                dataCache.company = companyData;
                dataCache.lastUpdated.company = Date.now();
            }
            if (companyNameInput) companyNameInput.value = companyData.name;
            if (companyPhoneInput) companyPhoneInput.value = companyData.phone;
            if (companyAddressInput) companyAddressInput.value = companyData.address;
            const logoSrc = companyData.logo || 'https://placehold.co/100x100/FFFFFF/4A5568?text=LN';
            if (companyLogoPreview) companyLogoPreview.src = logoSrc;
            if (navCompanyLogo) navCompanyLogo.src = logoSrc;
            if (navCompanyName) navCompanyName.textContent = companyData.name || 'POS';
            await renderThemeSettings();
        } catch (error) {
            console.error('Error loading company data:', error.message);
            showMessageModal(`Error al cargar datos de la empresa: ${error.message}`);
        }
    };
    const saveCompanyData = async (e) => {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';  // Fuerza mostrar el modal de nuevo
            return;  // Bloquea la acción
        }
        e.preventDefault();
        try {
            const companyData = {
                id: 'company',
                name: companyNameInput ? companyNameInput.value.trim() : '',
                phone: companyPhoneInput ? companyPhoneInput.value.trim() : '',
                address: companyAddressInput ? companyAddressInput.value.trim() : '',
                logo: companyLogoPreview ? companyLogoPreview.src : ''
            };
            await saveData(STORES.COMPANY, companyData);
            // Actualizar caché
            dataCache.company = companyData;
            dataCache.lastUpdated.company = Date.now();
            renderCompanyData();
            showMessageModal('Datos de la empresa guardados exitosamente.');
        } catch (error) {
            console.error('Error saving company data:', error.message);
            showMessageModal(`Error al guardar datos de la empresa: ${error.message}`);
        }
    };
    const renderProductManagement = async (searchTerm = '') => {
        if (!productListContainer || !emptyProductMessage) return;
        try {
            const [menu, categories] = await Promise.all([
                loadDataWithCache(STORES.MENU).then(normalizeProducts),
                loadDataWithCache(STORES.CATEGORIES)
            ]);
            const categoryMap = new Map(categories.map(cat => [cat.id, cat.name]));
            const filteredMenu = menu.filter(item =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
            productListContainer.innerHTML = '';
            emptyProductMessage.classList.toggle('hidden', filteredMenu.length > 0);
            if (filteredMenu.length === 0 && searchTerm) {
                emptyProductMessage.textContent = `No se encontraron productos para "${searchTerm}".`;
            } else {
                emptyProductMessage.textContent = 'No hay productos.';
            }

            // ▼▼ MODIFICADO: LÓGICA PARA INDICADORES VISUALES EN GESTIÓN ▼▼
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            filteredMenu.forEach(item => {
                const categoryName = item.categoryId ? categoryMap.get(item.categoryId) || 'Categoría eliminada' : 'Sin categoría';
                const div = document.createElement('div');
                div.className = 'product-item';

                let stockIndicator = '';
                let expiryIndicator = '';

                // Verificar stock bajo
                if (item.trackStock && item.stock > 0 && item.stock < 5) {
                    div.classList.add('low-stock-warning');
                    stockIndicator = `<span class="alert-indicator low-stock-indicator">Stock bajo: ${item.stock}</span>`;
                }

                // Verificar caducidad
                if (item.expiryDate) {
                    const expiryDate = new Date(item.expiryDate);
                    const diffTime = expiryDate - now;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays >= 0 && diffDays <= 7) {
                        div.classList.add('nearing-expiry-warning');
                        const expiryText = diffDays === 0 ? 'Caduca hoy' : `Caduca en ${diffDays} días`;
                        expiryIndicator = `<span class="alert-indicator nearing-expiry-indicator">${expiryText}</span>`;
                    }
                }
                // ▲▲ FIN DE MODIFICACIÓN ▲▲

                div.innerHTML = `
                <div class="product-status-badge ${item.isActive !== false ? 'active' : 'inactive'}">
                    ${item.isActive !== false ? 'Activo' : 'Inactivo'}
                </div>
                <div class="product-item-info">
                    <img src="${item.image || defaultPlaceholder}" alt="${item.name}">
                    <div class="product-item-details">
                        <span>${item.name}</span>
                        <p><strong>Categoría:</strong> ${categoryName}</p>
                        <p><strong>Precio:</strong> $${item.price.toFixed(2)}</p>
                        <p><strong>Costo:</strong> $${item.cost.toFixed(2)}</p>
                        <p><strong>Stock:</strong> ${item.trackStock ? item.stock : 'N/A'}</p>
                        ${stockIndicator}
                        ${expiryIndicator}
                    </div>
                </div>
                <div class="product-item-controls">
                    <button class="btn-toggle-status ${item.isActive !== false ? 'btn-deactivate' : 'btn-activate'}" data-id="${item.id}">
                        ${item.isActive !== false ? 'Desactivar' : 'Activar'}
                    </button>
                    <button class="edit-product-btn" data-id="${item.id}">✏️</button>
                    <button class="delete-product-btn" data-id="${item.id}">🗑️</button>
                </div>`;
                productListContainer.appendChild(div);
            });
        } catch (error) {
            console.error('Error loading product management:', error.message);
            showMessageModal(`Error al cargar la gestión de productos: ${error.message}`);
        }
    };
    const editProductForm = async (id) => {
        try {
            const item = await loadData(STORES.MENU, id);
            if (item) {
                resetProductForm();
                productIdInput.value = item.id;
                productNameInput.value = item.name;
                productDescriptionInput.value = item.description || '';
                productCategorySelect.value = item.categoryId || '';
                imagePreview.src = item.image || defaultPlaceholder;
                productFormTitle.textContent = `Editar: ${item.name}`;
                cancelEditBtn.classList.remove('hidden');

                // ▼▼ MODIFICADO: Llenar campo de fecha de caducidad ▼▼
                productExpiryDateInput.value = item.expiryDate || '';

                saleTypeSelect.value = item.saleType || 'unit';
                updateProductForm();

                if (item.saleType === 'bulk' && item.bulkData) {
                    bulkPurchaseQuantityInput.value = item.bulkData.purchase.quantity;
                    bulkPurchaseUnitInput.value = item.bulkData.purchase.unit;
                    bulkPurchaseCostInput.value = item.bulkData.purchase.cost;
                } else {
                    productPriceInput.value = item.price;
                    productCostInput.value = item.cost || 0;
                    const productStockInput = document.getElementById('product-stock');
                    if (productStockInput) productStockInput.value = item.stock || 0;
                }

                window.scrollTo(0, 0);

                try {
                    const ingredientsData = await loadData(STORES.INGREDIENTS, id);
                    currentIngredients = ingredientsData ? ingredientsData.ingredients : [];
                    editingProductId = id;
                } catch (error) {
                    console.error('Error loading ingredients:', error);
                    currentIngredients = [];
                    editingProductId = id;
                }

                document.querySelector('.tab-btn[data-tab="add-product"]').click();
            }
        } catch (error) {
            console.error('Error loading product for editing:', error.message);
            showMessageModal(`Error al cargar producto para edición: ${error.message}`);
        }
    };
    const resetProductForm = () => {
        if (productForm) productForm.reset();
        if (productIdInput) productIdInput.value = '';
        if (productFormTitle) productFormTitle.textContent = 'Añadir Nuevo Producto';
        if (cancelEditBtn) cancelEditBtn.classList.add('hidden');
        if (imagePreview) imagePreview.src = defaultPlaceholder;
        if (productImageFileInput) productImageFileInput.value = null;
        if (productCostInput) productCostInput.value = '';
        if (productStockInput) productStockInput.value = '0';
        if (productCategorySelect) productCategorySelect.value = '';
        if (productExpiryDateInput) productExpiryDateInput.value = ''; // Limpiar fecha

        if (saleTypeSelect) saleTypeSelect.value = 'unit';
        const bulkSalePriceInput = document.getElementById('bulk-sale-price');
        if (bulkSalePriceInput) bulkSalePriceInput.value = '';
        if (bulkCostPerUnitMessage) bulkCostPerUnitMessage.style.display = 'none';
        if (bulkProfitMarginMessage) bulkProfitMarginMessage.style.display = 'none';
        updateProductForm();

        currentIngredients = [];
        editingProductId = null;
    };
    const saveProduct = async (e) => {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia para usar esta función.');
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return;
        }
        e.preventDefault();

        try {
            const id = productIdInput.value;
            const name = productNameInput.value.trim();
            const saleType = saleTypeSelect.value;
            let price, cost, stock, trackStock, bulkData = null;

            if (saleType === 'unit') {
                price = parseFloat(productPriceInput.value);
                cost = parseFloat(productCostInput.value);
                stock = parseInt(productStockInput.value, 10);
                if (!name || isNaN(price) || price <= 0 || isNaN(cost) || cost < 0) {
                    showMessageModal('Por favor, ingresa un nombre, precio y costo válidos.');
                    return;
                }
                trackStock = stock > 0;
            } else { // saleType === 'bulk'
                const bulkSalePriceInput = document.getElementById('bulk-sale-price');
                const purchaseQty = parseFloat(bulkPurchaseQuantityInput.value);
                const purchaseUnit = bulkPurchaseUnitInput.value.trim();
                const purchaseCost = parseFloat(bulkPurchaseCostInput.value);
                price = parseFloat(bulkSalePriceInput.value);
                stock = purchaseQty;
                if (!name || isNaN(purchaseQty) || !purchaseUnit || isNaN(purchaseCost) || isNaN(price) || price <= 0) {
                    showMessageModal('Por favor, completa todos los campos para la venta a granel con valores válidos.');
                    return;
                }
                cost = purchaseCost / purchaseQty;
                trackStock = stock > 0;
                bulkData = {
                    purchase: { quantity: purchaseQty, unit: purchaseUnit, cost: purchaseCost },
                    sale: { unit: purchaseUnit }
                };
            }

            const productData = {
                id: id || `product-${Date.now()}`,
                name,
                price,
                cost,
                stock,
                trackStock,
                saleType,
                bulkData,
                description: productDescriptionInput.value.trim(),
                image: imagePreview.src,
                categoryId: productCategorySelect.value,
                isActive: id ? (await loadData(STORES.MENU, id)).isActive : true,
                barcode: document.getElementById('product-barcode').value.trim(),
                // ▼▼ MODIFICADO: Guardar fecha de caducidad ▼▼
                expiryDate: productExpiryDateInput.value || null
            };

            editingProductId = productData.id;
            await saveData(STORES.MENU, productData);
            updateMenuCache(productData);

            if (currentIngredients.length > 0 && editingProductId) {
                await saveIngredients();
            }

            showMessageModal(`Producto "${name}" guardado.`);
            resetProductForm();
            renderProductManagement();
            renderMenu();
            
            // ▼▼ MODIFICADO: Actualizar alertas después de guardar ▼▼
            if(ticker) await ticker.updateAlerts();

        } catch (error) {
            console.error('Error saving product:', error.message);
            showMessageModal(`Error al guardar producto: ${error.message}`);
        }
    };

    const deleteProduct = async (id) => {
        try {
            const item = await loadData(STORES.MENU, id);
            if (!item) return;

            showMessageModal(`¿Seguro que quieres eliminar "${item.name}"? Se moverá a la papelera.`, async () => {
                try {
                    item.deletedTimestamp = new Date().toISOString();
                    await saveData(STORES.DELETED_MENU, item);
                    await deleteData(STORES.MENU, id);

                    if (dataCache.menu) {
                        dataCache.menu = dataCache.menu.filter(p => p.id !== id);
                    }
                    order = order.filter(i => i.id !== id);

                    showMessageModal('Producto movido a la papelera.');
                    renderProductManagement();
                    renderMenu();
                    updateOrderDisplay();
                    if (dashboard) dashboard.renderDashboard();
                    
                    // ▼▼ MODIFICADO: Actualizar alertas después de eliminar ▼▼
                    if(ticker) await ticker.updateAlerts();

                } catch (error) {
                    console.error('Error moving product to deleted store:', error.message);
                    showMessageModal(`Error al eliminar producto: ${error.message}`);
                }
            });
        } catch (error) {
            console.error('Error loading product for deletion:', error.message);
        }
    };

    window.restoreProduct = async (id) => {
        try {
            const item = await loadData(STORES.DELETED_MENU, id);
            if (!item) {
                showMessageModal('Error: No se encontró el producto en la papelera.');
                return;
            }
            delete item.deletedTimestamp;
            await saveData(STORES.MENU, item);
            await deleteData(STORES.DELETED_MENU, id);
            updateMenuCache(item);
            showMessageModal(`Producto "${item.name}" restaurado.`);
            renderProductManagement();
            renderMenu();
            if (dashboard) dashboard.renderDashboard();

            // ▼▼ MODIFICADO: Actualizar alertas después de restaurar ▼▼
            if(ticker) await ticker.updateAlerts();

        } catch (error) {
            console.error('Error restoring product:', error.message);
            showMessageModal('Error al restaurar el producto.');
        }
    };

    // --- INICIALIZACIÓN DE DATOS POR DEFECTO ---
    const initializeDefaultData = async () => {
        try {
            const db = await initDB(); // Get the database instance
            if (!db.objectStoreNames.contains(STORES.MENU)) {
                console.error('Menu store not found during initialization');
                throw new Error('Menu store not found');
            }
            let existingMenu = await loadData(STORES.MENU);
            if (existingMenu.length === 0) {
                console.log('Initializing default menu');
                await saveData(STORES.MENU, initialMenu);
                dataCache.menu = initialMenu;
                dataCache.lastUpdated.menu = Date.now();
            } else {
                console.log('Normalizing existing menu');
                const normalizedMenu = normalizeProducts(existingMenu);
                await saveData(STORES.MENU, normalizedMenu);
                dataCache.menu = normalizedMenu;
                dataCache.lastUpdated.menu = Date.now();
            }
            if (!db.objectStoreNames.contains(STORES.COMPANY)) {
                console.error('Company store not found during initialization');
                throw new Error('Company store not found');
            }
            const existingCompany = await loadData(STORES.COMPANY, 'company');
            if (!existingCompany) {
                console.log('Initializing default company data');
                const defaultCompany = { id: 'company', name: 'Lanzo Negocio', phone: '', address: '', logo: '' };
                await saveData(STORES.COMPANY, defaultCompany);
                dataCache.company = defaultCompany;
                dataCache.lastUpdated.company = Date.now();
            }
            if (!db.objectStoreNames.contains(STORES.THEME)) {
                console.error('Theme store not found during initialization');
                throw new Error('Theme store not found');
            }
            const existingTheme = await loadData(STORES.THEME, 'theme');
            if (!existingTheme) {
                console.log('Initializing default theme');
                await saveData(STORES.THEME, defaultTheme);
                dataCache.theme = defaultTheme;
                dataCache.lastUpdated.theme = Date.now();
            }
        } catch (error) {
            console.error('Error initializing default data:', error.message, error.stack);
            throw error; // Re-lanzar para que initApp lo capture
        }

        return businessTips;
    }

    // Validar la inicialización de la base de datos y verificar datos iniciales
    async function validateAndInitializeDashboard() {
        try {
            await initDB();
            console.log('Base de datos inicializada correctamente.');

            // Verificar datos en los almacenes
            const menuData = await loadData(STORES.MENU);
            const salesData = await loadData(STORES.SALES);

            if (!menuData || menuData.length === 0) {
                console.warn('El almacén MENU está vacío.');
            } else {
                console.log('Datos en MENU:', menuData);
            }

            if (!salesData || salesData.length === 0) {
                console.warn('El almacén SALES está vacío.');
            } else {
                console.log('Datos en SALES:', salesData);
            }

            // Renderizar el dashboard después de validar los datos
            if (dashboard) {
                dashboard.renderDashboard();
            }
        } catch (error) {
            console.error('Error al inicializar el dashboard:', error);
        }
    }

    // Llamar a la función después de cargar el DOM
    document.addEventListener('DOMContentLoaded', () => {
        validateAndInitializeDashboard();
    });
    const revalidateLicenseInBackground = async (savedLicense) => {
        try {
            const validationResult = await Promise.race([
                window.revalidateLicense(), // Asume que esta función existe
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)) // Aumenta a 15s
            ]);
            if (validationResult.valid) {
                localStorage.setItem('lanzo_license', JSON.stringify(validationResult));
                await saveLicenseToIndexedDB(validationResult);
                renderLicenseInfo(validationResult);
            }
        } catch (error) {
            console.warn('Background revalidation failed:', error.message);
            // NO borres nada; mantén la licencia local y reintenta en 5 min
            setTimeout(() => revalidateLicenseInBackground(savedLicense), 5 * 60 * 1000);
        }
    };
    // --- FUNCIÓN MEJORADA PARA INICIALIZAR LICENCIA ---
    const initializeLicense = async () => {
        console.log('Starting license initialization...');
        // Verificar disponibilidad de almacenamientos
        const localStorageAvailable = isLocalStorageEnabled();
        console.log('LocalStorage available:', localStorageAvailable);
        if (!localStorageAvailable) {
            console.error("LocalStorage is not available.");
            if (welcomeModal) {
                welcomeModal.style.display = 'flex';
                showLicenseMessage('Error: El almacenamiento local está desactivado. La licencia no se puede guardar.', 'error');
                const submitBtn = licenseForm ? licenseForm.querySelector('button[type="submit"]') : null;
                if (submitBtn) {
                    submitBtn.disabled = true;
                }
            }
            isAppUnlocked = false;
            return { unlocked: false };
        }
        // Detección especial para Edge
        if (isEdgeBrowser()) {
            console.log('Edge browser detected, using enhanced storage');
        }
        let savedLicenseJSON = localStorage.getItem('lanzo_license');
        let savedLicense = null;
        // Intentar obtener de localStorage
        if (savedLicenseJSON) {
            try {
                savedLicense = JSON.parse(savedLicenseJSON);
                console.log('License found in localStorage:', savedLicense);
            } catch (parseError) {
                console.error('Error parsing localStorage license:', parseError);
            }
        }
        // Si no hay en localStorage, intentar con IndexedDB o cookie (fallback)
        if (!savedLicense) {
            savedLicense = await getLicenseFromIndexedDB();  // Esto ya incluye fallback a cookie en tu modificación
            if (savedLicense) {
                // Restaurar en localStorage
                localStorage.setItem('lanzo_license', JSON.stringify(savedLicense));
                console.log('License restored from IndexedDB or cookie to localStorage');
            }
        }
        // AQUÍ: Verifica localExpiry SOLO DESPUÉS de asignar savedLicense
        if (savedLicense && savedLicense.localExpiry) {
            const localExpiryDate = normalizeDate(savedLicense.localExpiry);
            const now = new Date();
            if (localExpiryDate > now) {
                console.log('Using local expiry for valid license');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                // Revalidar en segundo plano
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            }
        }
        if (!savedLicense) {
            console.log('No license found in any storage');
            renderLicenseInfo({ valid: false });
            isAppUnlocked = false;
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return { unlocked: false };
        }
        // Verificar si el usuario marcó "recordar" y no ha expirado el recordatorio local
        if (savedLicense.remembered && savedLicense.localExpiry) {
            const localExpiryDate = normalizeDate(savedLicense.localExpiry);
            const now = new Date();
            if (localExpiryDate > now) {
                console.log('Using remembered license (local expiry valid)');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                // Revalidar en segundo plano
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            }
        }
        // Verificar si la licencia aún es válida (fecha de expiración)
        if (savedLicense.expires_at) {
            const expiryDate = normalizeDate(savedLicense.expires_at);
            const now = new Date();
            if (expiryDate > now) {
                // Licencia válida - desbloquear aplicación inmediatamente
                console.log('License is valid, unlocking app');
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(savedLicense);
                // Revalidación en segundo plano sin bloquear
                revalidateLicenseInBackground(savedLicense).catch(error => {
                    console.warn('Background license revalidation failed:', error.message);
                });
                return { unlocked: true };
            } else {
                // Licencia expirada
                console.log('License expired');
                localStorage.removeItem('lanzo_license');
                renderLicenseInfo({ valid: false });
                isAppUnlocked = false;
                if (welcomeModal) welcomeModal.style.display = 'flex';
                return { unlocked: false };
            }
        } else {
            // Sin fecha de expiración (licencia perpetua)
            console.log('Perpetual license detected');
            isAppUnlocked = true;
            if (welcomeModal) welcomeModal.style.display = 'none';
            renderLicenseInfo(savedLicense);
            return { unlocked: true };
        }
    };
    // --- EVENT LISTENERS ---
    // Listener para el logo/home link
    const homeLink = document.getElementById('home-link');
    if (homeLink) {
        homeLink.addEventListener('click', () => showSection('pos'));
    }


    // Listener unificado para todos los botones de navegación
    const navLinksContainer = document.getElementById('main-nav-links');
    if (navLinksContainer) {
        navLinksContainer.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (link && link.dataset.section) {
                showSection(link.dataset.section);
            }
        });
    }

    // Listeners para el menú móvil (hamburguesa y fondo)
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const backdrop = document.getElementById('backdrop');

    const toggleMenu = () => {
        // Ahora usamos navLinksContainer en lugar del antiguo mobileMenu
        if (navLinksContainer) navLinksContainer.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('open');
    };

    // La condición ahora busca el contenedor correcto y no debería fallar
    if (mobileMenuButton && navLinksContainer && backdrop) {
        mobileMenuButton.addEventListener('click', toggleMenu);
        backdrop.addEventListener('click', toggleMenu);
    } else {
        // Este mensaje ya no debería aparecer en la consola
        console.error('Error: No se encontraron los elementos críticos del menú móvil.');
    }
    if (document.getElementById('process-order-btn')) document.getElementById('process-order-btn').addEventListener('click', openPaymentProcess);
    if (document.getElementById('clear-order-btn')) document.getElementById('clear-order-btn').addEventListener('click', () => {
        if (order.length > 0) {
            showMessageModal('¿Seguro que quieres limpiar el pedido?', () => {
                order = [];
                updateOrderDisplay();
            });
        }
    });

    
    if (paymentAmountInput) paymentAmountInput.addEventListener('input', () => {
        const total = parseFloat(paymentTotal.textContent.replace('$', ''));
        const amountPaid = parseFloat(paymentAmountInput.value) || 0;
        const change = amountPaid - total;
        if (change >= 0) {
            if (paymentChange) paymentChange.textContent = `$${change.toFixed(2)}`;
            if (confirmPaymentBtn) confirmPaymentBtn.disabled = false;
        } else {
            if (paymentChange) paymentChange.textContent = '$0.00';
            if (confirmPaymentBtn) confirmPaymentBtn.disabled = true;
        }
    });
    if (confirmPaymentBtn) confirmPaymentBtn.addEventListener('click', processOrder);
    if (document.getElementById('cancel-payment-btn')) document.getElementById('cancel-payment-btn').addEventListener('click', () => {
        if (paymentModal) paymentModal.classList.add('hidden');
    });
    if (companyForm) companyForm.addEventListener('submit', saveCompanyData);
    if (companyLogoFileInput) companyLogoFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const compressedImage = await compressImage(file);
            if (companyLogoPreview) companyLogoPreview.src = compressedImage;
        }
    });
    if (productForm) productForm.addEventListener('submit', saveProduct);
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetProductForm);
    if (productImageFileInput) productImageFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const compressedImage = await compressImage(file);
            if (imagePreview) imagePreview.src = compressedImage;
        }
    });

    if (saleTypeSelect) saleTypeSelect.addEventListener('change', updateProductForm);

    // Event listeners para mensajes dinámicos de venta a granel
    if (bulkPurchaseQuantityInput) bulkPurchaseQuantityInput.addEventListener('input', updateBulkMessages);
    if (bulkPurchaseCostInput) bulkPurchaseCostInput.addEventListener('input', updateBulkMessages);
    if (bulkSalePriceInput) bulkSalePriceInput.addEventListener('input', updateBulkMessages);
    if (bulkPurchaseUnitInput) bulkPurchaseUnitInput.addEventListener('change', updateBulkMessages);

    // Event listeners para mensaje de ganancia en venta por unidad
    if (productCostInput) productCostInput.addEventListener('input', updateUnitMessages);
    if (productPriceInput) productPriceInput.addEventListener('input', updateUnitMessages);

    if (themeForm) themeForm.addEventListener('submit', saveThemeSettings);
    // Inicializar el estado del formulario al cargar la app
    updateProductForm();
    if (resetThemeBtn) resetThemeBtn.addEventListener('click', resetTheme);
    // Event listeners para la calculadora de costos
    if (costHelpButton) costHelpButton.addEventListener('click', openCostCalculator);
    if (addIngredientButton) addIngredientButton.addEventListener('click', addIngredient);
    if (assignCostButton) assignCostButton.addEventListener('click', assignCostToProduct);
    if (closeCostModalButton) closeCostModalButton.addEventListener('click', closeCostCalculator);
    // Permitir agregar ingredientes con la tecla Enter
    if (ingredientNameInput) ingredientNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });
    if (ingredientCostInput) ingredientCostInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });
    if (ingredientQuantityInput) ingredientQuantityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });

    // --- EVENT LISTENERS PARA CATEGORÍAS ---
    if (categoryModalButton) categoryModalButton.addEventListener('click', () => {
        resetCategoryForm();
        if (categoryModal) categoryModal.classList.remove('hidden');
    });
    if (closeCategoryModalBtn) closeCategoryModalBtn.addEventListener('click', () => {
        if (categoryModal) categoryModal.classList.add('hidden');
    });
    if (saveCategoryBtn) saveCategoryBtn.addEventListener('click', saveCategory);
    if (cancelCategoryEditBtn) cancelCategoryEditBtn.addEventListener('click', resetCategoryForm);
    if (categoryListContainer) categoryListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('edit-category-btn')) {
            const id = e.target.dataset.id;
            editCategory(id);
        }
        if (e.target.classList.contains('delete-category-btn')) {
            const id = e.target.dataset.id;
            deleteCategory(id);
        }
    });
    const welcomeModal = document.getElementById('welcome-modal');
    const licenseForm = document.getElementById('license-form');
    const licenseKeyInput = document.getElementById('license-key');
    const licenseMessage = document.getElementById('license-message');
    const licenseInfoContainer = document.getElementById('license-info-container');
    // --- LICENSE HANDLING AT STARTUP ---
    if (licenseForm) licenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const licenseKey = licenseKeyInput ? licenseKeyInput.value.trim() : '';
        const rememberDevice = rememberDeviceCheckbox ? rememberDeviceCheckbox.checked : false;
        if (!licenseKey) return showLicenseMessage('Por favor ingrese una clave de licencia válida', 'error');
        try {
            const activationResult = await activateLicense(licenseKey);
            if (activationResult.valid) {
                const licenseDataToStore = activationResult.details;
                licenseDataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // siempre en 30dias locales
                localStorage.setItem('lanzo_license', JSON.stringify(licenseDataToStore));
                await saveLicenseToIndexedDB(licenseDataToStore);
                // Si el usuario marcó "recordar", guardar con una fecha de expiración más lejana
                if (rememberDevice) {
                    licenseDataToStore.remembered = true;
                    // Extender la validez local por 30 días
                    licenseDataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                }
                // Guardar en localStorage
                localStorage.setItem('lanzo_license', JSON.stringify(licenseDataToStore));
                // Guardar respaldo en IndexedDB
                await saveLicenseToIndexedDB(licenseDataToStore);
                isAppUnlocked = true;
                if (welcomeModal) welcomeModal.style.display = 'none';
                renderLicenseInfo(licenseDataToStore);
                // Start the main app UI
                renderCompanyData();
                showSection('pos');
            } else {
                showLicenseMessage(activationResult.message || 'Licencia no válida o no se pudo activar.', 'error');
            }
        } catch (error) {
            showLicenseMessage(`Error al conectar con el servidor: ${error.message}`, 'error');
        }
    });
    function showLicenseMessage(message, type) {
        if (!licenseMessage) return;
        licenseMessage.textContent = message;
        licenseMessage.style.display = 'block';
        licenseMessage.style.color = type === 'error' ? '#dc3545' : '#198754';
        setTimeout(() => {
            if (licenseMessage) licenseMessage.style.display = 'none';
        }, 5000);
    }
    function renderLicenseInfo(licenseData) {
        if (!licenseInfoContainer) return;
        if (!licenseData || !licenseData.valid) {
            licenseInfoContainer.innerHTML = `<p>No hay una licencia activa. <a href="#" id="show-license-modal">Ingresar licencia</a></p>`;
            const link = document.getElementById('show-license-modal');
            if (link) link.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('lanzo_license');
                if (welcomeModal) welcomeModal.style.display = 'flex';
            });
            return;
        }
        const { license_key, product_name, expires_at } = licenseData;
        const statusText = 'Activa y Verificada';
        licenseInfoContainer.innerHTML = `
            <div class="license-detail"><span>Clave:</span><span>${license_key || 'N/A'}</span></div>
            <div class="license-detail"><span>Producto:</span><span>${product_name || 'N/A'}</span></div>
            <div class="license-detail"><span>Expira:</span><span>${expires_at ? new Date(expires_at).toLocaleDateString() : 'Nunca'}</span></div>
            <div class="license-detail"><span>Estado:</span><span class="license-status-active">${statusText}</span></div>
            <div class="license-buttons" style="margin-top: 15px;">
                <button id="delete-license-btn" class="btn btn-cancel">Desactivar en este dispositivo</button>
            </div>
        `;
        const deleteLicenseBtn = document.getElementById('delete-license-btn');
        if (deleteLicenseBtn) deleteLicenseBtn.addEventListener('click', async () => {
            showMessageModal('¿Seguro que quieres desactivar la licencia en este dispositivo?', async () => {
                try {
                    const result = await window.deactivateCurrentDevice(license_key);
                    if (result.success) {
                        showMessageModal('Dispositivo desactivado. La aplicación se recargará.', () => {
                            localStorage.removeItem('lanzo_license');
                            window.location.reload();
                        });
                    } else {
                        showMessageModal(`Error: ${result.message}. ¿Eliminar licencia localmente?`, () => {
                            localStorage.removeItem('lanzo_license');
                            window.location.reload();
                        });
                    }
                } catch (error) {
                    showMessageModal(`Error: ${error.message}. ¿Eliminar licencia localmente?`, () => {
                        localStorage.removeItem('lanzo_license');
                        window.location.reload();
                    });
                }
            });
        });
    };

    const addMultipleItemsToOrder = (itemsToAdd) => {
        itemsToAdd.forEach(itemToAdd => {
            const existingItem = order.find(orderItem => orderItem.id === itemToAdd.id);
            if (existingItem) {
                existingItem.quantity += itemToAdd.quantity;
            } else {
                // Aseguramos que solo se añadan las propiedades necesarias
                order.push({
                    id: itemToAdd.id,
                    name: itemToAdd.name,
                    price: itemToAdd.price,
                    cost: itemToAdd.cost,
                    image: itemToAdd.image,
                    trackStock: itemToAdd.trackStock,
                    quantity: itemToAdd.quantity
                });
            }
        });
        updateOrderDisplay();
    };
    // --- INICIALIZACIÓN DE LA APLICACIÓN ---
    const initApp = async () => {
        try {
            // Escuchar eventos de navegación personalizados
            document.addEventListener('navigateTo', (e) => {
                if (e.detail) {
                    showSection(e.detail);
                }
            });
            // Mostrar pantalla de carga solo si el elemento existe
            if (loadingScreen) loadingScreen.style.display = 'flex';
            await initDB();

            // --- VALIDACION DE CAJA AL INICIO ---
            await validarCaja();
            // Ejecutar operaciones en paralelo
            const [licenseResult, defaultDataResult] = await Promise.all([
                initializeLicense(),
                initializeDefaultData()
            ]);
            // Inicializar los módulos después de que las dependencias estén listas
            await renderCategories(); // Cargar categorías al inicio

            initCajaModule(); // Inicializar módulo de caja
            // Función para inicializar el escáner de forma segura, esperando a que ZXing esté listo
            const initializeScannerWhenReady = () => {
                if (typeof ZXing !== 'undefined' && ZXing.BrowserMultiFormatReader) {
                    console.log('ZXing library loaded, initializing scanner module.');
                    // Pasamos la nueva función como dependencia
                    initScannerModule({
                        loadDataWithCache,
                        addItemToOrder,
                        addMultipleItemsToOrder // <--- NUEVA DEPENDENCIA
                    });
                } else {
                    console.log('ZXing library not ready, waiting...');
                    setTimeout(initializeScannerWhenReady, 150);
                }
            };
            initializeScannerWhenReady();

            initCustomersModule({
                saveData,
                loadData,
                deleteData,
                showMessageModal,
                STORES
            });

            dashboard = createDashboardModule({
                loadData,
                showMessageModal,
                deleteData,
                saveData,
                normalizeProducts,
                STORES,
                renderMenu
            });

            businessTips = createBusinessTipsModule({
                loadData,
                showMessageModal,
                STORES
            });

            ticker = createTickerModule();
            // Configurar renovación automática de licencias (cada 24 horas)
            setInterval(renewLicenseAutomatically, 24 * 60 * 60 * 1000);
            // Lógica de Pestañas (Tabs) para Productos
            const productTabsContainer = document.getElementById('product-tabs');
            if (productTabsContainer) {
                productTabsContainer.addEventListener('click', (e) => {
                    if (e.target.classList.contains('tab-btn')) {
                        const tabName = e.target.dataset.tab;
                        // Botones
                        productTabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                        e.target.classList.add('active');
                        // Contenido
                        document.querySelectorAll('#product-management-section .tab-content').forEach(content => {
                            content.classList.remove('active');
                        });
                        const tabContent = document.getElementById(`${tabName}-content`);
                        if (tabContent) tabContent.classList.add('active');
                    }
                });
            }
            // Lógica del buscador de productos en POS
            const posProductSearch = document.getElementById('pos-product-search');
            if (posProductSearch) {
                posProductSearch.addEventListener('input', (e) => {
                    const searchTerm = e.target.value;
                    // Obtenemos la categoría activa para mantener el filtro
                    const activeCategoryBtn = document.querySelector('#category-filters .category-filter-btn.active');
                    const categoryId = activeCategoryBtn ? activeCategoryBtn.dataset.id : null;
                    renderMenu(categoryId, searchTerm);
                });
            }
            // Lógica del buscador de productos
            const productSearchInput = document.getElementById('product-search-input');
            if (productSearchInput) {
                productSearchInput.addEventListener('input', (e) => {
                    renderProductManagement(e.target.value);
                });
            }
            // Delegación de eventos para la lista de productos
            if (productListContainer) {
                productListContainer.addEventListener('click', async (e) => { // <-- Añade async aquí
                    const button = e.target.closest('button'); // <-- Simplificamos la selección
                    if (!button) return;

                    const id = button.dataset.id;

                    if (button.classList.contains('edit-product-btn')) {
                        editProductForm(id);
                    } else if (button.classList.contains('delete-product-btn')) {
                        deleteProduct(id);
                    } else if (button.classList.contains('btn-toggle-status')) {
                        try {
                            const product = await loadData(STORES.MENU, id);
                            if (product) {
                                // Invertir el estado (si es undefined o true, se vuelve false)
                                product.isActive = !(product.isActive !== false);
                                await saveData(STORES.MENU, product);

                                // --- INICIO DE LA CORRECCIÓN ---
                                // Se añade esta línea para actualizar la caché con el nuevo estado del producto.
                                updateMenuCache(product);
                                // --- FIN DE LA CORRECCIÓN ---

                                await renderProductManagement(); // Refrescar la lista de productos
                                await renderMenu(); // Refrescar el punto de venta
                            }
                        } catch (error) {
                            showMessageModal('Error al cambiar el estado del producto.');
                            console.error('Error toggling product status:', error);
                        }
                    }
                });
            }
            // Lógica de Pestañas (Tabs) para Ventas
            const salesTabsContainer = document.getElementById('sales-tabs');
            if (salesTabsContainer) {
                salesTabsContainer.addEventListener('click', async (e) => {
                    if (e.target.classList.contains('tab-btn')) {
                        const tabName = e.target.dataset.tab;
                        // Botones
                        salesTabsContainer.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
                        e.target.classList.add('active');
                        // Contenido
                        document.querySelectorAll('#dashboard-section .tab-content').forEach(content => {
                            content.classList.remove('active');
                        });
                        const tabContent = document.getElementById(tabName);
                        if (tabContent) tabContent.classList.add('active');
                        // Llama a la función de renderizado apropiada al cambiar de pestaña
                        if (tabName === 'tips-content') {
                            if (businessTips) businessTips.renderBusinessTips();
                        } else {
                            if (dashboard) dashboard.renderDashboard();
                        }
                    }
                });
            }
            
            // ▼▼ MODIFICADO: Llamar a la comprobación de alertas al iniciar ▼▼
            if(ticker) await ticker.renderTicker();

            // Ocultar pantalla de carga al finalizar (si existe)
            if (loadingScreen) loadingScreen.style.display = 'none';
            // Si la licencia está desbloqueada, mostrar la sección principal
            if (licenseResult.unlocked) {
                renderCompanyData();
                showSection('pos');
            }
        } catch (error) {
            if (loadingScreen) loadingScreen.style.display = 'none';
            console.error('Error initializing application:', error.message);
            showMessageModal(`Error fatal al inicializar: ${error.message}. Por favor, recarga la página.`);
        }
        initializeDonationSection();
    };

    initApp();

});