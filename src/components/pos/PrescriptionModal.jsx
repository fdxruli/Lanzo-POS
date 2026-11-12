import React, { useEffect, useState } from 'react';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { validatePharmacyLine } from '../../services/pharmacy/pharmacyDispensation';
import { getPharmacyPrescriptionHistory } from '../../services/pharmacy/pharmacyPrescriptionLookup';
import './PrescriptionModal.css';

const EMPTY_RX = {
  reference: '', prescriberName: '', prescriberLicense: '', prescriberAddress: '',
  issuedOn: '', treatmentUntil: '', prescribedQuantity: '',
  stampDeclared: false, retentionDeclared: false
};
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const warningFor = (error) => {
  const code = String(error?.message || '');
  if (code === 'PHARMACY_PRESCRIPTION_STAMP_REQUIRED') return 'Confirma que sellaste físicamente la receta.';
  if (code === 'PHARMACY_PRESCRIPTION_QUANTITY_INVALID') return 'La cantidad prescrita debe cubrir lo que se surtirá.';
  if (code.startsWith('PHARMACY_RX_INVALID_')) return 'Completa correctamente los campos obligatorios de la receta.';
  if (code === 'PHARMACY_PRESCRIPTION_DATES_INVALID') return 'Verifica las fechas de expedición y vigencia.';
  return code || 'No se pudo verificar la receta.';
};

