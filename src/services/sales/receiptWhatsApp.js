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

            if (sale.prescriptionDetails) {
                receiptText += '*--- DATOS DE DISPENSACIÓN ---*\n';
                receiptText += `Dr(a): ${sale.prescriptionDetails.doctorName}\n`;
                receiptText += `Cédula: ${sale.prescriptionDetails.licenseNumber}\n`;
                if (sale.prescriptionDetails.notes) receiptText += `Notas: ${sale.prescriptionDetails.notes}\n`;
                receiptText += '\n';
            }

            receiptText += '*Productos:*\n';
            items.forEach(item => {
                receiptText += `• ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
                if (features.hasLabFields && item.requiresPrescription) {
                    receiptText += '  _(Antibiótico/Controlado)_\n';
                }
            });

            receiptText += `\n*TOTAL: $${total.toFixed(2)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
                const cambio = parseFloat(paymentData.amountPaid) - total;
                receiptText += `Cambio: $${cambio.toFixed(2)}\n`;
            } else if (paymentData.paymentMethod === 'fiado') {
                receiptText += `Abono: $${parseFloat(paymentData.amountPaid).toFixed(2)}\n`;
                receiptText += `Saldo Pendiente: $${parseFloat(paymentData.saldoPendiente).toFixed(2)}\n`;
            }

            receiptText += '\n¡Gracias por su preferencia!';
            sendWhatsAppMessage(customer.phone, receiptText);
        }
    } catch (error) {
        Logger.error('Error enviando ticket:', error);
    }
}
