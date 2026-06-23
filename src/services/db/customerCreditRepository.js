import { generateID } from '../utils';
import { db, STORES } from './dexie';
import { DatabaseError, DB_ERROR_CODES } from './utils';
import { normalizeCustomerDebtCents } from './customerDebtIndex';
import { Money } from '../../utils/moneyMath'; // <-- OBLIGATORIO
import { registrarMovimientoCajaEnTransaccion } from '../cajaService';

const isCashPaymentMethod = (paymentMethod) => (
    ['efectivo', 'cash'].includes(String(paymentMethod || '').trim().toLowerCase())
);

export const customerCreditRepository = {
    /**
     * Registra un abono de forma atómica.
     * La validación de la deuda ocurre DENTRO del candado transaccional, 
     * no confiando en el estado del cliente que viene del Frontend.
     */
    async processPayment(customerId, amount, paymentMethod = 'efectivo', cajaId, note = '', allocations = null) {
        // 1. Defensa y sanitización inicial
        const amountSafe = Money.init(amount);
        const isCashPayment = isCashPaymentMethod(paymentMethod);

        if (amountSafe.lte(0)) {
            throw new Error("El monto del abono debe ser estrictamente mayor a 0.");
        }

        if (isCashPayment && !cajaId) {
            throw new DatabaseError(
                DB_ERROR_CODES.VALIDATION_ERROR,
                'CAJA_REQUIRED: No se puede registrar un abono en efectivo sin caja abierta.'
            );
        }

        return await db.transaction('rw', [
            db.table(STORES.CUSTOMERS),
            db.table(STORES.CUSTOMER_LEDGER),
            db.table(STORES.CAJAS),
            db.table(STORES.MOVIMIENTOS_CAJA),
            db.table(STORES.SALES)
        ], async (tx) => {
            const customer = await db.table(STORES.CUSTOMERS).get(customerId);
            if (!customer) {
                throw new DatabaseError(DB_ERROR_CODES.NOT_FOUND, `Cliente ${customerId} no existe.`);
            }

            // 2. Validación de deuda estricta con Big.js
            if (isCashPayment) {
                const caja = await tx.table(STORES.CAJAS).get(cajaId);
                if (!caja) {
                    throw new DatabaseError(
                        DB_ERROR_CODES.NOT_FOUND,
                        `CAJA_REQUIRED: La caja ${cajaId} no existe.`
                    );
                }
                if (caja.estado !== 'abierta') {
                    throw new DatabaseError(
                        DB_ERROR_CODES.VALIDATION_ERROR,
                        'CAJA_REQUIRED: No se puede registrar un abono en efectivo sin caja abierta.'
                    );
                }
            }

            const currentDebtSafe = Money.init(customer.debt || 0);
            if (amountSafe.gt(currentDebtSafe)) {
                throw new Error(`El abono ($${Money.toNumber(amountSafe)}) excede la deuda actual de la base de datos ($${Money.toNumber(currentDebtSafe)}).`);
            }

            const timestamp = new Date().toISOString();
            const ledgerId = generateID('ldg');

            // Multiplicamos por -1 de forma segura para reflejar reducción de deuda
            const negativeAmount = Money.multiply(amountSafe, -1);

            // 3. Insertar registro inmutable en el Ledger con strings exactos
            await db.table(STORES.CUSTOMER_LEDGER).add({
                id: ledgerId,
                customerId,
                type: 'PAYMENT',
                amount: Money.toExactString(negativeAmount),
                paymentMethod,
                note,
                timestamp
            });

            // 4. Actualizar la proyección (caché) en el cliente de forma segura
            const newDebtSafe = Money.subtract(currentDebtSafe, amountSafe);
            await db.table(STORES.CUSTOMERS).update(customerId, {
                debt: Money.toExactString(newDebtSafe),
                debtCents: normalizeCustomerDebtCents(newDebtSafe),
                updatedAt: timestamp
            });

            // 5. Aplicar Abono a Notas (FIFO o Específicas)
            if (allocations && allocations.length > 0) {
                let totalAllocated = Money.init(0);
                for (const alloc of allocations) {
                    totalAllocated = Money.add(totalAllocated, alloc.amountApplied);
                }

                // Prevenir que la suma de asignaciones exceda el abono reportado
                if (totalAllocated.gt(amountSafe)) {
                    throw new Error("La suma de las asignaciones excede el abono total.");
                }

                for (const alloc of allocations) {
                    const sale = await db.table(STORES.SALES).get(alloc.saleId);
                    if (sale && sale.saldoPendiente > 0) {
                        const amountToApply = Money.init(alloc.amountApplied);
                        const currentSaldo = Money.init(sale.saldoPendiente);

                        // Bloquear sub-desbordamiento (saldo negativo)
                        const finalAmountToApply = amountToApply.gt(currentSaldo) ? currentSaldo : amountToApply;
                        const newSaldo = Money.subtract(currentSaldo, finalAmountToApply);

                        await db.table(STORES.SALES).update(alloc.saleId, {
                            saldoPendiente: Money.toNumber(newSaldo),
                            creditStatus: newSaldo.lte(0) ? 'PAGADO' : 'PARCIAL'
                        });
                    }
                }
            } else {
                let remainingAmount = amountSafe;
                const pendingSales = await db.table(STORES.SALES)
                    .where('customerId').equals(customerId)
                    .and(s => s.paymentMethod === 'fiado' && s.saldoPendiente > 0)
                    .sortBy('timestamp'); // Ascendente

                for (const sale of pendingSales) {
                    if (remainingAmount.lte(0)) break;

                    const currentSaldo = Money.init(sale.saldoPendiente);
                    const amountToApply = remainingAmount.gte(currentSaldo) ? currentSaldo : remainingAmount;
                    const newSaldo = Money.subtract(currentSaldo, amountToApply);

                    await db.table(STORES.SALES).update(sale.id, {
                        saldoPendiente: Money.toNumber(newSaldo),
                        creditStatus: newSaldo.lte(0) ? 'PAGADO' : 'PARCIAL'
                    });

                    remainingAmount = Money.subtract(remainingAmount, amountToApply);
                }
            }

            // 6. Registrar el ingreso en la Caja usando el servicio centralizado.
            //    Usamos registrarMovimientoCajaEnTransaccion (variante inline) porque
            //    ya estamos dentro de una transacción Dexie activa, y le inyectamos 'tx'.
            if (cajaId) {
                await registrarMovimientoCajaEnTransaccion(
                    tx,
                    cajaId,
                    'entrada',
                    amountSafe,
                    `Abono de cliente: ${customer.name}`
                );
            }

            return { success: true, newDebt: Money.toExactString(newDebtSafe), ledgerId };
        });
    },

    /**
     * Reconstruye la deuda de un cliente leyendo TODO su historial.
     * Ahora utiliza Big.js en cada iteración para evitar desviación.
     */
    async recalculateDebtFromLedger(customerId) {
        return await db.transaction('rw', [
            db.table(STORES.CUSTOMERS),
            db.table(STORES.CUSTOMER_LEDGER)
        ], async () => {
            const movements = await db.table(STORES.CUSTOMER_LEDGER)
                .where('customerId').equals(customerId)
                .toArray();

            // Acumulación estricta usando reduce con Money
            const exactDebtSafe = movements.reduce((acc, mov) => {
                return Money.add(acc, mov.amount || 0);
            }, Money.init(0));

            const exactDebtString = Money.toExactString(exactDebtSafe);

            await db.table(STORES.CUSTOMERS).update(customerId, {
                debt: exactDebtString,
                debtCents: normalizeCustomerDebtCents(exactDebtString),
                updatedAt: new Date().toISOString()
            });

            return exactDebtString;
        });
    },

    /**
     * AUTO-HEAL: Sincroniza los tickets individuales con la deuda global actual.
     * Usa lógica LIFO (reparte la deuda desde la compra más reciente a la más antigua)
     * para liquidar automáticamente los "tickets fantasma".
     */
    async healCustomerSalesDebt(customerId) {
        return await db.transaction('rw', [
            db.table(STORES.CUSTOMERS),
            db.table(STORES.SALES)
        ], async () => {
            const customer = await db.table(STORES.CUSTOMERS).get(customerId);
            if (!customer) return { success: false };

            const currentDebtSafe = Money.init(customer.debt || 0);

            // Obtener TODAS las ventas a crédito (pagadas o no)
            const allFiadoSales = await db.table(STORES.SALES)
                .where('customerId').equals(customerId)
                .and(s => s.paymentMethod === 'fiado')
                .sortBy('timestamp');

            // Invertir para aplicar LIFO (Priorizar deuda a los tickets más recientes)
            allFiadoSales.reverse();

            let remainingDebtToAllocate = currentDebtSafe;
            const salesToUpdate = [];

            for (const sale of allFiadoSales) {
                const totalSafe = Money.init(sale.total || 0);
                const abonoSafe = Money.init(sale.abono || 0);
                // La deuda original de esta nota
                const originalDebtOfSale = Money.subtract(totalSafe, abonoSafe);

                if (originalDebtOfSale.lte(0)) {
                    if (sale.saldoPendiente !== 0 || sale.creditStatus !== 'PAGADO') {
                        salesToUpdate.push({ ...sale, saldoPendiente: 0, creditStatus: 'PAGADO' });
                    }
                    continue;
                }

                // ¿Cuánta deuda le toca a este ticket? (Lo máximo es su deuda original)
                const debtForThisSale = remainingDebtToAllocate.gte(originalDebtOfSale)
                    ? originalDebtOfSale
                    : remainingDebtToAllocate;

                remainingDebtToAllocate = Money.subtract(remainingDebtToAllocate, debtForThisSale);

                const newSaldo = Money.toNumber(debtForThisSale);
                const newStatus = debtForThisSale.lte(0) ? 'PAGADO' : 'PARCIAL';

                // Solo empujar a la actualización si el ticket estaba descuadrado
                if (sale.saldoPendiente !== newSaldo || sale.creditStatus !== newStatus) {
                    salesToUpdate.push({
                        ...sale,
                        saldoPendiente: newSaldo,
                        creditStatus: newStatus
                    });
                }
            }

            // Actualizar la base de datos de un solo golpe
            if (salesToUpdate.length > 0) {
                await db.table(STORES.SALES).bulkPut(salesToUpdate);
            }

            return { success: true, healedCount: salesToUpdate.length };
        });
    },

    /**
     * Migración
     */
    async migrateExistingDebtsToLedger() {
        return await db.transaction('rw', [
            db.table(STORES.CUSTOMERS),
            db.table(STORES.CUSTOMER_LEDGER)
        ], async () => {
            // ... (el filtro inicial) ...
            const customersWithDebt = await db.table(STORES.CUSTOMERS).toArray();

            for (const customer of customersWithDebt) {
                const debtSafe = Money.init(customer.debt || 0);

                // Solo migrar a los que tengan deuda mayor a 0
                if (debtSafe.gt(0)) {
                    const existingMovements = await db.table(STORES.CUSTOMER_LEDGER)
                        .where('customerId').equals(customer.id)
                        .count();

                    if (existingMovements === 0) {
                        await db.table(STORES.CUSTOMER_LEDGER).add({
                            id: generateID('mig'),
                            customerId: customer.id,
                            type: 'INITIAL_BALANCE',
                            amount: Money.toExactString(debtSafe), // Sanitizado
                            reference: 'MIGRATION',
                            timestamp: new Date().toISOString()
                        });

                        // Opcional pero recomendado: Asegurar que el formato de deuda del cliente
                        // ahora sea un string puro como dicta el nuevo estándar.
                        await db.table(STORES.CUSTOMERS).update(customer.id, {
                            debt: Money.toExactString(debtSafe),
                            debtCents: normalizeCustomerDebtCents(debtSafe)
                        });
                    }
                }
            }
        });
    },

    /**
     * Actualiza el límite de crédito de todos los clientes de forma masiva y optimizada.
     * @param {number|null} newLimit El nuevo límite a aplicar
     * @param {boolean} overwriteCustomLimits Si es true, destruye los límites personalizados.
     */
    async bulkUpdateCreditLimits(newLimit, overwriteCustomLimits = false) {
        return await db.transaction('rw', db.table(STORES.CUSTOMERS), async () => {
            const timestamp = new Date().toISOString();

            if (overwriteCustomLimits) {
                // Opción Destructiva: Fuerza el valor a TODOS los registros.
                // modify() se ejecuta a nivel de base de datos, es instantáneo.
                await db.table(STORES.CUSTOMERS).toCollection().modify({
                    creditLimit: newLimit,
                    updatedAt: timestamp
                });
            } else {
                // Opción Inteligente (Recomendada):
                // Solo actualiza a los clientes que NO tienen un límite personalizado activo,
                // o aquellos que tenían el límite global anterior.
                // Requiere que el esquema soporte "creditLimit: null" para usar el global.
                await db.table(STORES.CUSTOMERS)
                    .filter(c => c.hasCustomLimit !== true)
                    .modify({
                        creditLimit: newLimit,
                        updatedAt: timestamp
                    });
            }
        });
    },

    /**
     * Tarea en segundo plano para sanear las discrepancias de deuda en toda la base de datos de forma segura.
     */
    async runGlobalAutoHealBackground() {
        try {
            // Prevenir concurrencia entre pestañas con Web Locks API
            if (navigator.locks) {
                await navigator.locks.request('lanzo_auto_heal_debt', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
                    if (!lock) {
                        console.log("Auto-heal de deudas: Otra pestaña ya está ejecutando la tarea.");
                        return;
                    }
                    await this._executeAutoHeal();
                });
            } else {
                // Fallback a localStorage si Web Locks no está disponible
                const lockKey = 'lanzo_auto_heal_debt_lock';
                const lastRun = localStorage.getItem(lockKey);
                if (lastRun && (Date.now() - parseInt(lastRun)) < 1000 * 60 * 60) {
                    return; // Corrió hace menos de 1 hora
                }
                localStorage.setItem(lockKey, Date.now().toString());
                await this._executeAutoHeal();
            }
        } catch (error) {
            console.error("Error en runGlobalAutoHealBackground:", error);
        }
    },

    /**
     * Método interno que realiza el saneamiento de tickets fantasma de todos los clientes.
     */
    async _executeAutoHeal() {
        console.log("Iniciando saneamiento global de deudas de clientes (Auto-Heal)...");
        try {
            // Buscar clientes con deuda reportada
            const customersWithDebt = await db.table(STORES.CUSTOMERS)
                .filter(c => Number(c.debt) > 0 || Number(c.debt) < 0)
                .toArray();

            let healedCount = 0;
            for (const customer of customersWithDebt) {
                const result = await this.healCustomerSalesDebt(customer.id);
                if (result && result.success && result.healedCount > 0) {
                    healedCount++;
                }
            }
            console.log(`Auto-heal completado. Se sanearon los tickets de ${healedCount} clientes.`);
        } catch (error) {
            console.error("Fallo durante _executeAutoHeal:", error);
        }
    }
};

// Enganchar el auto-heal al inicio de la base de datos sin bloquear el renderizado
db.on('ready', () => {
    // Usamos setTimeout para empujar la ejecución al final del event loop
    // asegurando que Dexie.js termine de abrir y React pueda renderizar.
    setTimeout(() => {
        customerCreditRepository.runGlobalAutoHealBackground().catch(err => {
            console.error("Error en hook de background auto-heal:", err);
        });
    }, 3000);
});
