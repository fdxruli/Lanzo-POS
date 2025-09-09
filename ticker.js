// ticker.js
import { loadData, STORES } from './database.js';

// Función para crear y gestionar el ticker de notificaciones
export function createTickerModule() {
    const LOW_STOCK_THRESHOLD = 5;
    const EXPIRY_DAYS_THRESHOLD = 7;
    let tickerContainer;

    // Mensajes promocionales que se mostrarán cuando no haya alertas
    const promotionalMessages = [
        "🚀 ¡Potencia tu negocio con Lanzo POS!",
        "💡 ¿Sabías que puedes personalizar los colores de la aplicación en la sección de Configuración?",
        "📦 Gestiona tu inventario de forma fácil y rápida.",
        "✨ ¡Sigue creciendo tu negocio con nosotros!"
    ];

    /**
     * Busca alertas de productos (bajo stock y fechas de caducidad).
     * @returns {Promise<Array<string>>} Un arreglo de mensajes de alerta.
     */
    async function getProductAlerts() {
        const alerts = [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        try {
            const menu = await loadData(STORES.MENU);
            if (!menu || menu.length === 0) return [];

            menu.forEach(product => {
                // --- NUEVA CONDICIÓN ---
                // Si el producto está inactivo (isActive es false), no se generan alertas para él.
                if (product.isActive === false) {
                    return; // Salta a la siguiente iteración del bucle
                }

                // Alerta de stock bajo
                if (product.trackStock && product.stock > 0 && product.stock < LOW_STOCK_THRESHOLD) {
                    alerts.push(`¡Stock bajo! Quedan ${product.stock} unidades de ${product.name}.`);
                }

                // Alerta de caducidad
                if (product.expiryDate) {
                    const expiryDate = new Date(product.expiryDate);
                    const diffTime = expiryDate - now;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays >= 0 && diffDays <= EXPIRY_DAYS_THRESHOLD) {
                        const message = diffDays === 0 ?
                            `¡Atención! ${product.name} caduca hoy.` :
                            `¡Atención! ${product.name} caduca en ${diffDays} días.`;
                        alerts.push(message);
                    }
                }
            });
        } catch (error) {
            console.error("Error al verificar alertas de productos:", error);
        }
        return alerts;
    }

    /**
     * Renderiza el ticker en el DOM con las alertas o mensajes promocionales.
     */
    async function renderTicker() {
        tickerContainer = document.getElementById('notification-ticker-container');
        if (!tickerContainer) return;

        let messages = await getProductAlerts();

        // Si no hay alertas, usamos los mensajes promocionales
        if (messages.length === 0) {
            messages = promotionalMessages;
        }

        // Limpiamos el contenedor
        tickerContainer.innerHTML = '';

        if (messages.length > 0) {
            const tickerWrap = document.createElement('div');
            tickerWrap.className = 'ticker-wrap';

            const tickerMove = document.createElement('div');
            tickerMove.className = 'ticker-move';

            messages.forEach(msg => {
                const tickerItem = document.createElement('div');
                tickerItem.className = 'ticker-item';
                tickerItem.textContent = msg;
                tickerMove.appendChild(tickerItem);
            });

            tickerWrap.appendChild(tickerMove);
            tickerContainer.appendChild(tickerWrap);
        }
    }

    /**
     * Función pública para actualizar las alertas del ticker.
     */
    async function updateAlerts() {
        await renderTicker();
    }

    // Devolvemos las funciones que queremos que sean públicas
    return {
        renderTicker,
        updateAlerts
    };
}
