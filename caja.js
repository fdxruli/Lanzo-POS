// caja.js
import { saveData, loadData, STORES, initDB } from './database.js';
import { showMessageModal } from './utils.js';

let currentCaja = null;

// --- FUNCIONES PRINCIPALES ---

/**
 * Abre una nueva caja registradora.
 * @param {number} monto_inicial - El monto inicial en efectivo.
 */
export async function abrirCaja(monto_inicial) {
    if (isNaN(monto_inicial) || monto_inicial < 0) {
        showMessageModal('El monto inicial no es válido.');
        return false;
    }

    // Verificar si ya hay una caja abierta
    const cajasAbiertas = await loadData(STORES.CAJAS, null, 'estado', 'abierta');
    if (cajasAbiertas && cajasAbiertas.length > 0) {
        showMessageModal('Ya existe una caja abierta. Debes cerrarla antes de abrir una nueva.');
        return false;
    }

    const nuevaCaja = {
        id: `caja-${Date.now()}`,
        fecha_apertura: new Date().toISOString(),
        monto_inicial: parseFloat(monto_inicial),
        estado: 'abierta',
        fecha_cierre: null,
        monto_cierre: null,
        ventas_efectivo: 0,
        ventas_tarjeta: 0,
        otros_metodos: 0,
        entradas_efectivo: 0,
        salidas_efectivo: 0,
        diferencia: null
    };

    try {
        await saveData(STORES.CAJAS, nuevaCaja);
        currentCaja = nuevaCaja;
        showMessageModal(`Caja abierta con un monto inicial de $${monto_inicial.toFixed(2)}.`);
        // Actualizar la UI
        document.dispatchEvent(new Event('cajaUpdated'));
        return true;
    } catch (error) {
        console.error('Error al abrir la caja:', error);
        showMessageModal('No se pudo abrir la caja.');
        return false;
    }
}

/**
 * Cierra la caja actualmente abierta.
 * @param {number} monto_cierre - El monto final en efectivo contado.
 */
export async function cerrarCaja(monto_cierre) {
    if (!currentCaja || currentCaja.estado !== 'abierta') {
        showMessageModal('No hay una caja abierta para cerrar.');
        return false;
    }
    if (isNaN(monto_cierre) || monto_cierre < 0) {
        showMessageModal('El monto de cierre no es válido.');
        return false;
    }

    try {
        // Calcular totales de ventas desde la apertura de la caja
        const todasLasVentas = await loadData(STORES.SALES);
        const ventasDeSesion = todasLasVentas.filter(venta => new Date(venta.timestamp) >= new Date(currentCaja.fecha_apertura));

        let ventas_efectivo = 0;
        // Asumimos que todas las ventas son en efectivo por ahora.
        // Se necesitaría añadir un método de pago en `processOrder` para diferenciar.
        ventasDeSesion.forEach(venta => {
            ventas_efectivo += venta.total;
        });

        const total_teorico = currentCaja.monto_inicial + ventas_efectivo + currentCaja.entradas_efectivo - currentCaja.salidas_efectivo;
        const diferencia = monto_cierre - total_teorico;

        // Actualizar el objeto de la caja
        currentCaja.fecha_cierre = new Date().toISOString();
        currentCaja.monto_cierre = parseFloat(monto_cierre);
        currentCaja.ventas_efectivo = ventas_efectivo;
        currentCaja.diferencia = diferencia;
        currentCaja.estado = 'cerrada';

        await saveData(STORES.CAJAS, currentCaja);
        const mensajeDiferencia = diferencia === 0 ? 'La caja cuadró perfectamente.' : (diferencia > 0 ? `Sobrante de $${diferencia.toFixed(2)}.` : `Faltante de $${Math.abs(diferencia).toFixed(2)}.`);
        showMessageModal(`Caja cerrada. ${mensajeDiferencia}`);
        
        currentCaja = null;
        // Actualizar la UI
        document.dispatchEvent(new Event('cajaUpdated'));
        return true;

    } catch (error) {
        console.error('Error al cerrar la caja:', error);
        showMessageModal('Ocurrió un error al cerrar la caja.');
        return false;
    }
}

/**
 * Valida el estado de la caja al iniciar la aplicación.
 * @returns {Promise<Object|null>} El estado de la caja actual.
 */
export async function validarCaja() {
    const db = await initDB();
    const transaction = db.transaction(STORES.CAJAS, 'readonly');
    const store = transaction.objectStore(STORES.CAJAS);
    const index = store.index('estado');
    const request = index.getAll('abierta');

    return new Promise((resolve) => {
        request.onsuccess = () => {
            const cajasAbiertas = request.result;
            if (cajasAbiertas && cajasAbiertas.length > 0) {
                currentCaja = cajasAbiertas[0]; // Asumimos solo una puede estar abierta
                const ahora = new Date();
                const fechaApertura = new Date(currentCaja.fecha_apertura);
                const horasAbierta = (ahora - fechaApertura) / (1000 * 60 * 60);

                if (horasAbierta > 16) {
                    currentCaja.estado = 'pendiente_cierre';
                    showMessageModal('La caja ha estado abierta por más de 16 horas. Debes cerrarla para poder continuar vendiendo.');
                }
                 resolve(currentCaja);
            } else {
                currentCaja = null;
                resolve(null);
            }
        };
        request.onerror = () => {
            currentCaja = null;
            resolve(null);
        };
    });
}

/**
 * Obtiene la caja actualmente activa.
 * @returns {Object|null}
 */
