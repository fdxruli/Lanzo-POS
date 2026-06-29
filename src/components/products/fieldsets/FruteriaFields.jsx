import React from 'react';

export default function FruteriaFields({ saleType, setSaleType, unit, setUnit, common }) {
    const handleTypeChange = (type) => {
        setSaleType(type);
        if (type === 'bulk') setUnit('kg');
        if (type === 'unit') setUnit('pza');
    };

    return (
        <div className="fruteria-fields-container">
            <label className="product-form-fieldset-title">Configuración de venta</label>

            <div className="product-form-choice-grid" style={{ marginTop: '10px', marginBottom: '15px' }}>
                <button
                    type="button"
                    className={`product-form-choice ${saleType === 'unit' ? 'is-active' : ''}`}
                    onClick={() => handleTypeChange('unit')}
                >
                    Por pieza / unidad
                </button>

                <button
                    type="button"
                    className={`product-form-choice ${saleType === 'bulk' ? 'is-active' : ''}`}
                    onClick={() => handleTypeChange('bulk')}
                >
                    Por peso
                </button>
            </div>

            <div className="product-form-option-panel" style={{ marginBottom: '15px' }}>
                <label className="form-label">Unidad de medida:</label>

                {saleType === 'bulk' ? (
                    <div className="product-form-chip-row">
                        {['kg', 'gr', 'lb'].map(u => (
                            <button
                                key={u}
                                type="button"
                                onClick={() => setUnit(u)}
                                className={`product-form-chip ${unit === u ? 'is-active' : ''}`}
                            >
                                {u.toUpperCase()}
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="product-form-chip-row">
                        {[
                            { id: 'pza', label: 'Pieza' },
                            { id: 'manojo', label: 'Manojo' },
                            { id: 'bolsa', label: 'Bolsa' },
                            { id: 'caja', label: 'Caja' }
                        ].map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setUnit(opt.id)}
                                className={`product-form-chip ${unit === opt.id ? 'is-active' : ''}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="product-form-alert product-form-alert--success product-form-risk-card">
                <label className="form-label">Vida útil promedio (días)</label>
                <div className="product-form-field-row product-form-field-row--wrap">
                    <input
                        type="number"
                        className="form-input product-form-field-grow"
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
                    <span className="product-form-help">Días antes de marcar alerta de merma.</span>
                </div>
            </div>
        </div>
    );
}
