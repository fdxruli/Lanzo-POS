import { generateID } from '../utils';
import { db, STORES } from './dexie';
import { DatabaseError, DB_ERROR_CODES } from './utils';
import { Money } from '../../utils/moneyMath'; // <-- OBLIGATORIO

export const customerCreditRepository = {
    /**
     * Registra un abono de forma atómica.
     * La validación de la deuda ocurre DENTRO del candado transaccional, 
     * no confiando en el estado del cliente que viene del Frontend.
     */
    async processPayment(customerId, amount, paymentMethod = 'efectivo', cajaId, note = '') {
        // 1. Defensa y sanitización inicial
        const amountSafe = Money.init(amount);

        if (amountSafe.lte(0)) {
            throw new Error("El monto del abono debe ser estrictamente mayor a 0.");
        }

        return await db.transaction('rw', [
            db.table(STORES.CUSTOMERS),
            db.table(STORES.CUSTOMER_LEDGER),
            db.table(STORES.CAJAS),
            db.table(STORES.MOVIMIENTOS_CAJA)
        ], async () => {
            const customer = await db.table(STORES.CUSTOMERS).get(customerId);
            if (!customer) {
                throw new DatabaseError(DB_ERROR_CODES.NOT_FOUND, `Cliente ${customerId} no existe.`);
            }

            // 2. Validación de deuda estricta con Big.js
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
                updatedAt: timestamp
            });

            // 5. Registrar el ingreso en la Caja Activa protegiendo los valores
            if (cajaId) {
                const caja = await db.table(STORES.CAJAS).get(cajaId);
                if (!caja || caja.estado !== 'abierta') {
                    throw new Error("Transacción abortada: La caja no está abierta.");
                }

                const currentCajaIngresos = Money.init(caja.ingresos_efectivo || 0);
                const newCajaIngresos = Money.add(currentCajaIngresos, amountSafe);

                await db.table(STORES.CAJAS).update(cajaId, {
                    ingresos_efectivo: Money.toExactString(newCajaIngresos)
                });

                await db.table(STORES.MOVIMIENTOS_CAJA).add({
                    id: generateID('mov'),
                    caja_id: cajaId,
                    tipo: 'ingreso',
                    monto: Money.toExactString(amountSafe),
                    concepto: `Abono de cliente: ${customer.name}`,
                    fecha: timestamp
                });
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
                updatedAt: new Date().toISOString()
            });

            return exactDebtString;
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
                            debt: Money.toExactString(debtSafe)
                        });
                    }
                }
            }
        });
    }
};