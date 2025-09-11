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
        const todasLasVentas = await loadData(STORES.SALES);
        const ventasDeSesion = todasLasVentas.filter(venta => new Date(venta.timestamp) >= new Date(currentCaja.fecha_apertura));
        
        let ventas_efectivo = 0;
        ventasDeSesion.forEach(venta => {
            ventas_efectivo += venta.total;
        });

        // --- INICIO DE MODIFICACIÓN ---
        // Se usan los totales de la caja actual que ya incluyen los movimientos
        const total_teorico = currentCaja.monto_inicial + ventas_efectivo + currentCaja.entradas_efectivo - currentCaja.salidas_efectivo;
        const diferencia = monto_cierre - total_teorico;
        // --- FIN DE MODIFICACIÓN ---

        currentCaja.fecha_cierre = new Date().toISOString();
        currentCaja.monto_cierre = parseFloat(monto_cierre);
        currentCaja.ventas_efectivo = ventas_efectivo;
        currentCaja.diferencia = diferencia;
        currentCaja.estado = 'cerrada';

        await saveData(STORES.CAJAS, currentCaja);
        const mensajeDiferencia = diferencia === 0 ? 'La caja cuadró perfectamente.' : (diferencia > 0 ? `Sobrante de $${diferencia.toFixed(2)}.` : `Faltante de $${Math.abs(diferencia).toFixed(2)}.`);
        showMessageModal(`Caja cerrada. ${mensajeDiferencia}`);
        
        currentCaja = null;
        document.dispatchEvent(new Event('cajaUpdated'));
        return true;

    } catch (error) {
        console.error('Error al cerrar la caja:', error);
        showMessageModal('Ocurrió un error al cerrar la caja.');
        return false;
    }
}

/**
 * Registra una entrada o salida de efectivo en la caja actual.
 * @param {'entrada' | 'salida'} tipo - El tipo de movimiento.
 * @param {number} monto - La cantidad de dinero.
 * @param {string} concepto - La razón del movimiento.
 */
