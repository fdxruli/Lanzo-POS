import React from 'react';

export default function FarmaciaFields({
    prescriptionType, setPrescriptionType,
    activeSubstance, setActiveSubstance,
    laboratory, setLaboratory
}) {

    // Helper para UX visual del riesgo
    const getRiskLevel = (type) => {
        switch (type) {
            case 'controlled': return { color: '#ef4444', bg: '#fef2f2', label: '🔴 ALTO RIESGO: Controlado', icon: '🔒' };
            case 'antibiotic': return { color: '#f97316', bg: '#fff7ed', label: '🟠 MEDIO: Antibiótico', icon: '💊' };
            default: return { color: '#22c55e', bg: '#f0fdf4', label: '🟢 LIBRE: Venta mostrador', icon: '🛒' };
        }
    };

    const risk = getRiskLevel(prescriptionType);

    return (
        <div className="module-fieldset">
            <h4 className="subtitle">💊 Datos Farmacéuticos</h4>
            
            {/* SELECTOR DE TIPO CON FEEDBACK VISUAL */}
            <div style={{ 
                marginBottom: '15px', 
                padding: '12px', 
                backgroundColor: risk.bg, 
                border: `1px solid ${risk.color}`, 
                borderRadius: '8px',
                transition: 'all 0.3s ease'
            }}>
                <label className="form-label" style={{color: risk.color, fontWeight: 'bold'}}>
                    Tipo de Venta / Regulación
                </label>
                <select 
                    className="form-input" 
                    value={prescriptionType} 
                    onChange={(e) => setPrescriptionType(e.target.value)}
                    style={{ borderColor: risk.color, fontWeight: '600' }}
                >
                    <option value="otc">🟢 Venta Libre (OTC)</option>
                    <option value="antibiotic">🟠 Antibiótico (Requiere Receta Simple)</option>
                    <option value="controlled">🔴 Medicamento Controlado (Receta Retenida)</option>
                </select>
                
                <div style={{ marginTop: '8px', fontSize: '0.85rem', color: risk.color, display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.2rem' }}>{risk.icon}</span>
                    <span>
                        {prescriptionType === 'otc' && 'Producto sin restricciones de venta.'}
                        {prescriptionType === 'antibiotic' && 'El POS solicitará obligatoriamente Cédula Médica al vender.'}
                        {prescriptionType === 'controlled' && 'El POS exigirá Cédula, Dirección y datos completos del paciente.'}
                    </span>
                </div>
            </div>

            <div className="form-grid-2">
                <div className="form-group">
                    <label className="form-label">Sustancia Activa (Genérico)</label>
                    <input 
                        type="text" 
                        className="form-input" 
                        value={activeSubstance} 
                        onChange={(e) => setActiveSubstance(e.target.value)}
                        placeholder="Ej: Paracetamol" 
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">Laboratorio</label>
                    <input 
                        type="text" 
                        className="form-input" 
                        value={laboratory} 
                        onChange={(e) => setLaboratory(e.target.value)}
                        placeholder="Ej: Bayer, Genomma..." 
                    />
                </div>
            </div>

            <div style={{
                padding: '10px 12px',
                backgroundColor: '#eff6ff',
                borderRadius: '6px',
                border: '1px solid #bfdbfe',
                fontSize: '0.85rem',
                color: '#1e40af',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                <span style={{ fontSize: '1.1rem' }}>📋</span>
                <span>
                    La <strong>fecha de caducidad</strong> se registra individualmente al dar de alta cada <strong>Lote</strong> en la sección de Inventario.
                </span>
            </div>
        </div>
    );
}