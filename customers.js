export function initCustomersModule(dependencies) {
    const { saveData, loadData, deleteData, showMessageModal, STORES } = dependencies;

    const customerForm = document.getElementById('customer-form');
    const customerList = document.getElementById('customer-list');
    const customerSearchInput = document.getElementById('customer-search-input');
    const emptyCustomerMessage = document.getElementById('empty-customer-message');
    const cancelCustomerEditBtn = document.getElementById('cancel-customer-edit-btn');
    const customerTabs = document.getElementById('customers-tabs');
    const addCustomerContent = document.getElementById('add-customer-content');
    const viewCustomersContent = document.getElementById('view-customers-content');
    const purchaseHistoryModal = document.getElementById('purchase-history-modal');
    const closeHistoryModalBtn = document.getElementById('close-history-modal-btn');
    const customerHistoryName = document.getElementById('customer-history-name').querySelector('span');
    const purchaseHistoryList = document.getElementById('purchase-history-list');
    const totalPurchases = document.getElementById('total-purchases');
    const totalAmount = document.getElementById('total-amount');
    const averagePurchase = document.getElementById('average-purchase');
    const saleCustomerInput = document.getElementById('sale-customer');
    const saleCustomerResults = document.getElementById('sale-customer-results');
    const saleCustomerDatalist = document.getElementById('sale-customer-options');

    let customers = [];
    let editingCustomerId = null;
    
    async function showPurchaseHistory(customerId) {
        const customer = customers.find(c => c.id === customerId);
        if (!customer) return;

        const sales = await loadData(STORES.SALES) || [];
        const customerSales = sales.filter(sale => sale.customerId === customerId);

        // Actualizar el nombre del cliente en el modal
        customerHistoryName.textContent = customer.name;

        // Calcular estadísticas
        const totalSales = customerSales.length;
        const total = customerSales.reduce((sum, sale) => sum + sale.total, 0);
        const average = totalSales > 0 ? total / totalSales : 0;

        // Actualizar estadísticas en el modal
        totalPurchases.textContent = totalSales;
        totalAmount.textContent = `$${total.toFixed(2)}`;
        averagePurchase.textContent = `$${average.toFixed(2)}`;

        // Mostrar el historial de compras
        purchaseHistoryList.innerHTML = '';
        if (customerSales.length === 0) {
            purchaseHistoryList.innerHTML = '<p class="empty-message">No hay compras registradas.</p>';
        } else {
            customerSales.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Ordenar por fecha, más reciente primero
            customerSales.forEach(sale => {
                const saleDate = new Date(sale.timestamp).toLocaleString('es-ES');
                const saleElement = document.createElement('div');
                saleElement.className = 'purchase-history-item';
                saleElement.innerHTML = `
                    <div class="purchase-history-item-header">
                        <div class="purchase-date">${saleDate}</div>
                        <div class="purchase-total">${sale.total.toFixed(2)}</div>
                        <button class="btn btn-details" type="button">Detalles</button>
                    </div>
                    <div class="purchase-items-container hidden">
                        <div class="purchase-items">
                            ${sale.items.map(item => `
                                <div class="purchase-item">
                                    <span class="purchase-item-name">${item.name}</span>
                                    <span class="purchase-item-quantity">x${item.quantity}</span>
                                    <span class="purchase-item-price">$${item.price.toFixed(2)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                purchaseHistoryList.appendChild(saleElement);
            });
        }

        // Mostrar el modal
        purchaseHistoryModal.classList.remove('hidden');
    }

    async function loadCustomers() {
        customers = await loadData(STORES.CUSTOMERS);
        renderCustomerList();
    }

    const renderCustomerList = (filteredCustomers = customers) => {
        if (!customerList) return;
        customerList.innerHTML = '';
        emptyCustomerMessage.classList.toggle('hidden', filteredCustomers.length > 0);

        filteredCustomers.forEach(customer => {
            const customerCard = document.createElement('div');
            customerCard.className = 'customer-card';
            customerCard.innerHTML = `
                <div class="customer-info">
                    <h4>${customer.name}</h4>
                    <p><strong>Teléfono:</strong> ${customer.phone}</p>
                    <p><strong>Dirección:</strong> ${customer.address}</p>
                </div>
                <div class="customer-actions">
                    <button class="btn btn-edit" data-id="${customer.id}">Editar</button>
                    <button class="btn btn-delete" data-id="${customer.id}">Eliminar</button>
                    <button class="btn btn-history" data-id="${customer.id}">Ver Historial</button>
                </div>
            `;
            customerList.appendChild(customerCard);
        });
    };

    // Asegurarse de que el formulario existe antes de agregar el evento
    customerForm?.addEventListener('submit', async (e) => {
        // Prevenir el comportamiento por defecto del formulario
        e.preventDefault();
        
        try {
            const customerId = editingCustomerId || Date.now().toString();
            const customerData = {
                id: customerId,
                name: document.getElementById('customer-name').value,
                phone: document.getElementById('customer-phone').value,
                address: document.getElementById('customer-address').value
            };

            await saveData(STORES.CUSTOMERS, customerData);

            if (editingCustomerId) {
                const index = customers.findIndex(c => c.id === editingCustomerId);
                if (index !== -1) {
                    customers[index] = customerData;
                }
                editingCustomerId = null;
                cancelCustomerEditBtn.classList.add('hidden');
            } else {
                customers.push(customerData);
            }

            showMessageModal('Cliente guardado exitosamente');
            customerForm.reset();
            renderCustomerList();
        } catch (error) {
            console.error('Error al guardar el cliente:', error);
            showMessageModal('Error al guardar el cliente. Por favor, intente nuevamente.');
        }
    });

    if (customerSearchInput) {
        customerSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredCustomers = customers.filter(customer => 
                customer.name.toLowerCase().includes(searchTerm) ||
                customer.phone.includes(searchTerm)
            );
            renderCustomerList(filteredCustomers);
        });
    }

    if (customerList) {
        customerList.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const customerId = button.dataset.id;
            const customer = customers.find(c => c.id === customerId);

            if (button.classList.contains('btn-edit')) {
                document.getElementById('customer-name').value = customer.name;
                document.getElementById('customer-phone').value = customer.phone;
                document.getElementById('customer-address').value = customer.address;
                editingCustomerId = customerId;
                cancelCustomerEditBtn.classList.remove('hidden');
                
                document.querySelector('[data-tab="add-customer"]').click();
            } else if (button.classList.contains('btn-delete')) {
                showMessageModal(`¿Estás seguro de que deseas eliminar a ${customer.name}?`, async () => {
                    await deleteData(STORES.CUSTOMERS, customerId);
                    customers = customers.filter(c => c.id !== customerId);
                    renderCustomerList();
                    showMessageModal('Cliente eliminado exitosamente');
                });
            } else if (button.classList.contains('btn-history')) {
                await showPurchaseHistory(customerId);
            }
        });
    }

    // Event listener para cerrar el modal de historial
    if (closeHistoryModalBtn) {
        closeHistoryModalBtn.addEventListener('click', () => {
            purchaseHistoryModal.classList.add('hidden');
        });
    }

    if (purchaseHistoryList) {
        purchaseHistoryList.addEventListener('click', e => {
            if (e.target.classList.contains('btn-details')) {
                const itemsContainer = e.target.closest('.purchase-history-item').querySelector('.purchase-items-container');
                if (itemsContainer) {
                    itemsContainer.classList.toggle('hidden');
                    e.target.textContent = itemsContainer.classList.contains('hidden') ? 'Detalles' : 'Ocultar';
                }
            }
        });
    }

    if (cancelCustomerEditBtn) {
        cancelCustomerEditBtn.addEventListener('click', () => {
            editingCustomerId = null;
            customerForm.reset();
            cancelCustomerEditBtn.classList.add('hidden');
        });
    }

    if (customerTabs) {
        customerTabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                const tabId = e.target.dataset.tab;
                
                document.querySelectorAll('#customers-tabs .tab-btn').forEach(btn => {
                    btn.classList.toggle('active', btn === e.target);
                });

                addCustomerContent.classList.toggle('active', tabId === 'add-customer');
                viewCustomersContent.classList.toggle('active', tabId === 'view-customers');
            }
        });
    }

    if (saleCustomerInput) {
        saleCustomerInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredCustomers = customers.filter(customer => 
                customer.name.toLowerCase().includes(searchTerm) ||
                customer.phone.includes(searchTerm)
            );

            saleCustomerResults.innerHTML = '';
            if (filteredCustomers.length > 0) {
                filteredCustomers.forEach(customer => {
                    const li = document.createElement('li');
                    li.textContent = `${customer.name} (${customer.phone})`;
                    li.classList.add('search-result-item');
                    li.addEventListener('click', () => {
                        saleCustomerInput.value = customer.name;
                        saleCustomerResults.innerHTML = '';
                    });
                    saleCustomerResults.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = 'No se encontraron resultados';
                li.classList.add('search-result-item');
                saleCustomerResults.appendChild(li);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM completamente cargado y analizado.');

        const saleCustomerDatalist = document.getElementById('sale-customer-options');

        if (!saleCustomerDatalist) {
            console.error('El elemento sale-customer-options no se encuentra en el DOM. Verifica el HTML.');
            return;
        }

        function updateCustomerDatalist() {
            console.log('Actualizando el datalist de clientes.');
            saleCustomerDatalist.innerHTML = '';
            customers.forEach(customer => {
                const option = document.createElement('option');
                option.value = customer.name;
                option.textContent = `${customer.name} (${customer.phone})`;
                saleCustomerDatalist.appendChild(option);
            });
        }

        // Llenar el datalist al cargar los clientes
        loadCustomers().then(() => {
            console.log('Clientes cargados:', customers);
            updateCustomerDatalist();
        });
    });

    // Llamar a loadCustomers para cargar los clientes al inicializar el módulo
    loadCustomers();
}

document.addEventListener('DOMContentLoaded', () => {
    const customerInput = document.getElementById('sale-customer');
    const customerResults = document.getElementById('sale-customer-results');

    // Lista de clientes simulada (esto debería venir de tu base de datos o backend)
    const customers = [
        'Juan Pérez',
        'María López',
        'Carlos García',
        'Ana Martínez',
        'Luis Hernández'
    ];

    // Función para mostrar resultados filtrados
    function filterCustomers(query) {
        const filtered = customers.filter(customer => 
            customer.toLowerCase().includes(query.toLowerCase())
        );

        customerResults.innerHTML = ''; // Limpiar resultados previos

        if (filtered.length > 0) {
            filtered.forEach(customer => {
                const div = document.createElement('div');
                div.textContent = customer;
                div.classList.add('result-item');
                div.addEventListener('click', () => {
                    customerInput.value = customer;
                    customerResults.classList.add('hidden');
                });
                customerResults.appendChild(div);
            });
            customerResults.classList.remove('hidden');
        } else {
            customerResults.classList.add('hidden');
        }
    }

    // Mostrar resultados al enfocar el campo
    customerInput.addEventListener('focus', () => {
        if (customerInput.value.trim() !== '') {
            filterCustomers(customerInput.value);
        }
    });

    // Filtrar resultados mientras se escribe
    customerInput.addEventListener('input', () => {
        filterCustomers(customerInput.value);
    });

    // Ocultar resultados al hacer clic fuera del campo
    document.addEventListener('click', (event) => {
        if (!customerInput.contains(event.target) && !customerResults.contains(event.target)) {
            customerResults.classList.add('hidden');
        }
    });
});