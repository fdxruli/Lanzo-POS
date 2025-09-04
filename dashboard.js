// dashboard.js - Versión modificada para recibir dependencias

// Función factory que crea el módulo del dashboard con sus dependencias
function createDashboardModule(dependencies) {
    const {
        loadData,
        showMessageModal,
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
    }

    // --- FUNCIÓN PARA ELIMINAR PEDIDOS (MODIFICADA) ---
    async function deleteOrder(timestamp) {
        try {
            // 1. Obtener los datos de la venta que se va a eliminar
            const saleToDelete = await loadData(STORES.SALES, timestamp);
            if (!saleToDelete) {
                showMessageModal('Error: No se encontró el pedido.');
                return;
            }

            // 2. Mostrar el modal de confirmación avanzado
            showAdvancedConfirmModal(
                '¿Deseas regresar los productos de este pedido al inventario?',
                [
                    {
                        text: 'Sí, regresar y eliminar',
                        class: 'btn btn-save',
                        action: async () => {
                            // 3a. Lógica para regresar stock
                            try {
                                let totalQuantityInOrder = 0;
                                let totalStockRestored = 0;

                                for (const item of saleToDelete.items) {
                                    totalQuantityInOrder += item.quantity;
                                    if (item.trackStock) {
                                        const product = await loadData(STORES.MENU, item.id);
                                        if (product) {
                                            const stockToReturn = item.stockDeducted !== undefined ? item.stockDeducted : item.quantity;
                                            totalStockRestored += stockToReturn;
                                            product.stock += stockToReturn;
                                            await saveData(STORES.MENU, product);
                                        }
                                    }
                                }

                                // 4. Eliminar el pedido
                                await deleteData(STORES.SALES, timestamp);

                                // 5. Mostrar mensaje detallado
                                let message = `Pedido eliminado. Se restauraron ${totalStockRestored} unidades al stock.`;
                                if (totalQuantityInOrder > totalStockRestored) {
                                    const difference = totalQuantityInOrder - totalStockRestored;
                                    message += ` ${difference} unidad(es) que se vendieron por encima del stock no se restauraron para mantener la integridad del inventario.`;
                                }

                                showMessageModal(message);
                                renderDashboard(); // Actualizar la vista del dashboard
                                if (renderMenu) renderMenu(); // ¡Actualizar el menú del TPV!
                            } catch (error) {
                                console.error('Error restoring stock:', error);
                                showMessageModal('Error al restaurar el stock.');
                            }
                        }
                    },
                    {
                        text: 'No, solo eliminar',
                        class: 'btn btn-cancel',
                        action: async () => {
                            // 3b. Solo eliminar el pedido
                            try {
                                await deleteData(STORES.SALES, timestamp);
                                showMessageModal('Pedido eliminado.');
                                renderDashboard(); // Actualizar la vista
                            } catch (error) {
                                console.error('Error deleting order:', error);
                                showMessageModal('Error al eliminar el pedido.');
                            }
                        }
                    },
                    {
                        text: 'Cancelar',
                        class: 'btn btn-modal',
                        action: () => { /* No hacer nada */ }
                    }
                ]
            );
        } catch (error) {
            console.error('Error preparing to delete order:', error);
            showMessageModal('Error al obtener los datos del pedido para eliminar.');
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
                .sort((a, b) => b.quantity - a.qzuantity)
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

    // Devolver las funciones públicas del módulo
    return {
        renderDashboard,
        deleteOrder
    };
}

export { createDashboardModule };
