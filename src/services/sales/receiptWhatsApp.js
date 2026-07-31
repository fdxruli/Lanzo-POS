import { Money } from '../../utils/moneyMath';
import {
    getSaleEcommerceOrderCode,
    getSaleFinancialFolio,
    isEcommerceSale
} from './saleReference';

const formatMoney = (value) => Money.init(value).toFixed(2);

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

            receiptText += `\n*TOTAL: $${formatMoney(total)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
                const cambio = Money.subtract(paymentData.amountPaid, total);
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
