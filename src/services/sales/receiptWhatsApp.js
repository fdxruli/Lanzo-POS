import {
    buildCustomerMessagePayload,
    isCreditPaymentMethod,
    notificationNotRequested
} from '../customerMessaging/index.js';
import {
    getSaleChannel,
    getSaleEcommerceOrderCode,
    getSaleFinancialFolio,
    getSaleOperationalFolio
} from './saleReference';

const resolveCustomer = async ({ sale = {}, paymentData = {}, loadData, STORES }) => {
    const customerId = sale.customerId || sale.customer_id || paymentData.customerId || paymentData.customer_id || null;
    let storedCustomer = null;

    if (customerId && typeof loadData === 'function' && STORES?.CUSTOMERS) {
        storedCustomer = await loadData(STORES.CUSTOMERS, customerId);
    }

    return {
        id: storedCustomer?.id || customerId,
        // This fallback never writes customer data; it only lets a missing
        // phone resolve to the controlled notification outcome.
        name: storedCustomer?.name || sale.customerName || sale.customer_name || paymentData.customerName || 'Cliente',
        phone: storedCustomer?.phone ?? sale.customerPhone ?? sale.customer_phone ?? paymentData.customerPhone ?? null
    };
};

const buildConfirmedSaleSnapshot = ({ sale = {}, items = [], paymentData = {}, total }) => ({
    ...sale,
    items: Array.isArray(sale.items) && sale.items.length > 0 ? sale.items : items,
    folio: getSaleFinancialFolio(sale) || sale.folio || null,
    subtotal: sale.subtotal ?? sale.grossSubtotal ?? sale.metadata?.grossSubtotal ?? null,
    discount: sale.discount ?? sale.discountTotal ?? sale.discount_total ?? sale.metadata?.discountTotal ?? sale.metadata?.discount_total ?? null,
    total: sale.total ?? total,
    paymentMethod: sale.payment_method ?? sale.paymentMethod ?? paymentData.payment_method ?? paymentData.paymentMethod ?? paymentData.method ?? null,
    amountPaid: sale.amount_paid ?? sale.abono ?? sale.amountPaid ?? paymentData.amount_paid ?? paymentData.amountPaid ?? null,
    receivedAmount: sale.received_amount ?? sale.receivedAmount ?? paymentData.received_amount ?? paymentData.receivedAmount ?? null,
    changeAmount: sale.change_amount ?? sale.changeAmount ?? paymentData.change_amount ?? paymentData.changeAmount ?? null,
    balanceDue: sale.balance_due ?? sale.saldoPendiente ?? sale.balanceDue ?? paymentData.saldoPendiente ?? paymentData.balanceDue ?? null,
    dueDate: sale.dueDate ?? sale.due_date ?? paymentData.dueDate ?? null,
    creditStatus: sale.creditStatus ?? sale.credit_status ?? null,
    salesChannel: getSaleChannel(sale),
    ecommerceOrderCode: getSaleEcommerceOrderCode(sale),
    posFolio: getSaleOperationalFolio(sale),
    saleDiscount: sale.saleDiscount ?? sale.metadata?.discount ?? null,
    prescriptionDetails: sale.prescriptionDetails ?? sale.prescription_details ?? null,
    metadata: sale.metadata ?? null
});

const durableSaleTimestamp = (sale = {}) => (
    sale.timestamp
    || sale.soldAt
    || sale.sold_at
    || sale.createdAt
    || sale.created_at
    || null
);

/**
 * Builds an image-ready payload only after the caller has a confirmed sale.
 * There is no financial mutation, share call, text fallback, or retry path
 * here: every exit is a messaging result, never a sale failure.
 */
export async function sendReceiptWhatsApp({
    sale,
    items,
    paymentData = {},
    total,
    companyName,
    features,
    loadData,
    STORES,
    Logger
}) {
    if (paymentData.sendReceipt === false) return notificationNotRequested();

    try {
        const confirmedSale = buildConfirmedSaleSnapshot({ sale, items, paymentData, total });
        const customer = await resolveCustomer({ sale: confirmedSale, paymentData, loadData, STORES });
        const payloadResult = buildCustomerMessagePayload({
            eventType: isCreditPaymentMethod(confirmedSale.paymentMethod) ? 'sale_credit' : 'sale_paid',
            customer,
            business: { name: companyName || 'Tu Negocio' },
            occurredAt: durableSaleTimestamp(confirmedSale),
            currency: confirmedSale.currency || paymentData.currency || 'MXN',
            reference: confirmedSale.folio || null,
            sale: confirmedSale,
            internalContext: {
                source: confirmedSale.sourceMode || 'sale_receipt',
                showLabItemMarker: Boolean(features?.hasLabFields)
            }
        });

        if (!payloadResult.ok) {
            return {
                status: 'payload_invalid',
                code: payloadResult.code || 'MESSAGE_PAYLOAD_INVALID',
                errors: payloadResult.errors || []
            };
        }

        // Phase 2 deliberately stops here. Post-sale work may prepare the
        // normalized payload, but only a later, explicit UI gesture may render
        // and share its PNG. The legacy function name remains for wiring
        // compatibility; no WhatsApp/text opener is invoked.
        return {
            status: 'ready',
            code: 'IMAGE_SHARE_USER_ACTION_REQUIRED',
            payload: payloadResult.payload
        };
    } catch (error) {
        Logger?.error?.('Error preparando comprobante de imagen:', error);
        return {
            status: 'failed',
            code: error?.code || 'IMAGE_RECEIPT_PREPARATION_FAILED',
            message: error?.message || 'No se pudo preparar el comprobante de imagen.'
        };
    }
}

export const receiptWhatsAppInternals = Object.freeze({
    buildConfirmedSaleSnapshot,
    durableSaleTimestamp,
    resolveCustomer
});