export function getCajaActual() {
    return currentCaja;
}

// --- LÓGICA DE LA INTERFAZ ---

export function initCajaModule() {
    // Listeners para los botones de abrir y cerrar caja
    const openCajaBtn = document.getElementById('open-caja-btn');
    const closeCajaBtn = document.getElementById('close-caja-btn');
    const confirmOpenCajaBtn = document.getElementById('confirm-open-caja-btn');
    const confirmCloseCajaBtn = document.getElementById('confirm-close-caja-btn');
    const cancelOpenCajaBtn = document.getElementById('cancel-open-caja-btn');
    const cancelCloseCajaBtn = document.getElementById('cancel-close-caja-btn');
    
    openCajaBtn?.addEventListener('click', () => {
        document.getElementById('open-caja-modal').classList.remove('hidden');
    });

    closeCajaBtn?.addEventListener('click', () => {
        document.getElementById('close-caja-modal').classList.remove('hidden');
    });

    cancelOpenCajaBtn?.addEventListener('click', () => {
        document.getElementById('open-caja-modal').classList.add('hidden');
    });

    cancelCloseCajaBtn?.addEventListener('click', () => {
        document.getElementById('close-caja-modal').classList.add('hidden');
    });

    confirmOpenCajaBtn?.addEventListener('click', async () => {
        const monto = document.getElementById('monto-inicial-input').value;
        if (await abrirCaja(parseFloat(monto))) {
            document.getElementById('open-caja-modal').classList.add('hidden');
        }
    });

    confirmCloseCajaBtn?.addEventListener('click', async () => {
        const monto = document.getElementById('monto-cierre-input').value;
        if (await cerrarCaja(parseFloat(monto))) {
            document.getElementById('close-caja-modal').classList.add('hidden');
        }
    });

    // Escuchar el evento de actualización para renderizar la UI
    document.addEventListener('cajaUpdated', renderCajaStatus);
    
    // Renderizar estado inicial
    renderCajaStatus();
}

async function renderCajaStatus() {
    const statusContainer = document.getElementById('caja-status-container');
    const actionsContainer = document.getElementById('caja-actions-container');
    const historyContainer = document.getElementById('caja-history-container');
    
    if (!statusContainer || !actionsContainer || !historyContainer) return;
    
    const caja = getCajaActual();

    if (caja && caja.estado === 'abierta') {
        statusContainer.innerHTML = `
            <h3>Caja Abierta</h3>
            <p><strong>Fecha de Apertura:</strong> ${new Date(caja.fecha_apertura).toLocaleString()}</p>
            <p><strong>Monto Inicial:</strong> $${caja.monto_inicial.toFixed(2)}</p>
        `;
        actionsContainer.innerHTML = `<button id="close-caja-btn" class="btn btn-process">Cerrar Caja</button>`;
        document.getElementById('close-caja-btn').addEventListener('click', () => {
            document.getElementById('close-caja-modal').classList.remove('hidden');
        });

    } else if (caja && caja.estado === 'pendiente_cierre') {
         statusContainer.innerHTML = `
            <h3>Cierre de Caja Requerido</h3>
            <p class="error-message">Esta caja ha superado las 16 horas abierta. Debes cerrarla.</p>
            <p><strong>Fecha de Apertura:</strong> ${new Date(caja.fecha_apertura).toLocaleString()}</p>
        `;
        actionsContainer.innerHTML = `<button id="close-caja-btn" class="btn btn-process">Cerrar Caja Ahora</button>`;
        document.getElementById('close-caja-btn').addEventListener('click', () => {
            document.getElementById('close-caja-modal').classList.remove('hidden');
        });
    } else {
        statusContainer.innerHTML = `
            <h3>Caja Cerrada</h3>
            <p>No hay una sesión de caja activa. Abre una para comenzar a vender.</p>
        `;
        actionsContainer.innerHTML = `<button id="open-caja-btn" class="btn btn-save">Abrir Caja</button>`;
        document.getElementById('open-caja-btn').addEventListener('click', () => {
            document.getElementById('open-caja-modal').classList.remove('hidden');
        });
    }

    // Renderizar historial
    const todasLasCajas = (await loadData(STORES.CAJAS)).sort((a, b) => new Date(b.fecha_apertura) - new Date(a.fecha_apertura));
    const historialCerradas = todasLasCajas.filter(c => c.estado === 'cerrada');
    
    if (historialCerradas.length > 0) {
        historyContainer.innerHTML = `
            <h3 class="subtitle">Historial de Cajas</h3>
            <div class="history-list">
                ${historialCerradas.map(c => `
                    <div class="history-item">
                        <p><strong>Apertura:</strong> ${new Date(c.fecha_apertura).toLocaleString()}</p>
                        <p><strong>Cierre:</strong> ${new Date(c.fecha_cierre).toLocaleString()}</p>
                        <p><strong>Monto Inicial:</strong> $${c.monto_inicial.toFixed(2)}</p>
                        <p><strong>Ventas Efectivo:</strong> $${c.ventas_efectivo.toFixed(2)}</p>
                        <p><strong>Monto Final:</strong> $${c.monto_cierre.toFixed(2)}</p>
                        <p><strong>Diferencia:</strong> <span class="${c.diferencia >= 0 ? 'profit' : 'error-message'}">$${c.diferencia.toFixed(2)}</span></p>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        historyContainer.innerHTML = `<h3 class="subtitle">No hay historial de cajas.</h3>`;
    }

}
