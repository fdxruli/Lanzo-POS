import React from 'react';

export default function FarmaciaFields({
    prescriptionType, setPrescriptionType,
    activeSubstance, setActiveSubstance,
    laboratory, setLaboratory
}) {

    // Helper para UX visual del riesgo
    const getRiskLevel = (type) => {
        switch (type) {
            case 'controlled': return { tone: 'danger', label: 'ALTO RIESGO: Controlado' };
            case 'antibiotic': return { tone: 'warning', label: 'MEDIO: Antibiótico' };
            default: return { tone: 'success', label: 'LIBRE: Venta mostrador' };
        }
    };

    const risk = getRiskLevel(prescriptionType);

    return (
        <section className="product-form-section">
            <div className="product-form-section__header">
                <div className="product-form-section__heading">
                    <h4 className="product-form-section__title">Datos farmacéuticos</h4>
                    <p className="product-form-section__subtitle">
                        Clasifica el producto y completa datos útiles para control sanitario.
                    </p>
                </div>
            </div>
            
            {/* SELECTOR DE TIPO CON FEEDBACK VISUAL */}
            <div className={`product-form-alert product-form-alert--${risk.tone} product-form-risk-card`}>
                <label className="form-label">
                    Tipo de venta / regulación
                </label>
                <select 
                    className={`form-input product-form-risk-select is-${risk.tone}`}
                    value={prescriptionType} 
                    onChange={(e) => setPrescriptionType(e.target.value)}
                >
                    <option value="otc">Venta libre (OTC)</option>
                    <option value="antibiotic">Antibiótico (requiere receta simple)</option>
                    <option value="controlled">Medicamento controlado (receta retenida)</option>
                </select>
                
                <div className="product-form-risk-help">
                    <strong>{risk.label}</strong>{' '}
                    {prescriptionType === 'otc' && 'Producto sin restricciones de venta.'}
                    {prescriptionType === 'antibiotic' && 'El POS solicitará obligatoriamente cédula médica al vender.'}
                    {prescriptionType === 'controlled' && 'El POS exigirá cédula, dirección y datos completos del paciente.'}
                </div>
            </div>

            <div className="form-grid-2">
                <div className="form-group">
                    <label className="form-label">Sustancia activa (genérico)</label>
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

            <div className="product-form-alert product-form-alert--info">
                <div className="product-form-alert__content">
                    <p>
                        La <strong>fecha de caducidad</strong> se registra individualmente al dar de alta cada <strong>lote</strong> en la sección de Inventario.
                    </p>
                </div>
            </div>
        </section>
    );
}
