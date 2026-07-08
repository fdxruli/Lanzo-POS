import React, { useState } from 'react';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { showMessageModal } from '../../services/utils';
import './PrescriptionModal.css';

export default function PrescriptionModal({ show, onClose, onConfirm, itemsRequiringPrescription }) {
    const [doctorName, setDoctorName] = useState('');
    const [licenseNumber, setLicenseNumber] = useState(''); // Cédula Profesional
    const [notes, setNotes] = useState('');

    if (!show) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!doctorName || !licenseNumber) {
            showMessageModal("El nombre del médico y la cédula son obligatorios para antibióticos/controlados.", null, { type: 'warning' });
            return;
        }
        onConfirm({ doctorName, licenseNumber, notes });
    };

    return (
        <div className="ui-modal ui-modal--critical prescription-modal-overlay" role="dialog" aria-modal="true" aria-label="Medicamento controlado">
            <div className="ui-modal__content prescription-modal">
                <h2 className="modal-title">⚠️ Medicamento Controlado</h2>
                <p className="ui-modal__subtitle prescription-modal__intro">
                    Los siguientes productos requieren receta médica. Por normativa, ingresa los datos del médico prescriptor:
                </p>

                <ul className="ui-alert ui-alert--warning prescription-modal__items">
                    {itemsRequiringPrescription.map((item, index) => (
                        <li key={getCartLineId(item, index)}>
                            {item.name}
                        </li>
                    ))}
                </ul>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label">Nombre del Médico *</label>
                        <input
                            type="text"
                            className="form-input"
                            required
                            placeholder="Ej: Dr. Juan Pérez"
                            value={doctorName}
                            onChange={e => setDoctorName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Cédula Profesional *</label>
                        <input
                            type="text"
                            className="form-input"
                            required
                            placeholder="Ej: 12345678"
                            value={licenseNumber}
                            onChange={e => setLicenseNumber(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Notas Adicionales (Opcional)</label>
                        <textarea
                            className="form-textarea"
                            rows="2"
                            placeholder="Ej: Folio receta, observaciones..."
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                        ></textarea>
                    </div>

                    <div className="ui-modal__actions prescription-modal__actions">
                        <button type="button" className="ui-button ui-button--ghost btn btn-cancel" onClick={onClose}>Cancelar Venta</button>
                        <button type="submit" className="ui-button ui-button--primary btn btn-save">Confirmar y Cobrar</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
