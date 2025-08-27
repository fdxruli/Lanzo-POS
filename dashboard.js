// dashboard.js - Versión modificada para recibir dependencias

// Función factory que crea el módulo del dashboard con sus dependencias
function createDashboardModule(dependencies) {
    const {
        loadData,
        showMessageModal,
        deleteData,
        normalizeProducts,
        STORES
    } = dependencies;

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

    // Función para eliminar pedidos
    function deleteOrder(timestamp) {
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

    // Devolver las funciones públicas del módulo
    return {
        renderDashboard,
        deleteOrder
    };
}
