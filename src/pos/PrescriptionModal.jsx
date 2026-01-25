import React, { useState } from 'react';

export default function PrescriptionModal({ show, onClose, onConfirm, itemsRequiringPrescription }) {
    const [doctorName, setDoctorName] = useState('');
    const [licenseNumber, setLicenseNumber] = useState(''); // Cédula Profesional
    const [notes, setNotes] = useState('');

    if (!show) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!doctorName || !licenseNumber) {
            alert("El nombre del médico y la cédula son obligatorios para antibióticos/controlados.");
            return;
        }
        onConfirm({ doctorName, licenseNumber, notes });
    };

    return (
        <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-critical)' }}>
            <div className="modal-content" style={{ maxWidth: '500px', borderLeft: '5px solid var(--warning-color)' }}>
                <h2 className="modal-title">⚠️ Medicamento Controlado</h2>
                <p style={{ marginBottom: '15px', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                    Los siguientes productos requieren receta médica. Por normativa, ingresa los datos del médico prescriptor:
                </p>

                <ul style={{ background: '#fff3cd', padding: '10px 20px', borderRadius: '8px', marginBottom: '20px', listStyle: 'disc' }}>
                    {itemsRequiringPrescription.map(item => (
                        <li key={item.id} style={{ color: '#856404', fontWeight: '600' }}>
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

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar Venta</button>
                        <button type="submit" className="btn btn-save">Confirmar y Cobrar</button>
                    </div>
                </form>
            </div>
        </div>
    );
}