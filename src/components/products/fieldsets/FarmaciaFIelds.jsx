import React from 'react';

export default function FarmaciaFields({
  sustancia, setSustancia,
  laboratorio, setLaboratorio,
  requiresPrescription, setRequiresPrescription,
  presentation, setPresentation
}) {
  return (
    <div className="specific-data-container">
      <h4 className="subtitle" style={{ fontSize: '1rem', color: 'var(--primary-color)', marginBottom: '1rem', borderBottom: '1px dashed #eee', paddingBottom: '5px' }}>
        Detalles de Farmacia
      </h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="product-sustancia">Sustancia Activa</label>
          <input
            className="form-input"
            id="product-sustancia"
            type="text"
            placeholder="Ej: Paracetamol"
            value={sustancia}
            onChange={(e) => setSustancia(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="product-laboratorio">Laboratorio</label>
          <input
            className="form-input"
            id="product-laboratorio"
            type="text"
            placeholder="Ej: Bayer / Genérico"
            value={laboratorio}
            onChange={(e) => setLaboratorio(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="product-presentation">Presentación</label>
        <input
          className="form-input"
          id="product-presentation"
          type="text"
          placeholder="Ej: Caja con 20 tabletas de 500mg"
          value={presentation}
          onChange={(e) => setPresentation(e.target.value)}
        />
      </div>

      <div className="form-group-checkbox" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', backgroundColor: 'var(--light-background)', borderRadius: '8px' }}>
        <input
          id="product-prescription"
          type="checkbox"
          style={{ width: '20px', height: '20px' }}
          checked={requiresPrescription}
          onChange={(e) => setRequiresPrescription(e.target.checked)}
        />
        <label htmlFor="product-prescription" style={{ margin: 0, fontWeight: '600', color: requiresPrescription ? 'var(--error-color)' : 'inherit' }}>
          ⚠️ Requiere Receta Médica (Antibiótico/Controlado)
        </label>
      </div>
    </div>
  );
}