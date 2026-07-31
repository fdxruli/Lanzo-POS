import { Money } from '../../utils/moneyMath';
import {
    getSaleEcommerceOrderCode,
    getSaleFinancialFolio,
    isEcommerceSale
} from './saleReference';

const formatMoney = (value) => Money.init(value).toFixed(2);

const firstDefinedMoneyValue = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        if (typeof value === 'object') continue;
        return Money.init(value);
    }
    return null;
};

const getReceiptSubtotal = (sale = {}, items = []) => {
    const storedSubtotal = firstDefinedMoneyValue(
        sale.subtotal,
        sale.grossSubtotal,
        sale.metadata?.grossSubtotal
    );

    if (storedSubtotal) return storedSubtotal;

    return (Array.isArray(items) ? items : []).reduce((subtotal, item) => {
        const storedLineSubtotal = firstDefinedMoneyValue(
            item.exactTotal,
            item.lineSubtotal,
            item.subtotal
        );
        const lineSubtotal = storedLineSubtotal || Money.multiply(item.price || 0, item.quantity || 0);
        return Money.add(subtotal, lineSubtotal);
    }, Money.init(0));
};

const getReceiptDiscountTotal = (sale = {}) => firstDefinedMoneyValue(
    sale.discountTotal,
    sale.discount_total,
    sale.metadata?.discountTotal,
    sale.metadata?.discount_total,
    sale.discount
) || Money.init(0);

const getSaleDiscountDetail = (sale = {}) => {
    const discount = sale.saleDiscount
        || (sale.metadata?.discount && typeof sale.metadata.discount === 'object'
            ? sale.metadata.discount
            : null);

    if (!discount) return '';

    const details = [];
    if (String(discount.type || '').toLowerCase() === 'percent' && discount.value !== undefined) {
        details.push(`${Money.init(discount.value).toString()}%`);
    }

    const reason = String(discount.reason || '').trim();
    if (reason) details.push(reason);

    return details.length > 0 ? ` (${details.join(' · ')})` : '';
};

export async function sendReceiptWhatsApp({
    sale,
    items,
    paymentData,
    total,
    companyName,
    features,
    loadData,
    STORES,
    sendWhatsAppMessage,
    Logger
}) {
    try {
        const customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);
        if (customer && customer.phone) {
            let receiptText = '*--- TICKET DE VENTA ---*\n';
            receiptText += `*Negocio:* ${companyName}\n`;
            receiptText += `*Fecha:* ${new Date().toLocaleString()}\n\n`;
            if (isEcommerceSale(sale)) {
                receiptText += `*Pedido online:* ${getSaleEcommerceOrderCode(sale) || 'Sin código normalizado'}\n`;
            }
            receiptText += `*Folio de venta:* ${getSaleFinancialFolio(sale) || 'Sin folio'}\n\n`;

            if (sale.prescriptionDetails) {
                receiptText += '*--- DATOS DE DISPENSACIÓN ---*\n';
                receiptText += `Dr(a): ${sale.prescriptionDetails.doctorName}\n`;
                receiptText += `Cédula: ${sale.prescriptionDetails.licenseNumber}\n`;
                if (sale.prescriptionDetails.notes) receiptText += `Notas: ${sale.prescriptionDetails.notes}\n`;
                receiptText += '\n';
            }

            receiptText += '*Productos:*\n';
            items.forEach(item => {
                const lineTotal = Money.multiply(item.price, item.quantity);
                receiptText += `• ${item.name} (x${item.quantity}) - $${lineTotal.toFixed(2)}\n`;
                if (features.hasLabFields && item.requiresPrescription) {
                    receiptText += '  _(Antibiótico/Controlado)_\n';
                }
            });

            const discountTotal = getReceiptDiscountTotal(sale);
            if (discountTotal.gt(0)) {
                const subtotal = getReceiptSubtotal(sale, items);
                receiptText += `\n*Subtotal:* $${formatMoney(subtotal)}\n`;
                receiptText += `*Descuento${getSaleDiscountDetail(sale)}:* -$${formatMoney(discountTotal)}\n`;
            }

            receiptText += `\n*TOTAL: $${formatMoney(total)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
                const cambio = Money.subtract(paymentData.amountPaid, total);
                receiptText += `Efectivo recibido: $${formatMoney(paymentData.amountPaid)}\n`;
                receiptText += `Cambio: $${formatMoney(cambio)}\n`;
            } else if (paymentData.paymentMethod === 'fiado') {
                receiptText += `Abono: $${formatMoney(paymentData.amountPaid)}\n`;
                receiptText += `Saldo Pendiente: $${formatMoney(paymentData.saldoPendiente)}\n`;
            }

            receiptText += '\n¡Gracias por su preferencia!';
            sendWhatsAppMessage(customer.phone, receiptText);
        }
    } catch (error) {
        Logger.error('Error enviando ticket:', error);
    }
}
