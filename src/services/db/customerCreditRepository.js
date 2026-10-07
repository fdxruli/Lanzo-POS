import { generateID } from '../utils';
import { db, STORES } from './dexie';
import { DatabaseError, DB_ERROR_CODES } from './utils';
import { normalizeCustomerDebtCents } from './customerDebtIndex';
import { Money } from '../../utils/moneyMath'; // <-- OBLIGATORIO
import { registrarMovimientoCajaEnTransaccion } from '../cajaService';
import { getCashActorFromState } from '../cash/cashActor';
import { getCashStationIdentity } from '../cash/cashStation';
import { captureCashActorContext } from '../cash/cashFinancialGate';
import {
    LOCAL_TENANT_STATUS,
    localTenantAccessController
} from '../tenant/localTenantPolicy';
import { getTenantRuntimeReadiness } from './tenantRuntimeRouter';

const isCashPaymentMethod = (paymentMethod) => (
    ['efectivo', 'cash'].includes(String(paymentMethod || '').trim().toLowerCase())
);

export const customerCreditRepository = {
    /**
     * Registra un abono de forma at처mica.
     * La validaci처n de la deuda ocurre DENTRO del candado transaccional, 
     * no confiando en el estado del cliente que viene del Frontend.
     */
    async processPayment(customerId, amount, paymentMethod = 'efectivo', cajaId, note = '', allocations = null) {
        // 1. Defensa y sanitizaci처n inicial
        const amountSafe = Money.init(amount);
        const isCashPayment = isCashPaymentMethod(paymentMethod);

        if (amountSafe.lte(0)) {
            throw new Error("El monto del abono debe ser estrictamente mayor a 0.");
  떻쬺�^