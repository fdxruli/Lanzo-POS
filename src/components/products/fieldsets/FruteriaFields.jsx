import React from 'react';

export default function FruteriaFields({
    saleType, setSaleType,
    price, setPrice,
    cost, setCost,
    shelfLife, setShelfLife,
    unit, setUnit
}) {

    // Calculadora rápida de margen
    const handleMarginChange = (e) => {
        const margin = parseFloat(e.target.value);
        const numericCost = parseFloat(cost);
        if (!isNaN(margin) && !isNaN(numericCost) && numericCost > 0) {
            const newPrice = numericCost * (1 + (margin / 100));
            setPrice(newPrice.toFixed(2));
        }
    };

    return (
        <div className="fruteria-fields-container" style={{ animation: 'fadeIn 0.3s' }}>

            {/* 1. TIPO DE VENTA (Visualmente claro) */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button
                    type="button"
                    className={`btn ${saleType === 'bulk' ? 'btn-save' : 'btn-cancel'}`}
                    style={{ flex: 1, border: '1px solid var(--primary-color)' }}
                    onClick={() => { setSaleType('bulk'); setUnit('kg'); }}
                >
                    ⚖️ Por Peso (Granel/Kg)
                </button>
                <button
                    type="button"
                    className={`btn ${saleType === 'unit' ? 'btn-save' : 'btn-cancel'}`}
                    style={{ flex: 1, border: '1px solid var(--primary-color)' }}
                    onClick={() => { setSaleType('unit'); setUnit('pza'); }}
                >
                    🍎 Por Pieza / Manojo
                </button>
            </div>

            {/* 2. PRECIOS DIARIOS */}
            <div style={{
                backgroundColor: '#fff7ed', // Naranja muy suave
                padding: '15px',
                borderRadius: '8px',
                border: '1px solid #fdba74',
                marginBottom: '15px'
            }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#c2410c', fontSize: '0.95rem' }}>📅 Precios del Día</h4>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                        <label className="form-label">Costo Mercado ($)</label>
                        <input
                            type="number" className="form-input" placeholder="0.00" step="0.50"
                            value={cost} onChange={(e) => setCost(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, width: '70px' }}>
                        <label className="form-label">Margen %</label>
                        <input type="number" className="form-input" placeholder="%" onChange={handleMarginChange} />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                        <label className="form-label">Precio Venta ($)</label>
                        <input
                            type="number" className="form-input" placeholder="0.00"
                            value={price} onChange={(e) => setPrice(e.target.value)}
                            style={{ fontWeight: 'bold', color: 'var(--success-color)', fontSize: '1.1rem' }}
                        />
                    </div>
                </div>
                <small style={{ display: 'block', marginTop: '5px', color: '#777' }}>
                    * El costo puede variar mañana.
                </small>
            </div>

            {/* 3. GESTIÓN DE FRESCURA */}
            <div className="form-group" style={{ backgroundColor: '#f0fdf4', padding: '10px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                <label className="form-label" style={{ color: '#15803d' }}>⏳ Vida Útil Promedio (Días)</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                        type="number" className="form-input" placeholder="Ej: 7 (para calcular caducidad auto)"
                        value={shelfLife} onChange={(e) => setShelfLife(e.target.value)}
                    />
                    <span style={{ fontSize: '0.8rem', color: '#15803d' }}>
                        Esto ayudará a alertar antes de que se eche a perder.
                    </span>
                </div>
            </div>
        </div>
    );
}