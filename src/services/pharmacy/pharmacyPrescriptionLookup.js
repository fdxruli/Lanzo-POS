import { supabaseClient } from '../supabase';
import { db, STORES } from '../db/dexie';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { getLicenseKeyFromDetails } from '../sync/syncConstants';
import { salesCloudCashierService } from '../salesCloud/salesCloudCashierService';
import { useAppStore } from '../../store/useAppStore';
import { prescriptionDocumentKey } from './pharmacyDispensation';

// Consulta de SOLO LECTURA. Nunca reserva o descuenta saldo.
export const getPharmacyPrescriptionHistory = async ({
  reference, prescriberLicense, issuedOn, productId
} = {}) => {
  if (!reference?.trim() || !prescriberLicense?.trim() || !issuedOn || !productId) {
    throw new Error('Completa folio, cédula, fecha y medicamento antes de consultar.');
  }
  if (await salesCloudCashierService.requiresCloudPharmacyAuthority()) {
    const licenseKey = getLicenseKeyFromDetails(useAppStore.getState().licenseDetails);
    if (!supabaseClient || !licenseKey || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new Error('Se requiere conexión Cloud para consultar esta receta.');
    }
    const auth = await buildPosSyncAuthContext({ licenseKey });
    if (!auth.deviceFingerprint || !auth.securityToken) {
      throw new Error('No se pudo verificar la sesión del dispositivo.');
    }
    const { data, error } = await supabaseClient.rpc('pos_pharmacy_get_prescription_v1', {
      p_license_key: auth.licenseKey,
      p_device_fingerprint: auth.deviceFingerprint,
      p_security_token: auth.securityToken,
      p_staff_session_token: auth.staffSessionToken || null,
      p_reference: reference.trim(),
      p_prescriber_license: prescriberLicense.trim(),
      p_issued_on: issuedOn,
      p_product_id: String(productId)
    });
    if (error) throw new Error('No se pudo consultar la receta en Cloud.');
    if (data?.success !== true) throw new Error('La receta no pudo verificarse.');
    return data;
  }

  const key = prescriptionDocumentKey({ reference, prescriberLicense, issuedOn });
  const sales = await db.table(STORES.SALES).toArray();
  const history = [];
  let first = null;
  let quantity = 0;
  let retained = false;
  for (const sale of sales) {
    if (sale.status !== 'closed') continue;
    for (const item of sale.items || []) {
      const rx = item.pharmacyDispensationV1;
      if (!rx || prescriptionDocumentKey(rx) !== key) continue;
      if (!first) first = rx;
      if (rx.retentionDeclared === true) retained = true;
      if (String(item.parentId || item.productId || item.id) !== String(productId)) continue;
      quantity += Number(item.quantity) || 0;
      history.push({
        saleId: sale.id, saleItemId: item.lineId || item.cartLineId || null,
        batchId: item.batchId || item.batchesUsed?.[0]?.batchId || null,
        quantity: Number(item.quantity), dispensedAt: sale.timestamp,
        stampDeclared: rx.stampDeclared, retentionDeclared: rx.retentionDeclared
      });
    }
  }
  return first ? {
    success: true, found: true, reference: first.reference,
    prescriberName: first.prescriberName, prescriberLicense: first.prescriberLicense,
    prescriberAddress: first.prescriberAddress, issuedOn: first.issuedOn,
    treatmentUntil: first.treatmentUntil,
    prescribedQuantity: first.prescribedQuantity,
    dispensedQuantity: quantity, remainingQuantity: Number(first.prescribedQuantity) - quantity,
    status: retained ? 'retained' : 'active', history: history.sort((a, b) => String(b.dispensedAt).localeCompare(String(a.dispensedAt)))
  } : { success: true, found: false, dispensedQuantity: 0, history: [] };
};
