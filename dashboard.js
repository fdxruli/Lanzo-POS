import { showMessageModal } from './utils.js';
// Función factory que crea el módulo del dashboard con sus dependencias
function createDashboardModule(dependencies) {
    const {
        loadData,
        deleteData,
        saveData,
        normalizeProducts,
        STORES,
        renderMenu // ¡Nueva dependencia!
    } = dependencies;

    // --- NUEVO: Modal de confirmación avanzado ---
    function showAdvancedConfirmModal(message, options) {
        // Crear el contenedor del modal
        const modalContainer = document.createElement('div');
        modalContainer.className = 'modal';
        modalContainer.style.display = 'flex';

        // Crear el contenido del modal
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        // Título y mensaje
        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Confirmación';
        const text = document.createElement('p');
        text.className = 'modal-message';
        text.textContent = message;

        // Contenedor de botones
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'modal-buttons'; // Usar una clase para estilizar los botones

        // Función para cerrar el modal
        const closeModal = () => {
            document.body.removeChild(modalContainer);
        };

        // Crear botones dinámicamente
        options.forEach(opt => {
            const button = document.createElement('button');
            button.textContent = opt.text;
            button.className = opt.class; // Asignar clases para estilizar
            button.addEventListener('click', () => {
                if (opt.action) {
                    opt.action();
                }
                closeModal();
            });
            buttonsContainer.appendChild(button);
        });

        // Ensamblar el modal
        modalContent.appendChild(title);
        modalContent.appendChild(text);
        modalContent.appendChild(buttonsContainer);
        modalContainer.appendChild(modalContent);

        // Añadir el modal al body
        document.body.appendChild(modalContainer);
    }


    // Función principal para renderizar el dashboard
    async function renderDashboard() {
        try {
            let menu = await loadData(STORES.MENU);
            menu = normalizeProducts(menu);
            const salesHistory = await loadData(STORES.SALES);

            // Elementos DOM
            const dashboardTotalRevenue = document.getElementById('dashboard-total-revenue');
            const dashboardTotalOrders = document.getElementById('dashboard-total-orders');
            const dashboardTotalItems = document.getElementById('dashboard-total-items');
            const dashboardNetProfit = document.getElementById('dashboard-net-profit');
            const dashboardInventoryValue = document.getElementById('dashboard-inventory-value');
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
                    const product = productMap.get(item.id) || {
                        price: item.price,
                        cost: item.cost || item.price * 0.6 // Asumir 40% de margen si no hay costo
                    };
                    const itemProfit = (item.price - product.cost) * item.quantity;
                    totalNetProfit += itemProfit;

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

            const inventoryValue = menu.reduce((total, product) => {
                if (product.trackStock) {
                    return total + (product.cost * product.stock);
                }
                return total;
            }, 0);
            dashboardInventoryValue.textContent = `$${inventoryValue.toFixed(2)}`;

            // Mostrar historial de ventas
            salesHistoryList.innerHTML = '';
            emptySalesMessage.classList.toggle('hidden', sortedSales.length > 0);
            sortedSales.forEach((sale, index) => {
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
                            const product = productMap.get(item.id) || { price: item.price, cost: item.cost || item.price * 0.6 };
                            const itemProfit = (item.price - product.cost) * item.quantity;
                            return `<li>${item.name} x ${item.quantity} (Utilidad: $${itemProfit.toFixed(2)})</li>`;
                        }).join('')}
                    </ul>
                </div>
                <button class="delete-order-btn" data-timestamp="${sale.timestamp}">Eliminar</button>
            `;
                salesHistoryList.appendChild(div);
            });

            salesHistoryList.querySelectorAll('.delete-order-btn').forEach(btn => {
                btn.addEventListener('click', (e) => deleteOrder(e.currentTarget.dataset.timestamp));
            });

            renderTopProducts(productStats, totalRevenue);
        } catch (error) {
            console.error('Error loading dashboard:', error.message);
            showMessageModal(`Error al cargar el panel de ventas: ${error.message}`);
        }
        await renderMovementHistory();
    }

    // --- FUNCIÓN PARA ELIMINAR PEDIDOS (MODIFICADA) ---
    async function deleteOrder(timestamp) {
        try {
            const saleToDelete = await loadData(STORES.SALES, timestamp);
            if (!saleToDelete) {
                showMessageModal('Error: No se encontró el pedido.');
                return;
            }

            // Usamos el modal de confirmación
            showMessageModal(
                '¿Seguro que quieres eliminar este pedido? Se moverá a la papelera y el stock de los productos será restaurado.',
                async () => {
                    try {
                        // a. Restaurar el stock de los productos
                        for (const item of saleToDelete.items) {
                            if (item.trackStock) {
                                const product = await loadData(STORES.MENU, item.id);
                                if (product) {
                                    // Usamos stockDeducted para devolver la cantidad exacta que se restó
                                    const stockToReturn = item.stockDeducted !== undefined ? item.stockDeducted : item.quantity;
                                    product.stock += stockToReturn;
                                    await saveData(STORES.MENU, product);
                                }
                            }
                        }
                        
                        // b. Mover el pedido a la papelera
                        saleToDelete.deletedTimestamp = new Date().toISOString();
                        await saveData(STORES.DELETED_SALES, saleToDelete);
                        await deleteData(STORES.SALES, timestamp);

                        showMessageModal('Pedido movido a la papelera y stock restaurado.');
                        renderDashboard(); // Actualizar la vista del dashboard
                        if (renderMenu) renderMenu(); // Actualizar el menú del TPV
                    } catch (error) {
                        console.error('Error moving sale to deleted store:', error);
                        showMessageModal('Error al mover el pedido a la papelera.');
                    }
                }
            );
        } catch (error) {
            console.error('Error preparing to delete order:', error);
            showMessageModal('Error al obtener los datos del pedido para eliminar.');
        }
    }
    //funcion para restaurar pedidos:
    async function restoreSale(timestamp) {
        try {
            const saleToRestore = await loadData(STORES.DELETED_SALES, timestamp);
            if (!saleToRestore) {
                showMessageModal('Error: El pedido no se encontró en la papelera.');
                return;
            }

            // Preguntar al usuario si desea volver a descontar el stock
            showMessageModal(
                'Al restaurar este pedido, ¿deseas descontar nuevamente los productos del inventario actual?',
                async () => {
                    // a. Volver a descontar el stock
                    for (const item of saleToRestore.items) {
                        if (item.trackStock) {
                            const product = await loadData(STORES.MENU, item.id);
                            if (product) {
                                const stockToDeduct = item.stockDeducted !== undefined ? item.stockDeducted : item.quantity;
                                product.stock -= stockToDeduct;
                                await saveData(STORES.MENU, product);
                            }
                        }
                    }

                    // b. Mover el pedido de vuelta a la tabla principal
                    delete saleToRestore.deletedTimestamp;
                    await saveData(STORES.SALES, saleToRestore);
                    await deleteData(STORES.DELETED_SALES, timestamp);
                    
                    showMessageModal('Pedido restaurado y stock actualizado.');
                    renderDashboard();
                    if (renderMenu) renderMenu();
                }
            );
        } catch (error) {
            console.error('Error restoring sale:', error);
            showMessageModal('Error al restaurar el pedido.');
        }
    }


    // Función separada para manejar productos más vendidos
    function renderTopProducts(productStats, totalRevenue) {
        const topProductsSelect = document.getElementById('top-products-select');
        const topProductsList = document.getElementById('top-products-list');
        if (!topProductsSelect || !topProductsList) {
            console.log('Top products elements not found in DOM');
            return;
        }
        const updateTopProducts = (topN) => {
            const topProducts = Array.from(productStats.values())
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, topN);

            topProducts.forEach(product => {
                product.percentage = totalRevenue > 0
                    ? (product.revenue / totalRevenue * 100).toFixed(2)
                    : 0;
            });

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

        const defaultTop = parseInt(topProductsSelect.value) || 5;
        updateTopProducts(defaultTop);

        topProductsSelect.addEventListener('change', (e) => {
            updateTopProducts(parseInt(e.target.value));
        });
    }

    // Función auxiliar para calcular utilidad de un item específico
    function calculateItemProfit(item, productMap) {
        const product = productMap.get(item.id) || {
            price: item.price,
            cost: item.cost || item.price * 0.6 // Asumir 40% de margen por defecto
        };
        return (item.price - product.cost) * item.quantity;
    }

    //funcion para redenrizar el historial de movimientos
    async function renderMovementHistory() {
        const movementList = document.getElementById('movement-history-list');
        const emptyMessage = document.getElementById('empty-movements-message');
        if (!movementList || !emptyMessage) return;

        try {
            const deletedProducts = await loadData(STORES.DELETED_MENU);
            const deletedCustomers = await loadData(STORES.DELETED_CUSTOMERS);
            const deletedSales = await loadData(STORES.DELETED_SALES);

            const allMovements = [
                ...deletedProducts.map(p => ({ ...p, type: 'Producto' })),
                ...deletedCustomers.map(c => ({ ...c, type: 'Cliente' })),
                ...deletedSales.map(s => ({ ...s, type: 'Pedido', name: `Pedido por $${s.total.toFixed(2)}` }))
            ];

            // Ordena por fecha de eliminación, los más recientes primero
            allMovements.sort((a, b) => new Date(b.deletedTimestamp) - new Date(a.deletedTimestamp));
            
            movementList.innerHTML = '';
            emptyMessage.classList.toggle('hidden', allMovements.length > 0);

            allMovements.forEach(item => {
            const div = document.createElement('div');
            div.className = 'movement-item';
            
            // Usamos item.id para productos/clientes y item.timestamp para pedidos
            const uniqueId = item.type === 'Pedido' ? item.timestamp : item.id;
            
            div.innerHTML = `
                <div class="movement-item-info">
                    <p>${item.name}</p>
                    <p>
                        <span class="item-type">${item.type}</span> 
                        Eliminado el: ${new Date(item.deletedTimestamp).toLocaleString()}
                    </p>
                </div>
                <div class="movement-item-actions">
                    <button class="btn-details-movement" data-id="${uniqueId}" data-type="${item.type}">Detalles</button>
                    <button class="btn-restore" data-id="${uniqueId}" data-type="${item.type}">Restaurar</button>
                </div>
            `;
            movementList.appendChild(div);
        });

        } catch (error) {
            console.error('Error rendering movement history:', error);
            movementList.innerHTML = '<p>Error al cargar el historial.</p>';
        }
    }
    //eventos para los botones de restauracion
    document.getElementById('movement-history-list')?.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const { id, type } = button.dataset;

        if (button.classList.contains('btn-restore')) {
            if (type === 'Producto') window.restoreProduct(id);
            else if (type === 'Cliente') {
                window.restoreCustomer(id);
                document.dispatchEvent(new Event('customersUpdated'));
            } else if (type === 'Pedido') restoreSale(id);
        } 
        // AÑADE ESTA CONDICIÓN
        else if (button.classList.contains('btn-details-movement')) {
            showMovementDetails(id, type);
        }
    });

    // elements para modal de detalle que se elimino
    const movementDetailsModal = document.getElementById('movement-details-modal');
    const movementDetailsTitle = document.getElementById('movement-details-title');
    const movementDetailsContent = document.getElementById('movement-details-content');
    const closeMovementDetailsBtn = document.getElementById('close-movement-details-btn');

    closeMovementDetailsBtn?.addEventListener('click', () => {
        movementDetailsModal?.classList.add('hidden');
    });
    async function showMovementDetails(id, type) {
        if (!movementDetailsModal) return;

        let contentHtml = '<p>No se encontraron detalles.</p>';
        let title = `Detalles del ${type}`;
        
        try {
            switch (type) {
                case 'Producto': {
                    const product = await loadData(STORES.DELETED_MENU, id);
                    const ingredientsData = await loadData(STORES.INGREDIENTS, id);
                    contentHtml = `
                        <p><strong>ID:</strong> ${product.id}</p>
                        <p><strong>Nombre:</strong> ${product.name}</p>
                        <p><strong>Descripción:</strong> ${product.description || 'N/A'}</p>
                        <p><strong>Precio Venta:</strong> $${product.price.toFixed(2)}</p>
                        <p><strong>Costo:</strong> $${product.cost.toFixed(2)}</p>
                        <p><strong>Stock (al eliminar):</strong> ${product.stock}</p>
                    `;
                    if (ingredientsData && ingredientsData.ingredients.length > 0) {
                        contentHtml += '<h4>Ingredientes:</h4><ul>';
                        ingredientsData.ingredients.forEach(ing => {
                            contentHtml += `<li>${ing.name} (x${ing.quantity}) - Costo: $${(ing.cost * ing.quantity).toFixed(2)}</li>`;
                        });
                        contentHtml += '</ul>';
                    }
                    break;
                }
                case 'Cliente': {
                    const customer = await loadData(STORES.DELETED_CUSTOMERS, id);
                    contentHtml = `
                        <p><strong>ID:</strong> ${customer.id}</p>
                        <p><strong>Nombre:</strong> ${customer.name}</p>
                        <p><strong>Teléfono:</strong> ${customer.phone}</p>
                        <p><strong>Dirección:</strong> ${customer.address}</p>
                    `;
                    break;
                }
                case 'Pedido': {
                    const sale = await loadData(STORES.DELETED_SALES, id);
                    title = 'Detalles del Pedido Eliminado';
                    contentHtml = `
                        <p><strong>Timestamp:</strong> ${new Date(sale.timestamp).toLocaleString()}</p>
                        <p><strong>Total del Pedido:</strong> $${sale.total.toFixed(2)}</p>
                    `;
                    if (sale.items && sale.items.length > 0) {
                        contentHtml += '<h4>Artículos en el pedido:</h4><ul>';
                        sale.items.forEach(item => {
                            contentHtml += `<li>${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}</li>`;
                        });
                        contentHtml += '</ul>';
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`Error loading details for ${type}:`, error);
            contentHtml = `<p>Error al cargar los detalles: ${error.message}</p>`;
        }

        movementDetailsTitle.textContent = title;
        movementDetailsContent.innerHTML = contentHtml;
        movementDetailsModal.classList.remove('hidden');
    }


    // Devolver las funciones públicas del módulo
    return {
        renderDashboard,
        deleteOrder
    };
}

export { createDashboardModule };