export async function registrarMovimientoCaja(tipo, monto, concepto) {
    if (!currentCaja || currentCaja.estado !== 'abierta') {
        showMessageModal('No hay una caja abierta para registrar movimientos.');
        return false;
    }
    if (isNaN(monto) || monto <= 0) {
        showMessageModal('El monto debe ser un número positivo.');
        return false;
    }
    if (!concepto.trim()) {
        showMessageModal('El concepto no puede estar vacío.');
        return false;
    }

    const movimiento = {
        id: `mov-${Date.now()}`,
        caja_id: currentCaja.id,
        tipo: tipo,
        monto: parseFloat(monto),
        concepto: concepto.trim(),
        fecha: new Date().toISOString()
    };

    try {
        // Guardar el movimiento
        await saveData(STORES.MOVIMIENTOS_CAJA, movimiento);

        // Actualizar el estado de la caja actual
        if (tipo === 'entrada') {
            currentCaja.entradas_efectivo += movimiento.monto;
        } else {
            currentCaja.salidas_efectivo += movimiento.monto;
        }
        await saveData(STORES.CAJAS, currentCaja);

        showMessageModal(`Movimiento de ${tipo} registrado exitosamente.`);
        document.dispatchEvent(new Event('cajaUpdated')); // Actualizar UI
        return true;
    } catch (error) {
        console.error(`Error al registrar ${tipo}:`, error);
        showMessageModal(`No se pudo registrar la ${tipo}.`);
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
                    showMessageModal(
                        'La caja ha estado abierta por más de 16 horas. Debes cerrarla para poder continuar vendiendo.',
                        null,
                        {
                            extraButton: {
                                text: 'Ir a Caja',
                                action: () => {
                                    document.dispatchEvent(new CustomEvent('navigateTo', { detail: 'caja' }));
                                }
                            }
                        }
                    );
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
    const confirmEntradaBtn = document.getElementById('confirm-entrada-caja-btn');
    const cancelEntradaBtn = document.getElementById('cancel-entrada-caja-btn');
    const confirmSalidaBtn = document.getElementById('confirm-salida-caja-btn');
    const cancelSalidaBtn = document.getElementById('cancel-salida-caja-btn');
    const entradaModal = document.getElementById('entrada-caja-modal');
    const salidaModal = document.getElementById('salida-caja-modal');
    
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

    confirmEntradaBtn?.addEventListener('click', async () => {
            const montoInput = document.getElementById('entrada-monto-input');
            const conceptoInput = document.getElementById('entrada-concepto-input');
            if (await registrarMovimientoCaja('entrada', montoInput.value, conceptoInput.value)) {
                montoInput.value = '';
                conceptoInput.value = '';
                entradaModal.classList.add('hidden');
            }
        });
    
        cancelEntradaBtn?.addEventListener('click', () => entradaModal.classList.add('hidden'));
        
        confirmSalidaBtn?.addEventListener('click', async () => {
            const montoInput = document.getElementById('salida-monto-input');
            const conceptoInput = document.getElementById('salida-concepto-input');
            if (await registrarMovimientoCaja('salida', montoInput.value, conceptoInput.value)) {
                montoInput.value = '';
                conceptoInput.value = '';
                salidaModal.classList.add('hidden');
            }
        });
    
        cancelSalidaBtn?.addEventListener('click', () => salidaModal.classList.add('hidden'));


    // Escuchar el evento de actualización para renderizar la UI
    document.addEventListener('cajaUpdated', renderCajaStatus);
    
    // Renderizar estado inicial
    renderCajaStatus();
}

async function renderCajaStatus() {
    const statusContainer = document.getElementById('caja-status-container');
    const actionsContainer = document.getElementById('caja-actions-container');
    const historyContainer = document.getElementById('caja-history-container');
    const movementsContainer = document.getElementById('caja-movements-container');
    
    if (!statusContainer || !actionsContainer || !historyContainer || !movementsContainer) return;
    
    const caja = getCajaActual();

    if (caja && caja.estado === 'abierta') {
        const db = await initDB();
        const transaction = db.transaction(STORES.MOVIMIENTOS_CAJA, 'readonly');
        const store = transaction.objectStore(STORES.MOVIMIENTOS_CAJA);
        const index = store.index('caja_id');
        const movimientos = await new Promise(resolve => {
            const request = index.getAll(caja.id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve([]);
        });

        statusContainer.innerHTML = `
            <h3>Caja Abierta</h3>
            <p><strong>Apertura:</strong> ${new Date(caja.fecha_apertura).toLocaleString()}</p>
            <p><strong>Monto Inicial:</strong> $${caja.monto_inicial.toFixed(2)}</p>
            <p style="color: green;"><strong>Entradas:</strong> $${caja.entradas_efectivo.toFixed(2)}</p>
            <p style="color: red;"><strong>Salidas:</strong> $${caja.salidas_efectivo.toFixed(2)}</p>
        `;
        actionsContainer.innerHTML = `
            <button id="close-caja-btn" class="btn btn-process">Cerrar Caja</button>
            <button id="add-entrada-btn" class="btn btn-save" style="margin-top: 10px;">+ Registrar Entrada</button>
            <button id="add-salida-btn" class="btn btn-delete" style="margin-top: 10px;">- Registrar Salida</button>
        `;
        document.getElementById('close-caja-btn').addEventListener('click', () => document.getElementById('close-caja-modal').classList.remove('hidden'));
        document.getElementById('add-entrada-btn').addEventListener('click', () => document.getElementById('entrada-caja-modal').classList.remove('hidden'));
        document.getElementById('add-salida-btn').addEventListener('click', () => document.getElementById('salida-caja-modal').classList.remove('hidden'));
        
        const movementsList = document.getElementById('caja-movements-list');
        if (movimientos.length > 0) {
            movementsList.innerHTML = movimientos.map(mov => `
                <div class="movement-item" style="color: ${mov.tipo === 'entrada' ? 'green' : 'red'};">
                    <span>${new Date(mov.fecha).toLocaleTimeString()}: ${mov.concepto}</span>
                    <span>$${mov.monto.toFixed(2)}</span>
                </div>
            `).join('');
            movementsContainer.classList.remove('hidden');
        } else {
            movementsContainer.classList.add('hidden');
        }

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
        statusContainer.innerHTML = `<h3>Caja Cerrada</h3><p>Abre una caja para comenzar a vender.</p>`;
        actionsContainer.innerHTML = `<button id="open-caja-btn" class="btn btn-save">Abrir Caja</button>`;
        document.getElementById('open-caja-btn').addEventListener('click', () => document.getElementById('open-caja-modal').classList.remove('hidden'));
        movementsContainer.classList.add('hidden');
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