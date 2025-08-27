document.addEventListener('DOMContentLoaded', () => {
    console.log('app.js: DOMContentLoaded event fired.');
    
    // --- VARIABLES GLOBALES Y DATOS INICIALES ---
    let isAppUnlocked = false;
    let order = [];
    let db = null;
    let dashboard, businessTips; // Declarar módulos aquí
    
    const DB_NAME = 'LanzoDB1';
    const DB_VERSION = 5; // Incrementado para agregar almacenamiento de categorías
    const STORES = {
        MENU: 'menu',
        SALES: 'sales',
        COMPANY: 'company',
        THEME: 'theme',
        INGREDIENTS: 'ingredients',
        CATEGORIES: 'categories' // Nuevo almacén para categorías
    };
    
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
    
    const loadDataWithCache = async (storeName, key = null, maxAge = 300000) => { // 5 minutos
        const now = Date.now();
        
        // Verificar si tenemos datos en caché y son recientes
        if (dataCache[storeName] && (now - dataCache.lastUpdated[storeName] < maxAge)) {
            return key ? dataCache[storeName].find(item => item.id === key) : dataCache[storeName];
        }
        
        // Cargar desde IndexedDB
        const data = await loadData(storeName, key);
        
        // Actualizar caché
        dataCache[storeName] = data;
        dataCache.lastUpdated[storeName] = now;
        
        return data;
    };
    
    // --- FUNCIÓN PARA CALCULAR LUMINANCIA Y AJUSTAR COLOR DE TEXTO ---
    const getContrastColor = (hexColor) => {
        // Convert hex to RGB
        const r = parseInt(hexColor.slice(1, 3), 16) / 255;
        const g = parseInt(hexColor.slice(3, 5), 16) / 255;
        const b = parseInt(hexColor.slice(5, 7), 16) / 255;
        // Calculate luminance (ITU-R BT.709 formula)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // Return white for dark backgrounds, black for light backgrounds
        return luminance > 0.5 ? '#000000' : '#ffffff';
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
    
    // --- FUNCIÓN PARA COMPRIMIR IMÁGENES ---
    const compressImage = (file, maxWidth = 300, quality = 0.7) => {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = () => {
                // Calcular nuevas dimensiones manteniendo la proporción
                const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
                canvas.width = img.width * ratio;
                canvas.height = img.height * ratio;
                
                // Dibujar imagen redimensionada
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Convertir a base64 con calidad reducida
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            
            img.src = URL.createObjectURL(file);
        });
    };
    
    // --- INICIALIZACIÓN DE INDEXEDDB ---
    const initDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                console.log('Database opened successfully:', db.objectStoreNames);
                resolve(db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('Upgrading database to version', DB_VERSION);
                if (!db.objectStoreNames.contains(STORES.MENU)) {
                    const menuStore = db.createObjectStore(STORES.MENU, { keyPath: 'id' });
                    menuStore.createIndex('name', 'name', { unique: false });
                    console.log('Created menu store');
                }
                if (!db.objectStoreNames.contains(STORES.SALES)) {
                    const salesStore = db.createObjectStore(STORES.SALES, { keyPath: 'timestamp' });
                    salesStore.createIndex('date', 'timestamp', { unique: true });
                    console.log('Created sales store');
                }
                if (!db.objectStoreNames.contains(STORES.COMPANY)) {
                    db.createObjectStore(STORES.COMPANY, { keyPath: 'id' });
                    console.log('Created company store');
                }
                if (!db.objectStoreNames.contains(STORES.THEME)) {
                    db.createObjectStore(STORES.THEME, { keyPath: 'id' });
                    console.log('Created theme store');
                }
                // Crear almacén para ingredientes si no existe
                if (!db.objectStoreNames.contains(STORES.INGREDIENTS)) {
                    db.createObjectStore(STORES.INGREDIENTS, { keyPath: 'productId' });
                    console.log('Created ingredients store');
                }
                // Crear almacén para categorías si no existe
                if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
                    const categoryStore = db.createObjectStore(STORES.CATEGORIES, { keyPath: 'id' });
                    categoryStore.createIndex('name', 'name', { unique: true });
                    console.log('Created categories store');
                }
            };
        });
    };
    
    // --- FUNCIONES DE ALMACENAMIENTO CON INDEXEDDB ---
    const saveData = (storeName, data) => {
        if (!isAppUnlocked && welcomeModal && welcomeModal.style.display === 'none') {
            // Solo muestra el mensaje si el modal de bienvenida no está visible
            showMessageModal('Por favor, valida tu licencia en Configuración > Ingresar licencia');
            return Promise.reject('App not unlocked');
        }
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(storeName)) {
                reject(new Error(`Store ${storeName} does not exist`));
                return;
            }
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            if (Array.isArray(data)) {
                const requests = data.map(item => store.put(item));
                Promise.all(requests.map(req =>
                    new Promise((res, rej) => {
                        req.onsuccess = () => res();
                        req.onerror = () => rej(req.error);
                    })
                )).then(resolve).catch(reject);
            } else {
                const request = store.put(data);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            }
        });
    };
    
    const loadData = (storeName, key = null) => {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(storeName)) {
                console.error(`Store ${storeName} not found in database`);
                reject(new Error(`Store ${storeName} does not exist`));
                return;
            }
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            if (key) {
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } else {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }
        });
    };
    
    const deleteData = (storeName, key) => {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';  // Fuerza mostrar el modal de nuevo
            return;  // Bloquea la acción
        }
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(storeName)) {
                reject(new Error(`Store ${storeName} does not exist`));
                return;
            }
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    };
    
    // --- ELEMENTOS DEL DOM ---
    const sections = {
        pos: document.getElementById('pos-section'),
        productManagement: document.getElementById('product-management-section'),
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
            const categories = await loadDataWithCache(STORES.CATEGORIES);
            // 1. Renderizar lista en el modal de gestión
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
            // 2. Poblar el select del formulario de productos
            if (productCategorySelect) {
                productCategorySelect.innerHTML = '<option value="">Sin categoría</option>';
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    productCategorySelect.appendChild(option);
                });
            }
            // 3. Renderizar filtros en el TPV
            if (categoryFiltersContainer) {
                categoryFiltersContainer.innerHTML = '';
                const allButton = document.createElement('button');
                allButton.className = 'category-filter-btn active';
                allButton.textContent = 'Todos';
                allButton.addEventListener('click', () => {
                    renderMenu(); // Sin filtro
                    document.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
                    allButton.classList.add('active');
                });
                categoryFiltersContainer.appendChild(allButton);
                categories.forEach(cat => {
                    const button = document.createElement('button');
                    button.className = 'category-filter-btn';
                    button.textContent = cat.name;
                    button.dataset.id = cat.id;
                    button.addEventListener('click', () => {
                        renderMenu(cat.id); // Filtrar por esta categoría
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
            // Invalidar caché de categorías
            dataCache.categories = null;
            showMessageModal(`Categoría "${name}" guardada.`);
            resetCategoryForm();
            await renderCategories();
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
        Object.values(sections).forEach(section => {
            if (section) section.classList.remove('active');
        });
        const sectionElement = document.getElementById(`${sectionId}-section`);
        if (sectionElement) sectionElement.classList.add('active');
        if (sectionId === 'pos') renderMenu();
        if (sectionId === 'product-management') renderProductManagement();
        if (sectionId === 'dashboard') {
            loadDashboard().then(dash => {
                if (dash) dash.renderDashboard();
            });
        }
        if (sectionId === 'company') renderCompanyData();
        // Close mobile menu if open
        const mobileMenu = document.getElementById('mobile-menu');
        const backdrop = document.getElementById('backdrop');
        if (mobileMenu && mobileMenu.classList.contains('open')) {
            mobileMenu.classList.remove('open');
            if (backdrop) backdrop.classList.remove('open');
        }
    };
    
    // --- LÓGICA DE LA APLICACIÓN ---
    const showMessageModal = (message, onConfirm = null) => {
        if (!modalMessage || !messageModal || !closeModalBtn) return;
        modalMessage.textContent = message;
        messageModal.classList.remove('hidden');
        const originalText = closeModalBtn.textContent;
        const confirmMode = typeof onConfirm === 'function';
        if (confirmMode) {
            closeModalBtn.textContent = 'Sí, continuar';
        } else {
            closeModalBtn.textContent = 'Aceptar';
        }
        closeModalBtn.onclick = () => {
            messageModal.classList.add('hidden');
            if (confirmMode) onConfirm();
            closeModalBtn.textContent = 'Aceptar';
        };
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
    
    const renderMenu = async (filterCategoryId = null) => {
        if (!menuItemsContainer) return;
        try {
            let menu = await loadDataWithCache(STORES.MENU);
            menu = normalizeProducts(menu);
            if (filterCategoryId) {
                menu = menu.filter(item => item.categoryId === filterCategoryId);
            }
            menuItemsContainer.innerHTML = '';
            if (menu.length === 0) {
                menuItemsContainer.innerHTML = `<p class="empty-message">No hay productos en esta categoría.</p>`;
                return;
            }
            menu.forEach(item => {
                const menuItemDiv = document.createElement('div');
                menuItemDiv.className = 'menu-item';
                let stockInfo = '';
                if (item.trackStock) {
                    if (item.stock > 0) {
                        stockInfo = `<div class="stock-info">Stock: ${item.stock}</div>`;
                    } else {
                        stockInfo = `<div class="stock-info out-of-stock-label">AGOTADO</div>`;
                    }
                } else {
                    stockInfo = `<div class="stock-info no-stock-label">No llevado</div>`;
                }
                menuItemDiv.innerHTML = `
                        <img src="${item.image || defaultPlaceholder}" alt="${item.name}" onerror="this.onerror=null;this.src='${defaultPlaceholder}';">
                        <h3>${item.name}</h3>
                        <p>$${item.price.toFixed(2)}</p>
                        ${stockInfo}
                    `;
                // Permitir agregar si: no lleva control O (lleva control y tiene stock)
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
    
    const addItemToOrder = (item) => {
        // Si el producto lleva control de stock, validamos
        if (item.trackStock) {
            const existingItemInOrder = order.find(orderItem => orderItem.id === item.id);
            const currentQuantityInOrder = existingItemInOrder ? existingItemInOrder.quantity : 0;
            if (currentQuantityInOrder >= item.stock) {
                showMessageModal(`No puedes agregar más "${item.name}". No hay suficiente stock.`);
                return;
            }
        }
        // Si no lleva control, no validamos y agregamos directamente
        const existingItemInOrder = order.find(orderItem => orderItem.id === item.id);
        if (existingItemInOrder) {
            existingItemInOrder.quantity++;
        } else {
            order.push({ ...item, quantity: 1 });
        }
        updateOrderDisplay();
    };
    
    const updateOrderDisplay = () => {
        if (!orderListContainer || !emptyOrderMessage || !posTotalSpan) return;
        orderListContainer.innerHTML = '';
        emptyOrderMessage.classList.toggle('hidden', order.length > 0);
        order.forEach(item => {
            const orderItemDiv = document.createElement('div');
            orderItemDiv.className = 'order-item';
            orderItemDiv.innerHTML = `
                        <div class="order-item-info">
                            <span class="order-item-name">${item.name}</span>
                            <span class="order-item-price">$${item.price.toFixed(2)} c/u</span>
                        </div>
                        <div class="order-item-controls">
                            <button class="quantity-btn decrease" data-id="${item.id}" data-change="-1">-</button>
                            <span class="quantity-value">${item.quantity}</span>
                            <button class="quantity-btn increase" data-id="${item.id}" data-change="1">+</button>
                            <button class="remove-item-btn" data-id="${item.id}">X</button>
                        </div>
                    `;
            orderListContainer.appendChild(orderItemDiv);
        });
        orderListContainer.querySelectorAll('.quantity-btn').forEach(btn => btn.addEventListener('click', e => {
            const { id, change } = e.currentTarget.dataset;
            const itemIndex = order.findIndex(i => i.id === id);
            if (itemIndex > -1) {
                order[itemIndex].quantity += parseInt(change);
                if (order[itemIndex].quantity <= 0) order.splice(itemIndex, 1);
            }
            updateOrderDisplay();
        }));
        orderListContainer.querySelectorAll('.remove-item-btn').forEach(btn => btn.addEventListener('click', e => {
            order = order.filter(i => i.id !== e.currentTarget.dataset.id);
            updateOrderDisplay();
        }));
        calculateTotals();
    };
    
    const calculateTotals = () => {
        if (!posTotalSpan) return;
        const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        posTotalSpan.textContent = `$${total.toFixed(2)}`;
    };
    
    const openPaymentProcess = () => {
        if (!paymentModal || !paymentTotal || !paymentAmountInput || !paymentChange) return;
        if (order.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }
        const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        paymentTotal.textContent = `${total.toFixed(2)}`;
        paymentAmountInput.value = '';
        paymentChange.textContent = '$0.00';
        paymentModal.classList.remove('hidden');
        paymentAmountInput.focus();
    };
    
    const processOrder = async () => {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return;
        }
        try {
            // 1. Validar stock ANTES de procesar (solo para productos con control)
            for (const orderItem of order) {
                const product = await loadData(STORES.MENU, orderItem.id);
                if (product && product.trackStock) {
                    if (product.stock < orderItem.quantity) {
                        showMessageModal(`¡Stock insuficiente para "${orderItem.name}"! Solo quedan ${product.stock}.`);
                        if (paymentModal) paymentModal.classList.add('hidden');
                        return; // Detener el proceso
                    }
                }
            }
            // 2. Actualizar stock (solo para productos con control)
            for (const orderItem of order) {
                const product = await loadData(STORES.MENU, orderItem.id);
                if (product && product.trackStock) {
                    product.stock -= orderItem.quantity;
                    await saveData(STORES.MENU, product);
                    // Invalidar caché de menú
                    dataCache.menu = null;
                }
            }
            // 3. Guardar la venta
            const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const sale = {
                timestamp: new Date().toISOString(),
                items: JSON.parse(JSON.stringify(order)),
                total
            };
            await saveData(STORES.SALES, sale);
            // 4. Limpiar y actualizar UI
            if (paymentModal) paymentModal.classList.add('hidden');
            showMessageModal('¡Pedido procesado exitosamente!');
            order = [];
            updateOrderDisplay();
            renderMenu(); // Re-renderizar menú para mostrar stock actualizado
            if (dashboard) dashboard.renderDashboard();
            renderProductManagement();
        } catch (error) {
            console.error('Error processing order:', error.message);
            showMessageModal(`Error al procesar el pedido: ${error.message}`);
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
            filteredMenu.forEach(item => {
                const categoryName = item.categoryId ? categoryMap.get(item.categoryId) || 'Categoría eliminada' : 'Sin categoría';
                const div = document.createElement('div');
                div.className = 'product-item';
                div.innerHTML = `
                <div class="product-item-info">
                    <img src="${item.image || defaultPlaceholder}" alt="${item.name}">
                    <div class="product-item-details">
                        <span>${item.name}</span>
                        <p><strong>Categoría:</strong> ${categoryName}</p>
                        <p><strong>Precio:</strong> $${item.price.toFixed(2)}</p>
                        <p><strong>Costo:</strong> $${item.cost.toFixed(2)}</p>
                        <p><strong>Control de stock:</strong> ${item.trackStock ? 'Sí' : 'No'}</p>
                        <p><strong>Stock:</strong> ${item.trackStock ? item.stock : 'No aplica'}</p>
                    </div>
                </div>
                <div class="product-item-controls">
                    <button class="edit-product-btn" data-id="${item.id}">✏️</button>
                    <button class="delete-product-btn" data-id="${item.id}">🗑️</button>
                </div>`;
                productListContainer.appendChild(div);
            });
            // Los listeners de eventos ahora se manejan por delegación en initApp
        } catch (error) {
            console.error('Error loading product management:', error.message);
            showMessageModal(`Error al cargar la gestión de productos: ${error.message}`);
        }
    };
    
    const editProductForm = async (id) => {
        try {
            const item = await loadData(STORES.MENU, id);
            if (item) {
                if (productIdInput) productIdInput.value = item.id;
                if (productNameInput) productNameInput.value = item.name;
                if (productDescriptionInput) productDescriptionInput.value = item.description || '';
                if (productPriceInput) productPriceInput.value = item.price;
                if (productCostInput) productCostInput.value = item.cost || 0;
                if (productStockInput) productStockInput.value = item.stock || 0;
                if (productCategorySelect) productCategorySelect.value = item.categoryId || '';
                if (imagePreview) imagePreview.src = item.image || defaultPlaceholder;
                if (productFormTitle) productFormTitle.textContent = `Editar: ${item.name}`;
                if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');
                window.scrollTo(0, 0);
                // Cargar ingredientes del producto si existen
                try {
                    const ingredientsData = await loadData(STORES.INGREDIENTS, id);
                    currentIngredients = ingredientsData ? ingredientsData.ingredients : [];
                    editingProductId = id;
                } catch (error) {
                    console.error('Error loading ingredients:', error);
                    currentIngredients = [];
                    editingProductId = id;
                }
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
        // Limpiar ingredientes al resetear
        currentIngredients = [];
        editingProductId = null;
    };
    
    const saveProduct = async (e) => {
        if (!isAppUnlocked) {
            showMessageModal('Por favor, valida tu licencia en el modal de bienvenida para usar esta función. Ó en configuracion al final click en Ingresar licencia');
            if (welcomeModal) welcomeModal.style.display = 'flex';  // Fuerza mostrar el modal de nuevo
            return;  // Bloquea la acción
        }
        e.preventDefault();
        try {
            const id = productIdInput ? productIdInput.value : '';
            const name = productNameInput ? productNameInput.value.trim() : '';
            const price = productPriceInput ? parseFloat(productPriceInput.value) : 0;
            const cost = productCostInput ? parseFloat(productCostInput.value) : 0;
            if (!name || isNaN(price) || price <= 0 || isNaN(cost) || cost < 0) {
                showMessageModal('Por favor, ingresa un nombre, precio y costo de producción válidos.');
                return;
            }
            // Determinar si se lleva control de stock basado en el valor inicial
            const stockValue = productStockInput ? parseInt(productStockInput.value) || 0 : 0;
            const trackStock = stockValue > 0;
            const productData = {
                id: id || `product-${Date.now()}`,  // ID nuevo si es creación
                name,
                price,
                cost,
                stock: stockValue,
                description: productDescriptionInput ? productDescriptionInput.value.trim() : '',
                image: imagePreview ? imagePreview.src : defaultPlaceholder,
                categoryId: productCategorySelect ? productCategorySelect.value : '',
                trackStock: trackStock  // Nuevo campo
            };
            // NUEVO: Setea editingProductId con el ID final (nuevo o existente) antes de guardar ingredientes
            editingProductId = productData.id;
            await saveData(STORES.MENU, productData);
            // Invalidar caché de menú
            dataCache.menu = null;
            // Ahora sí: Si hay ingredientes y editingProductId válido, guarda
            if (currentIngredients.length > 0 && editingProductId) {
                await saveIngredients();
            }
            showMessageModal(`Producto "${name}" guardado.`);
            resetProductForm();
            renderProductManagement();
            renderMenu();
        } catch (error) {
            console.error('Error saving product:', error.message);
            showMessageModal(`Error al guardar producto: ${error.message}`);
        }
    };
    
    const deleteProduct = async (id) => {
        try {
            const item = await loadData(STORES.MENU, id);
            showMessageModal(`¿Seguro que quieres eliminar "${item.name}"?`, async () => {
                try {
                    await deleteData(STORES.MENU, id);
                    // Invalidar caché de menú
                    dataCache.menu = null;
                    // Eliminar los ingredientes asociados
                    try {
                        await deleteData(STORES.INGREDIENTS, id);
                    } catch (err) {
                        console.log('No ingredients to delete for this product');
                    }
                    order = order.filter(i => i.id !== id);
                    showMessageModal('Producto eliminado.');
                    renderProductManagement();
                    renderMenu();
                    updateOrderDisplay();
                } catch (error) {
                    console.error('Error deleting product:', error.message);
                    showMessageModal(`Error al eliminar producto: ${error.message}`);
                }
            });
        } catch (error) {
            console.error('Error loading product for deletion:', error.message);
            showMessageModal(`Error al cargar producto para eliminar: ${error.message}`);
        }
    };
    
    // --- INICIALIZACIÓN DE DATOS POR DEFECTO ---
    const initializeDefaultData = async () => {
        try {
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
    };
    
    // --- CARGA DIFERIDA DE MÓDULOS ---
    const loadDashboard = async () => {
        if (!dashboard) {
            dashboard = createDashboardModule({
                loadData,
                showMessageModal,
                deleteData,
                normalizeProducts,
                STORES
            });
        }
        return dashboard;
    };
    
    const loadBusinessTips = async () => {
        if (!businessTips) {
            businessTips = createBusinessTipsModule({
                loadData,
                showMessageModal,
                STORES
            });
        }
        return businessTips;
    };
    
    // --- FUNCIÓN PARA REVALIDAR LICENCIA EN SEGUNDO PLANO ---
    const revalidateLicenseInBackground = async (savedLicense) => {
        try {
            const validationResult = await Promise.race([
                window.revalidateLicense(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('License revalidation timeout')), 10000)
                )
            ]);
            
            if (validationResult && validationResult.valid) {
                console.log('Background revalidation successful:', validationResult);
                localStorage.setItem('lanzo_license', JSON.stringify(validationResult));
                renderLicenseInfo(validationResult);
            }
        } catch (error) {
            console.warn('License revalidation failed:', error.message);
            // No mostrar errores al usuario para no interrumpir su experiencia
        }
    };
    
    // --- EVENT LISTENERS ---
    if (document.getElementById('home-link')) document.getElementById('home-link').addEventListener('click', () => showSection('pos'));
    if (document.getElementById('nav-pos')) document.getElementById('nav-pos').addEventListener('click', () => showSection('pos'));
    if (document.getElementById('nav-product-management')) document.getElementById('nav-product-management').addEventListener('click', () => showSection('product-management'));
    if (document.getElementById('nav-dashboard')) document.getElementById('nav-dashboard').addEventListener('click', async () => {
        showSection('dashboard');
        const dashboardModule = await loadDashboard();
        if (dashboardModule) dashboardModule.renderDashboard();
    });
    if (document.getElementById('nav-company')) document.getElementById('nav-company').addEventListener('click', () => showSection('company'));
    if (document.getElementById('nav-donation')) document.getElementById('nav-donation').addEventListener('click', () => showSection('donation'));
    if (document.getElementById('mobile-nav-pos')) document.getElementById('mobile-nav-pos').addEventListener('click', () => showSection('pos'));
    if (document.getElementById('mobile-nav-product-management')) document.getElementById('mobile-nav-product-management').addEventListener('click', () => showSection('product-management'));
    if (document.getElementById('mobile-nav-dashboard')) document.getElementById('mobile-nav-dashboard').addEventListener('click', async () => {
        showSection('dashboard');
        const dashboardModule = await loadDashboard();
        if (dashboardModule) dashboardModule.renderDashboard();
    });
    if (document.getElementById('mobile-nav-company')) document.getElementById('mobile-nav-company').addEventListener('click', () => showSection('company'));
    if (document.getElementById('mobile-nav-donation')) document.getElementById('mobile-nav-donation').addEventListener('click', () => showSection('donation'));
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
    if (themeForm) themeForm.addEventListener('submit', saveThemeSettings);
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
    
    // --- CONTACT FORM ---
    const contactForm = document.getElementById('contact-form');
    const submitContactForm = async (e) => {
        if (!contactForm) return;
        e.preventDefault();
        const formData = new FormData(contactForm);
        try {
            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (result.success) {
                showMessageModal('¡Mensaje enviado con éxito! Nos pondremos en contacto pronto.');
                contactForm.reset();
            } else {
                showMessageModal('Error al enviar el mensaje: ' + (result.message || 'Por favor, intenta de nuevo.'));
            }
        } catch (error) {
            console.error('Error submitting contact form:', error.message);
            showMessageModal('Error al enviar el mensaje: ' + error.message);
        }
    };
    if (contactForm) contactForm.addEventListener('submit', submitContactForm);
    
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
    const initializeLicense = async () => {
        console.log('Initializing license...');
        let savedLicenseJSON = localStorage.getItem('lanzo_license');
        
        if (savedLicenseJSON) {
            try {
                const savedLicense = JSON.parse(savedLicenseJSON);
                console.log('Found saved license:', savedLicense);
                
                // Verificar si el usuario marcó "recordar" y no ha expirado el recordatorio local
                if (savedLicense.remembered && savedLicense.localExpiry && 
                    new Date(savedLicense.localExpiry) > new Date()) {
                    // Desbloquear sin verificar en línea
                    isAppUnlocked = true;
                    if (welcomeModal) welcomeModal.style.display = 'none';
                    renderLicenseInfo(savedLicense);
                    
                    // Revalidar en segundo plano
                    revalidateLicenseInBackground(savedLicense).catch(error => {
                        console.warn('Background license revalidation failed:', error.message);
                    });
                    
                    return { unlocked: true };
                }
                
                // Verificar si la licencia aún es válida (fecha de expiración)
                if (savedLicense.expires_at && new Date(savedLicense.expires_at) > new Date()) {
                    // Licencia válida - desbloquear aplicación inmediatamente
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
                    localStorage.removeItem('lanzo_license');
                    renderLicenseInfo({ valid: false });
                    isAppUnlocked = false;
                    if (welcomeModal) welcomeModal.style.display = 'flex';
                    return { unlocked: false };
                }
            } catch (parseError) {
                console.error('Could not parse saved license:', parseError.message);
                localStorage.removeItem('lanzo_license');
                renderLicenseInfo({ valid: false });
                isAppUnlocked = false;
                if (welcomeModal) welcomeModal.style.display = 'flex';
                return { unlocked: false };
            }
        } else {
            console.log('No saved license found.');
            renderLicenseInfo({ valid: false });
            isAppUnlocked = false;
            if (welcomeModal) welcomeModal.style.display = 'flex';
            return { unlocked: false };
        }
    };
    
    if (licenseForm) licenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const licenseKey = licenseKeyInput ? licenseKeyInput.value.trim() : '';
        const rememberDevice = rememberDeviceCheckbox ? rememberDeviceCheckbox.checked : false;
        
        if (!licenseKey) return showLicenseMessage('Por favor ingrese una clave de licencia válida', 'error');
        
        try {
            const activationResult = await activateLicense(licenseKey);
            if (activationResult.valid) {
                const licenseDataToStore = activationResult.details;
                
                // Si el usuario marcó "recordar", guardar con una fecha de expiración más lejana
                if (rememberDevice) {
                    licenseDataToStore.remembered = true;
                    // Extender la validez local por 30 días (aunque la licencia real pueda expirar antes)
                    licenseDataToStore.localExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
                }
                
                localStorage.setItem('lanzo_license', JSON.stringify(licenseDataToStore));
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
    }
    
    // --- INICIALIZACIÓN DE LA APLICACIÓN ---
    const initApp = async () => {
        try {
            // Mostrar pantalla de carga solo si el elemento existe
            if (loadingScreen) loadingScreen.style.display = 'flex';
            
            await initDB();
            
            // Ejecutar operaciones en paralelo
            const [licenseResult, defaultDataResult] = await Promise.all([
                initializeLicense(),
                initializeDefaultData()
            ]);
            
            // Inicializar los módulos después de que las dependencias estén listas
            // (carga diferida cuando se necesiten)
            
            await renderCategories(); // Cargar categorías al inicio
            
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
            
            // Lógica del buscador de productos
            const productSearchInput = document.getElementById('product-search-input');
            if (productSearchInput) {
                productSearchInput.addEventListener('input', (e) => {
                    renderProductManagement(e.target.value);
                });
            }

            // Delegación de eventos para la lista de productos
            if (productListContainer) {
                productListContainer.addEventListener('click', (e) => {
                    const button = e.target.closest('.edit-product-btn, .delete-product-btn');
                    if (!button) return;

                    const id = button.dataset.id;
                    if (button.classList.contains('edit-product-btn')) {
                        editProductForm(id);
                    } else if (button.classList.contains('delete-product-btn')) {
                        deleteProduct(id);
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
                            const businessTipsModule = await loadBusinessTips();
                            if (businessTipsModule) businessTipsModule.renderBusinessTips();
                        } else {
                            const dashboardModule = await loadDashboard();
                            if (dashboardModule) dashboardModule.renderDashboard();
                        }
                    }
                });
            }
            
            // Event listeners for navigation and main actions
            const mobileMenuButton = document.getElementById('mobile-menu-button');
            const mobileMenu = document.getElementById('mobile-menu');
            const backdrop = document.getElementById('backdrop');
            const toggleMenu = () => {
                if (mobileMenu) mobileMenu.classList.toggle('open');
                if (backdrop) backdrop.classList.toggle('open');
            };
            if (mobileMenuButton && mobileMenu && backdrop) {
                mobileMenuButton.addEventListener('click', toggleMenu);
                backdrop.addEventListener('click', toggleMenu);
            } else {
                console.error('app.js: Critical mobile menu elements not found!');
            }
            
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
    };
    
    initApp();
});