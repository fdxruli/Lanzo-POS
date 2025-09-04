// customers.js

export function initCustomersModule(dependencies) {
    const { saveData, loadData, deleteData, showMessageModal, STORES } = dependencies;

    // --- ELEMENTOS DEL DOM ---
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

    // --- ESTADO DEL MÓDULO ---
    let customers = [];
    let editingCustomerId = null;

    // --- FUNCIONES ---
    async function showPurchaseHistory(customerId) {
        const customer = customers.find(c => c.id === customerId);
        if (!customer) return;

        const sales = await loadData(STORES.SALES) || [];
        const customerSales = sales.filter(sale => sale.customerId === customerId)
                                   .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        customerHistoryName.textContent = customer.name;

        const totalSales = customerSales.length;
        const totalValue = customerSales.reduce((sum, sale) => sum + sale.total, 0);
        const average = totalSales > 0 ? totalValue / totalSales : 0;

        totalPurchases.textContent = totalSales;
        totalAmount.textContent = `$${totalValue.toFixed(2)}`;
        averagePurchase.textContent = `$${average.toFixed(2)}`;

        purchaseHistoryList.innerHTML = '';
        if (customerSales.length === 0) {
            purchaseHistoryList.innerHTML = '<p class="empty-message">No hay compras registradas.</p>';
        } else {
            customerSales.forEach(sale => {
                const saleElement = document.createElement('div');
                saleElement.className = 'purchase-history-item';
                saleElement.innerHTML = `
                    <div class="purchase-history-item-header">
                        <div class="purchase-date">${new Date(sale.timestamp).toLocaleString('es-ES')}</div>
                        <div class="purchase-total">$${sale.total.toFixed(2)}</div>
                        <button class="btn btn-details" type="button">Detalles</button>
                    </div>
                    <ul class="purchase-items-container hidden">
                        ${sale.items.map(item => `
                            <li class="purchase-item">
                                <span class="purchase-item-name">${item.name}</span>
                                <span class="purchase-item-quantity">x${item.quantity}</span>
                                <span class="purchase-item-price">$${(item.price * item.quantity).toFixed(2)}</span>
                            </li>
                        `).join('')}
                    </ul>
                `;
                purchaseHistoryList.appendChild(saleElement);
            });
        }
        purchaseHistoryModal.classList.remove('hidden');
    }

    async function loadAndRenderCustomers() {
        customers = await loadData(STORES.CUSTOMERS);
        renderCustomerList();
    }

    const renderCustomerList = (filteredCustomers = customers) => {
        if (!customerList) return;
        customerList.innerHTML = '';
        emptyCustomerMessage.classList.toggle('hidden', filteredCustomers.length === 0);

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

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        try {
            const customerData = {
                id: editingCustomerId || `customer-${Date.now()}`,
                name: document.getElementById('customer-name').value,
                phone: document.getElementById('customer-phone').value,
                address: document.getElementById('customer-address').value
            };

            await saveData(STORES.CUSTOMERS, customerData);
            showMessageModal('Cliente guardado exitosamente');
            resetCustomerForm();
            await loadAndRenderCustomers(); // Recargar y renderizar
        } catch (error) {
            console.error('Error al guardar el cliente:', error);
            showMessageModal('Error al guardar el cliente. Por favor, intente nuevamente.');
        }
    };
    
    const resetCustomerForm = () => {
        editingCustomerId = null;
        customerForm.reset();
        document.getElementById('customer-form-title').textContent = 'Añadir Nuevo Cliente';
        cancelCustomerEditBtn.classList.add('hidden');
    }

    // --- EVENT LISTENERS ---

    customerForm?.addEventListener('submit', handleFormSubmit);

    customerSearchInput?.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filtered = customers.filter(c => 
            c.name.toLowerCase().includes(searchTerm) || c.phone.includes(searchTerm)
        );
        renderCustomerList(filtered);
    });

    customerList?.addEventListener('click', async (e) => {
        const button = e.target.closest('button[data-id]');
        if (!button) return;

        const customerId = button.dataset.id;
        const customer = customers.find(c => c.id === customerId);

        if (button.classList.contains('btn-edit')) {
            document.getElementById('customer-name').value = customer.name;
            document.getElementById('customer-phone').value = customer.phone;
            document.getElementById('customer-address').value = customer.address;
            document.getElementById('customer-form-title').textContent = `Editar: ${customer.name}`;
            editingCustomerId = customerId;
            cancelCustomerEditBtn.classList.remove('hidden');
            customerTabs.querySelector('[data-tab="add-customer"]').click();
        } else if (button.classList.contains('btn-delete')) {
            showMessageModal(`¿Estás seguro de que deseas eliminar a ${customer.name}?`, async () => {
                await deleteData(STORES.CUSTOMERS, customerId);
                await loadAndRenderCustomers();
                showMessageModal('Cliente eliminado exitosamente');
            });
        } else if (button.classList.contains('btn-history')) {
            await showPurchaseHistory(customerId);
        }
    });

    closeHistoryModalBtn?.addEventListener('click', () => purchaseHistoryModal.classList.add('hidden'));
    
    purchaseHistoryList?.addEventListener('click', e => {
        if (e.target.classList.contains('btn-details')) {
            const itemsContainer = e.target.closest('.purchase-history-item').querySelector('.purchase-items-container');
            itemsContainer?.classList.toggle('hidden');
            e.target.textContent = itemsContainer.classList.contains('hidden') ? 'Detalles' : 'Ocultar';
        }
    });
    
    cancelCustomerEditBtn?.addEventListener('click', resetCustomerForm);

    customerTabs?.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn')) {
            const tabId = e.target.dataset.tab;
            customerTabs.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            
            addCustomerContent.classList.toggle('active', tabId === 'add-customer');
            viewCustomersContent.classList.toggle('active', tabId === 'view-customers');
        }
    });

    // --- INICIALIZACIÓN DEL MÓDULO ---
    loadAndRenderCustomers();
}