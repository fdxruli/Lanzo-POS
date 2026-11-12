import { describe, expect, it } from 'vitest';
import {
  localSaleToCloudShadowPayload,
  mapLocalCheckoutToCloudSale,
  mapLocalCreditCheckoutToCloudSale
} from '../../salesCloud/salesCloudCashierMapper';

const prescription = {
  version: 1,
  reference: 'RX-001',
  prescriberName: 'Profesional Ejemplo',
  prescriberLicense: '12345678',
  prescriberAddress: 'Domicilio de prueba',
  issuedOn: '2026-11-01',
  treatmentUntil: '2026-12-01',
  prescribedQuantity: 20,
  stampDeclared: true,
  retentionDeclared: false
};
const item = {
  id: 'med-1',
  productId: 'med-1',
  name: 'Medicamento',
  quantity: 5,
  price: 10,
  pharmacyDispensationV1: prescription
};
const sale = {
  id: 'sale-1', timestamp: '2026-11-11T12:00:00.000Z',
  subtotal: 50, total: 50, paymentMethod: 'efectivo',
  items: [item]
};
describe('Etapa 3: frontera de metadatos farmacéuticos Cloud', () => {
  it('transmite la receta en el checkout Cloud con efectivo', () => {
    const result = mapLocalCheckoutToCloudSale({
      sale, processedItems: [item],
      paymentData: { paymentMethod: 'cash', amountPaid: 50, receivedAmount: 50 },
      total: 50, inventoryEnabled: true
    });
    expect(result.items[0].metadata.pharmacyDispensationV1).toMatchObject({
      version: 1, reference: 'RX-001', prescribedQuantity: 20
    });
  });
  it('transmite la receta en el checkout de crédito Cloud', () => {
    const result = mapLocalCreditCheckoutToCloudSale({
      sale: { ...sale, paymentMethod: 'fiado' },
      processedItems: [item], paymentData: { paymentMethod: 'credit', amountPaid: 0 }, total: 50,
      inventoryEnabled: true
    });
    expect(result.items[0].metadata.pharmacyDispensationV1).toEqual(prescription);
  });
  it('la sincronización shadow no fabrica dispensaciones Cloud', () => {
    const result = localSaleToCloudShadowPayload(sale, { deviceId: 'device-1' });
    expect(result.items[0].metadata.pharmacyDispensationV1).toBeUndefined();
  });
});
