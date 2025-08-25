document.addEventListener('DOMContentLoaded', () => {
    // --- VARIABLES GLOBALES Y DATOS INICIALES ---
    let order = [];
    let db = null;
    const DB_NAME = 'LanzoDB1';
    const DB_VERSION = 3; // Incrementado para agregar almacenamiento de ingredientes
    const STORES = {
        MENU: 'menu',
        SALES: 'sales',
        COMPANY: 'company',
        THEME: 'theme',
        INGREDIENTS: 'ingredients' // Nuevo almacén para ingredientes
    };
    const initialMenu = [
        {
            id: 'burger-classic',
            name: 'Hamburguesa Clásica',
            price: 8.50,
            cost: 5.00,
            description: 'Carne 100% res, lechuga, tomate y salsa especial.',
            image: 'https://placehold.co/150x100/FFC107/000000?text=Clásica',
            ingredients: [] // Nuevo campo para ingredientes
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
            };
        });
    };

    // --- FUNCIONES DE ALMACENAMIENTO CON INDEXEDDB ---
    const saveData = (storeName, data) => {
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

    // Elementos para la calculadora de costos
    const costHelpButton = document.getElementById('cost-help-button');
    const costCalculationModal = document.getElementById('cost-calculation-modal');
    const ingredientNameInput = document.getElementById('ingredient-name');
    const ingredientCostInput = document.getElementById('ingredient-cost');
    const ingredientQuantityInput = document.getElementById('ingredient-quantity');
    const addIngredientButton = document.getElementById('add-ingredient');
    const ingredientListContainer = document.getElementById('ingredient-list');
    const ingredientTotalElement = document.getElementById('ingredient-total');
    const assignCostButton = document.getElementById('assign-cost');
    const closeCostModalButton = document.getElementById('close-cost-modal');

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
        costCalculationModal.classList.remove('hidden');
    };

    const closeCostCalculator = () => {
        costCalculationModal.classList.add('hidden');
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
        ingredientListContainer.innerHTML = '';

        if (currentIngredients.length === 0) {
            ingredientListContainer.innerHTML = '<p>No hay ingredientes agregados.</p>';
            ingredientTotalElement.textContent = 'Total: $0.00';
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

        ingredientTotalElement.textContent = `Total: $${total.toFixed(2)}`;
    };

    const assignCostToProduct = () => {
        const total = currentIngredients.reduce((sum, ing) => sum + (ing.cost * ing.quantity), 0);
        productCostInput.value = total.toFixed(2);
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

    // --- NAVEGACIÓN Y VISIBILIDAD ---
    const showSection = (sectionId) => {
        Object.values(sections).forEach(section => section.classList.remove('active'));
        document.getElementById(`${sectionId}-section`).classList.add('active');
        if (sectionId === 'pos') renderMenu();
        if (sectionId === 'product-management') renderProductManagement();
        if (sectionId === 'dashboard') renderDashboard();
        if (sectionId === 'company') renderCompanyData();
        document.getElementById('mobile-menu').classList.add('hidden');
    };

    // --- LÓGICA DE LA APLICACIÓN ---
    const showMessageModal = (message, onConfirm = null) => {
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
            let theme = await loadData(STORES.THEME, 'theme');
            if (!theme) {
                console.log('No theme data found, initializing with default');
                theme = { ...defaultTheme };
                await saveData(STORES.THEME, theme);
            }
            primaryColorInput.value = theme.primaryColor;
            secondaryColorInput.value = theme.secondaryColor;
            backgroundColorInput.value = theme.backgroundColor;
            cardBackgroundColorInput.value = theme.cardBackgroundColor;
            textColorInput.value = theme.textColor;
            cardTextColorInput.value = theme.cardTextColor;
            fontSizeSelect.value = theme.fontSize;
            layoutDensitySelect.value = theme.layoutDensity;
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
                primaryColor: primaryColorInput.value,
                secondaryColor: secondaryColorInput.value,
                backgroundColor: backgroundColorInput.value,
                cardBackgroundColor: cardBackgroundColorInput.value,
                textColor: textColorInput.value,
                cardTextColor: cardTextColorInput.value,
                fontSize: fontSizeSelect.value,
                layoutDensity: layoutDensitySelect.value
            };
            await saveData(STORES.THEME, themeData);
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
            primaryColorInput.value = defaultTheme.primaryColor;
            secondaryColorInput.value = defaultTheme.secondaryColor;
            backgroundColorInput.value = defaultTheme.backgroundColor;
            cardBackgroundColorInput.value = defaultTheme.cardBackgroundColor;
            textColorInput.value = defaultTheme.textColor;
            cardTextColorInput.value = defaultTheme.cardTextColor;
            fontSizeSelect.value = defaultTheme.fontSize;
            layoutDensitySelect.value = defaultTheme.layoutDensity;
            applyTheme(defaultTheme);
            showMessageModal('Tema restablecido a valores predeterminados.');
        } catch (error) {
            console.error('Error resetting theme:', error.message);
            showMessageModal(`Error al restablecer tema: ${error.message}`);
        }
    };

    const renderMenu = async () => {
        try {
            const menu = await loadData(STORES.MENU);
            menuItemsContainer.innerHTML = '';
            if (menu.length === 0) {
                menuItemsContainer.innerHTML = `<p class="empty-message">No hay productos.</p>`;
                return;
            }
            menu.forEach(item => {
                const menuItemDiv = document.createElement('div');
                menuItemDiv.className = 'menu-item';
                menuItemDiv.innerHTML = `
                            <img src="${item.image || defaultPlaceholder}" alt="${item.name}" onerror="this.onerror=null;this.src='${defaultPlaceholder}';">
                            <h3>${item.name}</h3>
                            <p>$${item.price.toFixed(2)}</p>
                        `;
                menuItemDiv.addEventListener('click', () => addItemToOrder(item));
                menuItemsContainer.appendChild(menuItemDiv);
            });
        } catch (error) {
            console.error('Error loading menu:', error.message);
            showMessageModal(`Error al cargar el menú: ${error.message}`);
        }
    };

    const addItemToOrder = (item) => {
        const existingItem = order.find(orderItem => orderItem.id === item.id);
        if (existingItem) existingItem.quantity++;
        else order.push({ ...item, quantity: 1 });
        updateOrderDisplay();
    };

    const updateOrderDisplay = () => {
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
        const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        posTotalSpan.textContent = `$${total.toFixed(2)}`;
    };

    const openPaymentProcess = () => {
        if (order.length === 0) {
            showMessageModal('El pedido está vacío.');
            return;
        }
        const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        paymentTotal.textContent = `$${total.toFixed(2)}`;
        paymentAmountInput.value = '';
        paymentChange.textContent = '$0.00';
        confirmPaymentBtn.disabled = true;
        paymentModal.classList.remove('hidden');
        paymentAmountInput.focus();
    };

    const processOrder = async () => {
        try {
            const total = order.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const sale = {
                timestamp: new Date().toISOString(),
                items: JSON.parse(JSON.stringify(order)),
                total
            };
            await saveData(STORES.SALES, sale);
            paymentModal.classList.add('hidden');
            showMessageModal('¡Pedido agregado exitosamente!');
            order = [];
            updateOrderDisplay();
            renderDashboard();
        } catch (error) {
            console.error('Error processing order:', error.message);
            showMessageModal(`Error al procesar el pedido: ${error.message}`);
        }
    };

    const deleteOrder = async (timestamp) => {
        showMessageModal('¿Estás seguro de que quieres borrar este pedido? Esta acción no se puede deshacer.', async () => {
            try {
                await deleteData(STORES.SALES, timestamp);
                renderDashboard();
                showMessageModal('Pedido eliminado.');
            } catch (error) {
                console.error('Error deleting order:', error.message);
                showMessageModal(`Error al eliminar el pedido: ${error.message}`);
            }
        });
    };

    const renderDashboard = async () => {
        try {
            const salesHistory = await loadData(STORES.SALES);
            const menu = await loadData(STORES.MENU);
            // Elementos DOM
            const dashboardTotalRevenue = document.getElementById('dashboard-total-revenue');
            const dashboardTotalOrders = document.getElementById('dashboard-total-orders');
            const dashboardTotalItems = document.getElementById('dashboard-total-items');
            const dashboardNetProfit = document.getElementById('dashboard-net-profit');
            const salesHistoryList = document.getElementById('sales-history-list');
            const emptySalesMessage = document.getElementById('empty-sales-message');
            // Crear un mapa de productos para búsqueda rápida
            const productMap = new Map();
            menu.forEach(product => {
                productMap.set(product.id, product);
            });
            // Ordenar ventas por timestamp descendente (más recientes primero)
            const sortedSales = salesHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            // Calcular estadísticas principales
            let totalRevenue = 0;
            let totalItemsSold = 0;
            let totalNetProfit = 0;
            const productStats = new Map(); // Para estadísticas de productos
            sortedSales.forEach(sale => {
                totalRevenue += sale.total;
                sale.items.forEach(item => {
                    totalItemsSold += item.quantity;
                    // Obtener datos del producto (con fallback mejorado)
                    const product = productMap.get(item.id) || {
                        price: item.price,
                        cost: item.cost || item.price * 0.6 // Asumir 40% de margen si no hay costo
                    };
                    const itemProfit = (item.price - product.cost) * item.quantity;
                    totalNetProfit += itemProfit;
                    // Acumular estadísticas de productos
                    if (!productStats.has(item.id)) {
                        productStats.set(item.id, {
                            name: item.name,
                            quantity: 0,
                            revenue: 0,
                            profit: 0
                        });
                    }
                    const stats = productStats.get(item.id);
                    stats.quantity += item.quantity;
                    stats.revenue += item.price * item.quantity;
                    stats.profit += itemProfit;
                });
            });
            // Actualizar estadísticas en el DOM
            dashboardTotalRevenue.textContent = `$${totalRevenue.toFixed(2)}`;
            dashboardTotalOrders.textContent = sortedSales.length;
            dashboardTotalItems.textContent = totalItemsSold;
            dashboardNetProfit.textContent = `$${totalNetProfit.toFixed(2)}`;
            // Mostrar historial de ventas
            salesHistoryList.innerHTML = '';
            emptySalesMessage.classList.toggle('hidden', sortedSales.length > 0);
            sortedSales.forEach((sale, index) => {
                // Calcular utilidad de esta venta específica
                const saleNetProfit = sale.items.reduce((sum, item) => {
                    const product = productMap.get(item.id) || {
                        price: item.price,
                        cost: item.cost || item.price * 0.6
                    };
                    return sum + (item.price - product.cost) * item.quantity;
                }, 0);
                const div = document.createElement('div');
                div.className = 'sale-item';
                div.innerHTML = `
                        <div class="sale-item-info">
                            <p>Pedido #${index + 1} - ${new Date(sale.timestamp).toLocaleString()}</p>
                            <p>Total: <span class="revenue">$${sale.total.toFixed(2)}</span></p>
                            <p>Utilidad: <span class="profit">$${saleNetProfit.toFixed(2)}</span></p>
                            <ul>
                                ${sale.items.map(item => {
                    const product = productMap.get(item.id) || {
                        price: item.price,
                        cost: item.cost || item.price * 0.6
                    };
                    const itemProfit = (item.price - product.cost) * item.quantity;
                    return `<li>${item.name} x ${item.quantity} (Utilidad: $${itemProfit.toFixed(2)})</li>`;
                }).join('')}
                            </ul>
                        </div>
                        <button class="delete-order-btn" data-timestamp="${sale.timestamp}">Eliminar</button>
                    `;
                salesHistoryList.appendChild(div);
            });
            // Event listeners para botones de eliminar
            salesHistoryList.querySelectorAll('.delete-order-btn').forEach(btn => {
                btn.addEventListener('click', (e) => deleteOrder(e.currentTarget.dataset.timestamp));
            });
            // Renderizar productos más vendidos (solo si existen los elementos)
            renderTopProducts(productStats, totalRevenue);
        } catch (error) {
            console.error('Error loading dashboard:', error.message);
            showMessageModal(`Error al cargar el panel de ventas: ${error.message}`);
        }
        renderBusinessTips();
    };

    // Función separada para manejar productos más vendidos
    const renderTopProducts = (productStats, totalRevenue) => {
        const topProductsSelect = document.getElementById('top-products-select');
        const topProductsList = document.getElementById('top-products-list');
        if (!topProductsSelect || !topProductsList) {
            console.log('Top products elements not found in DOM');
            return;
        }
        const updateTopProducts = (topN) => {
            // Convertir Map a array y ordenar por cantidad vendida
            const topProducts = Array.from(productStats.values())
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, topN);
            // Calcular porcentajes
            topProducts.forEach(product => {
                product.percentage = totalRevenue > 0
                    ? (product.revenue / totalRevenue * 100).toFixed(2)
                    : 0;
            });
            // Renderizar lista
            if (topProducts.length === 0) {
                topProductsList.innerHTML = '<li>No hay ventas registradas.</li>';
            } else {
                topProductsList.innerHTML = topProducts.map(p => `
                        <li>
                            <strong>${p.name}</strong>: ${p.quantity} unidades<br>
                            Ingresos: $${p.revenue.toFixed(2)}<br>
                            Margen de ganancias: $${p.profit.toFixed(2)}<br>
                            Porcentaje de ventas: ${p.percentage}%
                        </li>
                    `).join('');
            }
        };
        // Inicializar con valor por defecto
        const defaultTop = parseInt(topProductsSelect.value) || 5;
        updateTopProducts(defaultTop);
        // Event listener para cambios en el select
        topProductsSelect.addEventListener('change', (e) => {
            updateTopProducts(parseInt(e.target.value));
        });
    };

    // Función auxiliar para calcular utilidad de un item específico
    const calculateItemProfit = (item, productMap) => {
        const product = productMap.get(item.id) || {
            price: item.price,
            cost: item.cost || item.price * 0.6 // Asumir 40% de margen por defecto
        };
        return (item.price - product.cost) * item.quantity;
    };

    const renderBusinessTips = async () => {
        const tipsList = document.getElementById('business-tips');
        const sales = await loadData(STORES.SALES);
        const menu = await loadData(STORES.MENU);
        const tips = [];
        // Si no hay ventas, mostrar mensaje de inicio
        if (sales.length === 0) {
            tips.push(`
                    <li class="tip-intro">
                        <strong>🚀 ¡Hola emprendedor!</strong><br>
                        Soy tu asistente de negocios(limitado). Aún no tienes ventas registradas, 
                        pero eso está a punto de cambiar. Comienza registrando tus primeras ventas 
                        y te daré consejos personalizados que pueden incrementar tus ganancias hasta 
                        en un 30% desde la primera semana.
                    </li>
                `);
            tipsList.innerHTML = tips.join('');
            return;
        }
        // Análisis de datos
        const now = new Date();
        const last30Days = sales.filter(sale => {
            const saleDate = new Date(sale.timestamp);
            return (now - saleDate) / (1000 * 60 * 60 * 24) <= 30;
        });
        const last7Days = sales.filter(sale => {
            const saleDate = new Date(sale.timestamp);
            return (now - saleDate) / (1000 * 60 * 60 * 24) <= 7;
        });
        // Análisis de productos
        const productStats = {};
        const productMargins = {};
        let totalRevenue = 0;
        let totalProfit = 0;
        let totalItemsSold = 0;
        sales.forEach(sale => {
            totalRevenue += sale.total;
            sale.items.forEach(item => {
                const product = menu.find(p => p.id === item.id) || { cost: item.price * 0.6 };
                const itemProfit = (item.price - product.cost) * item.quantity;
                const itemRevenue = item.price * item.quantity;
                totalProfit += itemProfit;
                totalItemsSold += item.quantity;
                if (!productStats[item.id]) {
                    productStats[item.id] = {
                        name: item.name,
                        quantity: 0,
                        revenue: 0,
                        profit: 0,
                        avgPrice: item.price,
                        cost: product.cost || item.price * 0.6
                    };
                }
                productStats[item.id].quantity += item.quantity;
                productStats[item.id].revenue += itemRevenue;
                productStats[item.id].profit += itemProfit;
                // Calcular margen de ganancia
                const marginPercent = ((item.price - product.cost) / item.price * 100);
                productMargins[item.id] = {
                    name: item.name,
                    margin: marginPercent,
                    price: item.price,
                    cost: product.cost
                };
            });
        });
        // Análisis de patrones temporales
        const salesByHour = {};
        const salesByDay = {};
        const salesByDayOfWeek = {};
        sales.forEach(sale => {
            const date = new Date(sale.timestamp);
            const hour = date.getHours();
            const dayOfWeek = date.toLocaleDateString('es-ES', { weekday: 'long' });
            const dayKey = date.toLocaleDateString();
            salesByHour[hour] = (salesByHour[hour] || 0) + sale.total;
            salesByDay[dayKey] = (salesByDay[dayKey] || 0) + sale.total;
            salesByDayOfWeek[dayOfWeek] = (salesByDayOfWeek[dayOfWeek] || 0) + sale.total;
        });
        // Productos ordenados por diferentes métricas
        const topSellingProducts = Object.values(productStats).sort((a, b) => b.quantity - a.quantity);
        const topRevenueProducts = Object.values(productStats).sort((a, b) => b.revenue - a.revenue);
        const topProfitProducts = Object.values(productStats).sort((a, b) => b.profit - a.profit);
        const topMarginProducts = Object.values(productMargins).sort((a, b) => b.margin - a.margin);
        // Horas más productivas
        const bestHours = Object.entries(salesByHour)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        // Días más productivos
        const bestDays = Object.entries(salesByDayOfWeek)
            .sort((a, b) => b[1] - a[1]);
        // CONSEJOS PERSONALIZADOS CON ENFOQUE DE IA
        // 1. SALUDO PERSONALIZADO CON DATOS CLAVE
        const avgSaleValue = totalRevenue / sales.length;
        const profitMargin = (totalProfit / totalRevenue * 100);
        const daysInBusiness = Math.max(1, Math.ceil((new Date() - new Date(sales[0].timestamp)) / (1000 * 60 * 60 * 24)));
        const dailyAvgRevenue = totalRevenue / daysInBusiness;
        tips.push(`
                <li class="tip-intro">
                    <strong>🤖 HOLA, SOY TU ASESOR DE NEGOCIOS(LIMITADO)</strong><br>
                    He analizado tus ${sales.length} ventas de los últimos ${daysInBusiness} días y detecté 
                    <span class="highlight">$${totalRevenue.toFixed(2)} en ingresos</span> con un 
                    <span class="highlight">${profitMargin.toFixed(1)}% de margen neto</span>. 
                    Tu ticket promedio es de <span class="highlight">$${avgSaleValue.toFixed(2)}</span>.<br><br>
                    
                    <strong>ESTOS SON MIS 5 CONSEJOS ESTRATÉGICOS PARA TI:</strong>
                </li>
            `);
        // 2. PRODUCTO ESTRELLA CON RECOMENDACIÓN ESPECÍFICA
        if (topProfitProducts.length > 0) {
            const starProduct = topProfitProducts[0];
            const revenuePercent = (starProduct.revenue / totalRevenue * 100).toFixed(1);
            const validPrice = !isNaN(starProduct.price) && starProduct.price > 0;
            const potentialUpsell = validPrice ? (starProduct.price * 1.15).toFixed(2) : 'N/A';
            tips.push(`
                <li class="tip-star-product">
                    <strong>🎯 ESTRATEGIA #1: CAPITALIZA TU PRODUCTO ESTRELLA</strong><br>
                    "<span class="highlight">${starProduct.name}</span>" genera el ${revenuePercent}% de tus ganancias ($${starProduct.profit.toFixed(2)}).<br>
                    <strong>ACCIÓN INMEDIATA:</strong> 
                    <ul>
                        <li>${validPrice ? `Crea una versión premium a $${potentialUpsell} (añadiendo un ingrediente especial)` : 'Revisa el precio del producto para crear una versión premium'}</li>
                        <li>Entrena a tu equipo para sugerirlo sistemáticamente</li>
                        <li>Colócalo como primer elemento en tu menú/mostrador</li>
                    </ul>
                    <em>Impacto estimado: +${(starProduct.profit * 0.3).toFixed(2)} en ganancias semanales</em>
                </li>
            `);
        }
        // 3. ANÁLISIS DE MARGENES CON RECOMENDACIONES PRECISAS
        const lowMarginProducts = Object.values(productMargins)
            .filter(p => p.margin < 35)
            .sort((a, b) => a.margin - b.margin);
        if (lowMarginProducts.length > 0) {
            const worstMargin = lowMarginProducts[0];
            const recommendedPrice = (worstMargin.cost * 1.7).toFixed(2);
            const potentialIncrease = (recommendedPrice - worstMargin.price).toFixed(2);
            tips.push(`
                    <li class="tip-warning">
                        <strong>⚠️ ESTRATEGIA #2: CORRIGE MARGENES PELIGROSOS</strong><br>
                        "<span class="highlight">${worstMargin.name}</span>" tiene solo ${worstMargin.margin.toFixed(1)}% de margen 
                        (precio: $${worstMargin.price}, costo: $${worstMargin.cost.toFixed(2)}).<br>
                        <strong>ACCIÓN INMEDIATA:</strong> 
                        <ul>
                            <li>Aumenta el precio a $${recommendedPrice} (+$${potentialIncrease})</li>
                            <li>Si no puedes subir el precio, reduce porciones en un 15%</li>
                            <li>Busca proveedores alternativos para bajar costos</li>
                        </ul>
                        <em>Impacto estimado: +${((worstMargin.price * 0.3) * (productStats[worstMargin.name]?.quantity || 1)).toFixed(2)} por semana</em>
                    </li>
                `);
        }
        // 4. OPTIMIZACIÓN DE HORARIOS BASADA EN DATOS
        if (bestHours.length > 0) {
            const peakHour = bestHours[0][0];
            const peakRevenue = bestHours[0][1];
            const hourlyAvg = totalRevenue / Object.keys(salesByHour).length;
            const slowestHour = Object.entries(salesByHour)
                .sort((a, b) => a[1] - b[1])[0][0];
            if (peakRevenue > hourlyAvg * 1.5) {
                tips.push(`
                        <li class="tip-timing">
                            <strong>⏰ ESTRATEGIA #3: OPTIMIZA TUS HORARIOS INTELIGENTEMENTE</strong><br>
                            Entre las <span class="highlight">${peakHour}:00-${parseInt(peakHour) + 1}:00</span> generas 
                            $${peakRevenue.toFixed(2)} (${((peakRevenue / totalRevenue) * 100).toFixed(1)}% de tus ventas).<br>
                            <strong>ACCIÓN INMEDIATA:</strong> 
                            <ul>
                                <li>Programa promociones exclusivas para esta franja horaria</li>
                                <li>Asegura el doble de inventario preparado</li>
                                <li>Ofrece servicio express con 15% de recargo</li>
                                <li>Reduce personal en la hora más lenta (${slowestHour}:00)</li>
                            </ul>
                            <em>Impacto estimado: +${(peakRevenue * 0.25).toFixed(2)} semanales</em>
                        </li>
                    `);
            }
        }
        // 5. ESTRATEGIA DE UPSELL Y COMBOS
        const avgTicketTarget = avgSaleValue * 1.3;
        // Verificar que tengamos al menos 2 productos para hacer combos
        let comboExamples = "Producto + Complemento";
        let comboPrice = avgSaleValue.toFixed(2);
        if (topSellingProducts.length >= 2) {
            comboExamples = topSellingProducts.slice(0, 2).map(p => p.name).join(" + ");
            comboPrice = (topSellingProducts[0].avgPrice + (topSellingProducts[1].avgPrice || topSellingProducts[0].avgPrice) * 0.7).toFixed(2);
        } else if (topSellingProducts.length === 1) {
            comboExamples = topSellingProducts[0].name + " + Bebida/Postre";
            comboPrice = (topSellingProducts[0].avgPrice * 1.5).toFixed(2);
        }
        tips.push(`
            <li class="tip-upsell">
                <strong>📈 ESTRATEGIA #4: IMPLEMENTA VENTAS CRUZADAS ESTRATÉGICAS</strong><br>
                Tu ticket promedio actual es $${avgSaleValue.toFixed(2)}. Puedes llevarlo a $${avgTicketTarget.toFixed(2)}.<br>
                <strong>ACCIÓN INMEDIATA:</strong> 
                <ul>
                    <li>Crea el combo "${comboExamples}" por $${comboPrice} (ahorro de 15%)</li>
                    <li>Entrena equipo en la técnica "¿Desea agregar...?"</li>
                    <li>Implementa menú digital con sugerencias automáticas</li>
                    <li>Ofrece postre/bebida con 20% de descuento al comprar plato principal</li>
                </ul>
                <em>Impacto estimado: +${(avgTicketTarget - avgSaleValue).toFixed(2)} por transacción</em>
            </li>
        `);
        // 6. TENDENCIAS Y PROYECCIONES
        if (last30Days.length > 0 && last7Days.length > 0) {
            const last30Revenue = last30Days.reduce((sum, sale) => sum + sale.total, 0);
            const last7Revenue = last7Days.reduce((sum, sale) => sum + sale.total, 0);
            const weeklyRate = last7Revenue / 7;
            const monthlyRate = last30Revenue / 30;
            const growthRate = ((weeklyRate - monthlyRate) / monthlyRate * 100).toFixed(1);
            if (weeklyRate > monthlyRate * 1.15) {
                tips.push(`
                        <li class="tip-growth">
                            <strong>🚀 ESTRATEGIA #5: CAPITALIZA TU CRECIMIENTO ACELERADO</strong><br>
                            ¡Estás creciendo a un ritmo del ${growthRate}% semanal!<br>
                            <strong>ACCIÓN INMEDIATA:</strong> 
                            <ul>
                                <li>Incrementa inventario en un 25% para evitar desabastecimiento</li>
                                <li>Contrata personal adicional para las horas pico</li>
                                <li>Invierte en publicidad local dirigida (Facebook)</li>
                                <li>Considera expandir horario de atención</li>
                            </ul>
                            <em>Oportunidad: Puedes duplicar tus ingresos en ${(70 / growthRate).toFixed(1)} semanas</em>
                        </li>
                    `);
            } else if (weeklyRate < monthlyRate * 0.85) {
                tips.push(`
                        <li class="tip-decline">
                            <strong>📉 ESTRATEGIA #5: REACCIÓN ANÁLITICA ANTE CAÍDA DE VENTAS</strong><br>
                            Tus ventas han caído ${Math.abs(growthRate)}% esta semana.<br>
                            <strong>ACCIÓN INMEDIATA:</strong> 
                            <ul>
                                <li>Contacta a 10 clientes anteriores para conocer causas</li>
                                <li>Lanza promoción flash de 48 horas con 25% de descuento</li>
                                <li>Revisa precios de 3 competidores directos</li>
                            </ul>
                            <em>Urgencia: Cada día de caída te cuesta $${(monthlyRate - weeklyRate).toFixed(2)}</em>
                        </li>
                    `);
            }
        }
        // 7. PROYECCIÓN FINANCIERA
        const projectedMonthly = 8364; // Salario mínimo mensual
        const optimizedProjection = projectedMonthly * 1.2; // 20% de mejora con las estrategias
        tips.push(`
                <li class="tip-motivation">
                    <strong>🎯 VISIÓN ESTRATÉGICA: TU PRÓXIMO MES</strong><br>
                    Tu meta es alcanzar un ingreso mensual de <span class="highlight">$${projectedMonthly.toFixed(2)}</span>, equivalente al salario mínimo mensual. 
                    Aplicando estas 5 estrategias, puedes alcanzar 
                    <span class="highlight">$${optimizedProjection.toFixed(2)}</span> el próximo mes.<br><br>
                    
                    <strong>TU PLAN DE ACCIÓN PRIORITARIO:</strong>
                    <ol>
                        <li>Revisar márgenes y ajustar precios hoy mismo</li>
                        <li>Crear 2 combos estratégicos antes de mañana</li>
                        <li>Optimizar horarios de personal esta semana</li>
                        <li>Implementar técnicas de upsell con el equipo</li>
                        <li>Programar evaluación para dentro de 7 días</li>
                    </ol>
                    
                    <em>Recuerda: Yo reanalizaré tus datos cada vez que ingreses para darte consejos actualizados. 
                    ¡Tu éxito está en la ejecución consistente! si te preguntas por que 8364... me baso en el salario minimo mensual de tu region(chiapas)</em>
                </li>
            `);
        // Agregar estilos CSS para las clases de tips
        if (!document.getElementById('business-tips-styles')) {
            const style = document.createElement('style');
            style.id = 'business-tips-styles';
            style.textContent = `
                    .tip-intro { 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 20px; 
                        border-radius: 10px; 
                        margin-bottom: 15px; 
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-star-product { 
                        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
                        color: white; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-warning { 
                        background: linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%); 
                        color: #2d3748; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px; 
                        border-left: 5px solid #e53e3e;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-timing { 
                        background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); 
                        color: #2d3748; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-upsell { 
                        background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); 
                        color: white; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-growth { 
                        background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); 
                        color: #2d3748; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-decline { 
                        background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); 
                        color: #2d3748; 
                        padding: 18px; 
                        border-radius: 10px; 
                        margin-bottom: 12px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    .tip-motivation { 
                        background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); 
                        color: #2d3748; 
                        padding: 20px; 
                        border-radius: 10px; 
                        margin-bottom: 12px; 
                        border: 2px solid #f6ad55;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    #business-tips li { 
                        list-style: none; 
                        margin-bottom: 15px; 
                        transition: transform 0.3s ease;
                    }
                    #business-tips li:hover {
                        transform: translateY(-2px);
                    }
                    #business-tips strong { 
                        display: block; 
                        margin-bottom: 8px; 
                        font-size: 1.1em;
                    }
                    #business-tips .highlight {
                        background: rgba(255,255,255,0.2);
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-weight: bold;
                    }
                    #business-tips ul, #business-tips ol {
                        margin: 10px 0;
                        padding-left: 20px;
                    }
                    #business-tips li ul li, #business-tips li ol li {
                        margin-bottom: 5px;
                    }
                    #business-tips em {
                        display: block;
                        margin-top: 10px;
                        font-style: italic;
                        font-size: 0.9em;
                        opacity: 0.9;
                    }
                `;
            document.head.appendChild(style);
        }
        tipsList.innerHTML = tips.join('');
    };

    const renderCompanyData = async () => {
        try {
            let companyData = await loadData(STORES.COMPANY, 'company');
            if (!companyData) {
                console.log('No company data found, initializing with default');
                companyData = { id: 'company', name: 'Lanzo Negocio', phone: '', address: '', logo: '' };
                await saveData(STORES.COMPANY, companyData);
            }
            companyNameInput.value = companyData.name;
            companyPhoneInput.value = companyData.phone;
            companyAddressInput.value = companyData.address;
            const logoSrc = companyData.logo || 'https://placehold.co/100x100/FFFFFF/4A5568?text=LN';
            companyLogoPreview.src = logoSrc;
            navCompanyLogo.src = logoSrc;
            navCompanyName.textContent = companyData.name || 'POS';
            await renderThemeSettings();
        } catch (error) {
            console.error('Error loading company data:', error.message);
            showMessageModal(`Error al cargar datos de la empresa: ${error.message}`);
        }
    };

    const saveCompanyData = async (e) => {
        e.preventDefault();
        try {
            const companyData = {
                id: 'company',
                name: companyNameInput.value.trim(),
                phone: companyPhoneInput.value.trim(),
                address: companyAddressInput.value.trim(),
                logo: companyLogoPreview.src
            };
            await saveData(STORES.COMPANY, companyData);
            renderCompanyData();
            showMessageModal('Datos de la empresa guardados exitosamente.');
        } catch (error) {
            console.error('Error saving company data:', error.message);
            showMessageModal(`Error al guardar datos de la empresa: ${error.message}`);
        }
    };

    const renderProductManagement = async () => {
        try {
            const menu = await loadData(STORES.MENU);
            productListContainer.innerHTML = '';
            emptyProductMessage.classList.toggle('hidden', menu.length > 0);
            menu.forEach(item => {
                const div = document.createElement('div');
                div.className = 'product-item';
                div.innerHTML = `
                            <div class="product-item-info">
                                <img src="${item.image || defaultPlaceholder}" alt="${item.name}">
                                <div class="product-item-details">
                                    <span>${item.name}</span>
                                    <p>Precio: $${item.price.toFixed(2)}</p>
                                    <p>Costo: $${item.cost.toFixed(2)}</p>
                                </div>
                            </div>
                            <div class="product-item-controls">
                                <button class="edit-product-btn" data-id="${item.id}">✏️</button>
                                <button class="delete-product-btn" data-id="${item.id}">🗑️</button>
                            </div>`;
                productListContainer.appendChild(div);
            });
            productListContainer.querySelectorAll('.edit-product-btn').forEach(btn => btn.addEventListener('click', e => editProductForm(e.currentTarget.dataset.id)));
            productListContainer.querySelectorAll('.delete-product-btn').forEach(btn => btn.addEventListener('click', e => deleteProduct(e.currentTarget.dataset.id)));
        } catch (error) {
            console.error('Error loading product management:', error.message);
            showMessageModal(`Error al cargar la gestión de productos: ${error.message}`);
        }
    };

    const editProductForm = async (id) => {
        try {
            const item = await loadData(STORES.MENU, id);
            if (item) {
                productIdInput.value = item.id;
                productNameInput.value = item.name;
                productDescriptionInput.value = item.description || '';
                productPriceInput.value = item.price;
                productCostInput.value = item.cost || 0;
                imagePreview.src = item.image || defaultPlaceholder;
                productFormTitle.textContent = `Editar: ${item.name}`;
                cancelEditBtn.classList.remove('hidden');
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
        productForm.reset();
        productIdInput.value = '';
        productFormTitle.textContent = 'Añadir Nuevo Producto';
        cancelEditBtn.classList.add('hidden');
        imagePreview.src = defaultPlaceholder;
        productImageFileInput.value = null;
        productCostInput.value = '';

        // Limpiar ingredientes al resetear
        currentIngredients = [];
        editingProductId = null;
    };

    const saveProduct = async (e) => {
        e.preventDefault();
        try {
            const id = productIdInput.value;
            const name = productNameInput.value.trim();
            const price = parseFloat(productPriceInput.value);
            const cost = parseFloat(productCostInput.value);
            if (!name || isNaN(price) || price <= 0 || isNaN(cost) || cost < 0) {
                showMessageModal('Por favor, ingresa un nombre, precio y costo de producción válidos.');
                return;
            }
            const productData = {
                id: id || `product-${Date.now()}`,  // ID nuevo si es creación
                name,
                price,
                cost,
                description: productDescriptionInput.value.trim(),
                image: imagePreview.src
            };

            // NUEVO: Setea editingProductId con el ID final (nuevo o existente) antes de guardar ingredientes
            editingProductId = productData.id;

            await saveData(STORES.MENU, productData);

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
            const existingMenu = await loadData(STORES.MENU);
            if (existingMenu.length === 0) {
                console.log('Initializing default menu');
                await saveData(STORES.MENU, initialMenu);
            }
            if (!db.objectStoreNames.contains(STORES.COMPANY)) {
                console.error('Company store not found during initialization');
                throw new Error('Company store not found');
            }
            const existingCompany = await loadData(STORES.COMPANY, 'company');
            if (!existingCompany) {
                console.log('Initializing default company data');
                await saveData(STORES.COMPANY, { id: 'company', name: 'Lanzo Negocio', phone: '', address: '', logo: '' });
            }
            if (!db.objectStoreNames.contains(STORES.THEME)) {
                console.error('Theme store not found during initialization');
                throw new Error('Theme store not found');
            }
            const existingTheme = await loadData(STORES.THEME, 'theme');
            if (!existingTheme) {
                console.log('Initializing default theme');
                await saveData(STORES.THEME, defaultTheme);
            }
        } catch (error) {
            console.error('Error initializing default data:', error.message);
            throw error;
        }
    };

    // --- EVENT LISTENERS ---
    document.getElementById('home-link').addEventListener('click', () => showSection('pos'));
    document.getElementById('nav-pos').addEventListener('click', () => showSection('pos'));
    document.getElementById('nav-product-management').addEventListener('click', () => showSection('product-management'));
    document.getElementById('nav-dashboard').addEventListener('click', () => showSection('dashboard'));
    document.getElementById('nav-company').addEventListener('click', () => showSection('company'));
    document.getElementById('nav-donation').addEventListener('click', () => showSection('donation'));
    document.getElementById('mobile-menu-button').addEventListener('click', () => document.getElementById('mobile-menu').classList.toggle('hidden'));
    document.getElementById('mobile-nav-pos').addEventListener('click', () => showSection('pos'));
    document.getElementById('mobile-nav-product-management').addEventListener('click', () => showSection('product-management'));
    document.getElementById('mobile-nav-dashboard').addEventListener('click', () => showSection('dashboard'));
    document.getElementById('mobile-nav-company').addEventListener('click', () => showSection('company'));
    document.getElementById('mobile-nav-donation').addEventListener('click', () => showSection('donation'));
    document.getElementById('process-order-btn').addEventListener('click', openPaymentProcess);
    document.getElementById('clear-order-btn').addEventListener('click', () => {
        if (order.length > 0) {
            showMessageModal('¿Seguro que quieres limpiar el pedido?', () => {
                order = [];
                updateOrderDisplay();
            });
        }
    });
    paymentAmountInput.addEventListener('input', () => {
        const total = parseFloat(paymentTotal.textContent.replace('$', ''));
        const amountPaid = parseFloat(paymentAmountInput.value) || 0;
        const change = amountPaid - total;
        if (change >= 0) {
            paymentChange.textContent = `$${change.toFixed(2)}`;
            confirmPaymentBtn.disabled = false;
        } else {
            paymentChange.textContent = '$0.00';
            confirmPaymentBtn.disabled = true;
        }
    });
    confirmPaymentBtn.addEventListener('click', processOrder);
    document.getElementById('cancel-payment-btn').addEventListener('click', () => paymentModal.classList.add('hidden'));
    companyForm.addEventListener('submit', saveCompanyData);
    companyLogoFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                companyLogoPreview.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    productForm.addEventListener('submit', saveProduct);
    cancelEditBtn.addEventListener('click', resetProductForm);
    productImageFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                imagePreview.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    themeForm.addEventListener('submit', saveThemeSettings);
    resetThemeBtn.addEventListener('click', resetTheme);

    // Event listeners para la calculadora de costos
    costHelpButton.addEventListener('click', openCostCalculator);
    addIngredientButton.addEventListener('click', addIngredient);
    assignCostButton.addEventListener('click', assignCostToProduct);
    closeCostModalButton.addEventListener('click', closeCostCalculator);

    // Permitir agregar ingredientes con la tecla Enter
    ingredientNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });
    ingredientCostInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });
    ingredientQuantityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addIngredient();
        }
    });

    // --- CONTACT FORM ---
    const contactForm = document.getElementById('contact-form');
    const submitContactForm = async (e) => {
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
    contactForm.addEventListener('submit', submitContactForm);

    const welcomeModal = document.getElementById('welcome-modal');
    const licenseForm = document.getElementById('license-form');
    const licenseKeyInput = document.getElementById('license-key');
    const licenseMessage = document.getElementById('license-message');
    const licenseInfoContainer = document.getElementById('license-info-container');

    // Verificar si ya hay una licencia guardada
    let savedLicense = localStorage.getItem('lanzo_license');

    if (savedLicense) {
        try {
            savedLicense = JSON.parse(savedLicense);
            // Ocultar modal si la licencia es válida.
            // La validez aquí se basa en lo que se guardó la última vez.
            // La UI mostrará los datos guardados. Una verificación real podría hacerse aquí si se deseara.
            if (savedLicense.valid) {
                 welcomeModal.style.display = 'none';
                 renderLicenseInfo(savedLicense);
            } else {
                 welcomeModal.style.display = 'flex';
            }
        } catch (e) {
            console.error('Error parsing saved license:', e);
            localStorage.removeItem('lanzo_license'); // Clear corrupted data
            welcomeModal.style.display = 'flex';
        }
    } else {
        welcomeModal.style.display = 'flex';
    }

    // Manejar envío del formulario de licencia
    licenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const licenseKey = licenseKeyInput.value.trim();

        if (!licenseKey) {
            showLicenseMessage('Por favor ingrese una clave de licencia válida', 'error');
            return;
        }

        // Simular validación con Supabase
        try {
            const licenseData = await validateLicenseWithSupabase(licenseKey);

            if (licenseData.valid) {
                // Guardar licencia en localStorage
                localStorage.setItem('lanzo_license', JSON.stringify(licenseData));
                // Ocultar modal
                welcomeModal.style.display = 'none';
                // Mostrar información de la licencia
                renderLicenseInfo(licenseData);
                showLicenseMessage('Licencia validada correctamente. ¡Bienvenido!', 'success');
            } else {
                showLicenseMessage('Licencia no válida o expirada. Por favor verifique.', 'error');
            }
        } catch (error) {
            console.error('Error validating license:', error);
            showLicenseMessage('Error al conectar con el servidor de licencias. Intente nuevamente.', 'error');
        }
    });

    // Función mejorada para validar licencia con Supabase
    async function validateLicenseWithSupabase(licenseKey) {
        try {
            const supabaseUrl = 'https://lqnfkoorfaycapofnvlp.supabase.co';
            const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxbmZrb29yZmF5Y2Fwb2ZudmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNDYzODgsImV4cCI6MjA3MTYyMjM4OH0.uXkZfYGyE5n6lQWv9wM8iq6PGn2f4yhaEib9XiVgY7g';

            // OPCIÓN 1: Consulta directa a la tabla (requiere RLS configurado correctamente)
            console.log('Intentando consulta directa...');

            const directResponse = await fetch(`${supabaseUrl}/rest/v1/licenses?license_key=eq.${encodeURIComponent(licenseKey)}`, {
                method: 'GET',
                headers: {
                    'apikey': apiKey,
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                }
            });

            console.log('Status de consulta directa:', directResponse.status);

            if (directResponse.ok) {
                const data = await directResponse.json();
                console.log('Datos recibidos:', data);

                if (data.length === 0) {
                    return { valid: false, message: 'Licencia no encontrada' };
                }

                const license = data[0];
                const now = new Date();
                const expiresAt = new Date(license.expires_at);

                if (license.status === 'active' && expiresAt > now) {
                    return {
                        valid: true,
                        key: license.license_key,
                        type: license.license_type,
                        maxDevices: license.max_devices,
                        expiresAt: license.expires_at,
                        productName: license.product_name,
                        version: license.version,
                        features: license.features
                    };
                } else {
                    return {
                        valid: false,
                        message: license.status !== 'active' ? 'Licencia inactiva' : 'Licencia expirada'
                    };
                }
            }

            // OPCIÓN 2: Si la consulta directa falla, intentar con RPC
            console.log('Consulta directa falló, intentando RPC...');

            const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/validate_license`, {
                method: 'POST',
                headers: {
                    'apikey': apiKey,
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ license_key: licenseKey })
            });

            console.log('Status de RPC:', rpcResponse.status);

            if (rpcResponse.ok) {
                const result = await rpcResponse.json();
                console.log('Resultado RPC:', result);
                return result;
            }

            // OPCIÓN 3: Si todo falla, devolver información del error
            const errorText = await rpcResponse.text();
            console.error('Error completo:', errorText);

            return {
                valid: false,
                message: `Error ${rpcResponse.status}: ${errorText}`
            };

        } catch (error) {
            console.error('Error validando licencia:', error);
            return {
                valid: false,
                message: `Error de conexión: ${error.message}`
            };
        }
    }

    // Función para mostrar mensajes de licencia
    function showLicenseMessage(message, type) {
        licenseMessage.textContent = message;
        licenseMessage.style.display = 'block';
        licenseMessage.style.color = type === 'error' ? '#dc3545' : '#198754';

        // Ocultar mensaje después de 5 segundos
        setTimeout(() => {
            licenseMessage.style.display = 'none';
        }, 5000);
    }

    // Función para renderizar la información de la licencia
    function renderLicenseInfo(licenseData) {
        if (!licenseData.valid) {
            licenseInfoContainer.innerHTML = `
                        <p>No hay una licencia activa. <a href="#" id="show-license-modal">Ingresar licencia</a></p>
                    `;

            document.getElementById('show-license-modal').addEventListener('click', (e) => {
                e.preventDefault();
                welcomeModal.style.display = 'flex';
            });

            return;
        }

        const expiresDate = new Date(licenseData.expiresAt).toLocaleDateString();
        const statusClass = new Date(licenseData.expiresAt) > new Date() ?
            'license-status-active' : 'license-status-expired';
        const statusText = new Date(licenseData.expiresAt) > new Date() ?
            'Activa' : 'Expirada';

        licenseInfoContainer.innerHTML = `
                    <div class="license-detail">
                        <span class="license-label">Producto:</span>
                        <span class="license-value">${licenseData.productName || 'Lanzo Negocio'} v${licenseData.version || '1.0'}</span>
                    </div>
                    <div class="license-detail">
                        <span class="license-label">Tipo de licencia:</span>
                        <span class="license-value">${licenseData.type || 'Standard'}</span>
                    </div>
                    <div class="license-detail">
                        <span class="license-label">Dispositivos:</span>
                        <span class="license-value">${licenseData.maxDevices || 1} dispositivo(s)</span>
                    </div>
                    <div class="license-detail">
                        <span class="license-label">Estado:</span>
                        <span class="license-value ${statusClass}">${statusText}</span>
                    </div>
                    <div class="license-detail">
                        <span class="license-label">Expira:</span>
                        <span class="license-value">${expiresDate}</span>
                    </div>
                    <div class="license-detail">
                        <span class="license-label">Clave de licencia:</span>
                        <span class="license-value">${licenseData.key}</span>
                    </div>
                `;
    }

    // Cargar información de licencia al inicio si existe
    if (savedLicense) {
        try {
            const licenseData = JSON.parse(savedLicense);
            renderLicenseInfo(licenseData);
        } catch (e) {
            console.error('Error parsing saved license:', e);
        }
    } else {
        renderLicenseInfo({ valid: false });
    }

    // --- INICIALIZACIÓN DE LA APLICACIÓN ---
    const initApp = async () => {
        try {
            await initDB();
            await initializeDefaultData();
            renderCompanyData();
            showSection('pos');
        } catch (error) {
            console.error('Error initializing application:', error.message);
            showMessageModal(`Error al inicializar la aplicación: ${error.message}. Por favor, recarga la página.`);
        }
    };
    initApp();
});