export default function PrescriptionModal({ show, onClose, onConfirm, itemsRequiringPrescription = [] }) {
  const [entries, setEntries] = useState({});
  const [history, setHistory] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!show) { setEntries({}); setHistory({}); setErrors({}); setLoading(false); }
  }, [show]);
  if (!show) return null;

  const change = (index, key, value) => {
    setEntries(prev => ({ ...prev, [index]: { ...EMPTY_RX, ...(prev[index] || {}), [key]: value } }));
    setErrors(prev => ({ ...prev, [index]: '' }));
    if (['reference', 'prescriberLicense', 'issuedOn', 'prescribedQuantity'].includes(key)) {
      setHistory(prev => ({ ...prev, [index]: null }));
    }
  };
  const lookup = async (item, current) => {
    const result = await getPharmacyPrescriptionHistory({
      reference: current.reference,
      prescriberLicense: current.prescriberLicense,
      issuedOn: current.issuedOn,
      productId: item.productId || item.parentId || item.id
    });
    if (result?.found && Number(result.prescribedQuantity) !== Number(current.prescribedQuantity)) {
      throw new Error('La cantidad prescrita no coincide con el registro anterior.');
    }
    if (result?.found && ['retained', 'void'].includes(result.status)) {
      throw new Error('Esta receta está retenida o anulada; no puede reutilizarse.');
    }
    if (result?.found && Number(result.remainingQuantity) < Number(item.quantity)) {
      throw new Error('El surtido solicitado excede el saldo restante de la receta.');
    }
    return result;
  };
  const inspect = async (item, index) => {
    setLoading(true);
    setErrors(prev => ({ ...prev, [index]: '' }));
    try {
      const result = await lookup(item, { ...EMPTY_RX, ...(entries[index] || {}) });
      setHistory(prev => ({ ...prev, [index]: result }));
    } catch (error) {
      setErrors(prev => ({ ...prev, [index]: warningFor(error) }));
    } finally { setLoading(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    const nextErrors = {};
    const verified = {};
    const nextHistory = { ...history };
    try {
      for (const item of itemsRequiringPrescription) {
        const index = item.prescriptionOrderIndex;
        try {
          const rx = validatePharmacyLine({ ...EMPTY_RX, ...(entries[index] || {}) }, item.quantity, { antibiotic: item.rxAntibiotic });
          const result = await lookup(item, rx);
          const used = num(result?.dispensedQuantity);
          if (item.rxAntibiotic && used + num(item.quantity) === Number(rx.prescribedQuantity) && !rx.retentionDeclared) {
            throw new Error('Declara la retención física cuando se agota la cantidad prescrita.');
          }
          verified[index] = rx;
          nextHistory[index] = result;
        } catch (error) {
          nextErrors[index] = warningFor(error);
        }
      }
      setErrors(nextErrors);
      setHistory(nextHistory);
      if (!Object.keys(nextErrors).length) onConfirm({ version: 1, lines: verified });
    } finally { setLoading(false); }
  };

  return (
    <div className="ui-modal ui-modal--critical prescription-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="prescription-title">
      <div className="ui-modal__content prescription-modal">
        <header className="prescription-modal__header">
          <h2 id="prescription-title">Receta médica</h2>
          <p>Revisa los surtidos antes de cobrar. El registro no sustituye el documento físico.</p>
        </header>
        <form onSubmit={submit}>
          {itemsRequiringPrescription.map((item, ordinal) => {
            const index = item.prescriptionOrderIndex ?? ordinal;
            const current = { ...EMPTY_RX, ...(entries[index] || {}) };
            const found = history[index];
            const remaining = found?.found ? Number(found.remainingQuantity) : num(current.prescribedQuantity);
            return (
              <section className="prescription-modal__medicine" key={getCartLineId(item, index)} aria-label={item.name}>
                <div className="prescription-modal__medicine-head">
                  <strong>{item.name}</strong>
                  <span>{num(item.quantity)} unidad(es) a surtir</span>
                </div>
                <div className="prescription-modal__grid">
                  <label>Folio o referencia de receta *
                    <input required maxLength={100} value={current.reference} onChange={e => change(index, 'reference', e.target.value)} placeholder="Ej. RX-001" />
                  </label>
                  <label>Fecha de expedición *
                    <input required type="date" value={current.issuedOn} onChange={e => change(index, 'issuedOn', e.target.value)} />
                  </label>
                  <label>Nombre del prescriptor *
                    <input required maxLength={180} value={current.prescriberName} onChange={e => change(index, 'prescriberName', e.target.value)} />
                  </label>
                  <label>Cédula profesional (declarada) *
                    <input required maxLength={40} value={current.prescriberLicense} onChange={e => change(index, 'prescriberLicense', e.target.value)} />
                  </label>
                  <label className="prescription-modal__wide">Domicilio del prescriptor *
                    <input required maxLength={240} value={current.prescriberAddress} onChange={e => change(index, 'prescriberAddress', e.target.value)} />
                  </label>
                  <label>Vigencia del tratamiento *
                    <input required type="date" value={current.treatmentUntil} onChange={e => change(index, 'treatmentUntil', e.target.value)} />
                  </label>
                  <label>Cantidad prescrita *
                    <input required min="0.001" step="0.001" type="number" inputMode="decimal" value={current.prescribedQuantity} onChange={e => change(index, 'prescribedQuantity', e.target.value)} />
                  </label>
                </div>
                <div className="prescription-modal__lookup">
                  <button type="button" className="ui-button ui-button--secondary" disabled={loading || !current.reference || !current.prescriberLicense || !current.issuedOn || !current.prescribedQuantity} onClick={() => inspect(item, index)}>Consultar surtidos</button>
                  {found && <span role="status">{found.found
                    ? 'Surtido: ' + num(found.dispensedQuantity) + ' · Restante: ' + remaining
                    : 'Sin surtidos registrados · Prescrito: ' + remaining}</span>}
                </div>
                {found?.found && Array.isArray(found.history) && found.history.length > 0 && (
                  <details className="prescription-modal__history">
                    <summary>Historial ({found.history.length})</summary>
                    <ul>{found.history.map((row, i) => (
                      <li key={row.saleItemId || String(row.saleId) + ':' + i}>
                        {new Date(row.dispensedAt).toLocaleDateString('es-MX')}: {row.quantity} u. · Venta {row.saleId} · Lote {row.batchId || 'sin dato'}
                      </li>
                    ))}</ul>
                  </details>
                )}
                {item.rxAntibiotic && (
                  <div className="prescription-modal__checks">
                    <label><input type="checkbox" checked={current.stampDeclared} onChange={e => change(index, 'stampDeclared', e.target.checked)} /> Confirmo que sellé físicamente la receta para este surtido.</label>
                    <label><input type="checkbox" checked={current.retentionDeclared} onChange={e => change(index, 'retentionDeclared', e.target.checked)} /> Confirmo su retención física cuando corresponda.</label>
                  </div>
                )}
                {errors[index] && <p className="prescription-modal__error" role="alert">{errors[index]}</p>}
              </section>
            );
          })}
          <div className="ui-modal__actions prescription-modal__actions">
            <button type="button" className="ui-button ui-button--ghost" disabled={loading} onClick={onClose}>Cancelar</button>
            <button type="submit" className="ui-button ui-button--primary" disabled={loading}>{loading ? 'Verificando…' : 'Continuar al cobro'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
