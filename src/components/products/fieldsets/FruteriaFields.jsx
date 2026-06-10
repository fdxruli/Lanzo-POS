import React from 'react';

export default function FruteriaFields({
    saleType, setSaleType,
    unit, setUnit,
    common
}) {

    // Helper para cambiar el modo y asignar una unidad por defecto lógica
    const handleTypeChange = (type) => {
        setSaleType(type);
        if (type === 'bulk') setUnit('kg');
        if (type === 'unit') setUnit('pza');
    };

    return (
        <div className="fruteria-fields-container" style={{ animation: 'fadeIn 0.3s' }}>

            <label className="form-label" style={{ color: 'var(--primary-color)', fontWeight: 'bold', marginBottom: '10px', display: 'block' }}>
                Configuración de Venta
            </label>

            {/* 1. TIPO DE VENTA */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button
                    type="button"
                    className={`btn ${saleType === 'unit' ? 'btn-save' : 'btn-cancel'}`}
                    style={{
                        flex: 1,
                        border: '1px solid var(--border-color)',
                        opacity: saleType === 'unit' ? 1 : 0.7
                    }}
                    onClick={() => handleTypeChange('unit')}
                >
                    🍎 Por Pieza / Manojo
                </button>

                <button
                    type="button"
                    className={`btn ${saleType === 'bulk' ? 'btn-save' : 'btn-cancel'}`}
                    style={{
                        flex: 1,
                        border: '1px solid var(--border-color)',
                        opacity: saleType === 'bulk' ? 1 : 0.7
                    }}
                    onClick={() => handleTypeChange('bulk')}
                >
                    ⚖️ Por Peso (Granel)
                </button>
            </div>

            {/* 2. SUB-OPCIONES SEGÚN EL TIPO SELECCIONADO */}
            <div style={{
                backgroundColor: 'var(--light-background)',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '15px',
                border: '1px solid var(--border-color)'
            }}>
                <label className="form-label" style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>
                    Unidad de Medida:
                </label>

                {saleType === 'bulk' ? (
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {['kg', 'gr', 'lb'].map(u => (
                            <button
                                key={u} type="button"
                                onClick={() => setUnit(u)}
                                style={{
                                    flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                    backgroundColor: unit === u ? 'var(--card-background-color)' : 'transparent',
                                    fontWeight: unit === u ? 'bold' : 'normal',
                                    color: unit === u ? 'var(--primary-color)' : 'inherit',
                                    boxShadow: unit === u ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                {u.toUpperCase()}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {[
                            { id: 'pza', label: 'Pieza' },
                            { id: 'manojo', label: 'Manojo' },
                            { id: 'bolsa', label: 'Bolsa' },
                            { id: 'caja', label: 'Caja' }
                        ].map(opt => (
                            <button
                                key={opt.id} type="button"
                                onClick={() => setUnit(opt.id)}
                                style={{
                                    flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                    backgroundColor: unit === opt.id ? 'var(--card-background-color)' : 'transparent',
                                    fontWeight: unit === opt.id ? 'bold' : 'normal',
                                    color: unit === opt.id ? 'var(--secondary-color)' : 'inherit',
                                    boxShadow: unit === opt.id ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                                    minWidth: '70px',
                                    cursor: 'pointer'
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* 3. GESTIÓN DE FRESCURA */}
            <div className="form-group" style={{ backgroundColor: '#f0fdf4', padding: '10px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                <label className="form-label" style={{ color: '#15803d' }}>⏳ Vida Útil Promedio (Días)</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                        type="number" 
                        className="form-input" 
                        placeholder="Ej: 7"
                        value={common.shelfLifeValue || ''}
                        onChange={(e) => {
                            const value = Number(e.target.value);

                            if (e.target.value !== '' && Number.isFinite(value) && value > 0) {
                                common.setExpirationMode('SHELF_LIFE');
                                common.setShelfLifeValue(value);
                                common.setShelfLifeUnit('days');
                                return;
                            }

                            common.setExpirationMode('NONE');
                            common.setShelfLifeValue('');
                            common.setShelfLifeUnit(null);
                        }}
                        min="0"
                    />
                    <span style={{ fontSize: '0.8rem', color: '#15803d', lineHeight: '1.2' }}>
                        Días antes de marcar alerta de merma.
                    </span>
                </div>
            </div>
        </div>
    );
}
