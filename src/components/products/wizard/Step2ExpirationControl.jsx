const REQUIRED_EXPIRATION_RUBROS = new Set([
    'farmacia',
    'consultorio',
    'food_service',
    'restaurante',
    'cafeteria',
    'verduleria/fruteria'
]);

const MODE_OPTIONS = [
    {
        value: 'STRICT',
        label: 'Por lote',
        description: 'Requiere fecha de caducidad al recibir inventario.'
    },
    {
        value: 'SHELF_LIFE',
        label: 'Vida util',
        description: 'Calcula caducidad con dias o meses desde recepcion.'
    }
];

export default function Step2ExpirationControl({ wizard, activeRubroContext }) {
    if (!REQUIRED_EXPIRATION_RUBROS.has(activeRubroContext)) return null;

    const {
        expirationMode,
        setExpirationMode,
        shelfLifeValue,
        setShelfLifeValue,
        shelfLifeUnit,
        setShelfLifeUnit,
        step2Errors
    } = wizard;

    const handleModeChange = (mode) => {
        setExpirationMode(mode);

        if (mode === 'STRICT') {
            setShelfLifeValue('');
            setShelfLifeUnit('days');
        }
    };

    return (
        <div style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderRadius: '12px',
            border: `2px solid ${step2Errors?.expirationMode || step2Errors?.shelfLifeValue ? 'var(--error-color)' : '#fcd34d'}`
        }}>
            <h4 style={{
                margin: '0 0 8px 0',
                fontSize: '0.95rem',
                color: '#92400e',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}>
                Caducidad requerida
            </h4>
            <p style={{
                margin: '0 0 12px 0',
                fontSize: '0.85rem',
                color: '#92400e'
            }}>
                Este rubro necesita una politica de caducidad antes de guardar el producto.
            </p>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '10px'
            }}>
                {MODE_OPTIONS.map((option) => {
                    const isSelected = expirationMode === option.value;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => handleModeChange(option.value)}
                            style={{
                                padding: '12px',
                                borderRadius: '8px',
                                border: `2px solid ${isSelected ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--card-background-color)',
                                color: isSelected ? 'var(--primary-color)' : 'var(--text-dark)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.2s'
                            }}
                        >
                            <span style={{ display: 'block', fontWeight: '700', fontSize: '0.9rem' }}>
                                {option.label}
                            </span>
                            <span style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: 'var(--text-light)' }}>
                                {option.description}
                            </span>
                        </button>
                    );
                })}
            </div>

            {expirationMode === 'SHELF_LIFE' && (
                <div style={{
                    marginTop: '12px',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(120px, 1fr) minmax(110px, 140px)',
                    gap: '10px',
                    alignItems: 'end'
                }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Vida util
                        </label>
                        <input
                            type="number"
                            className="form-input"
                            value={shelfLifeValue}
                            onChange={(event) => setShelfLifeValue(event.target.value)}
                            placeholder="Ej: 7"
                            min="1"
                            step="1"
                            style={{
                                borderColor: step2Errors?.shelfLifeValue ? 'var(--error-color)' : 'var(--border-color)'
                            }}
                        />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Unidad
                        </label>
                        <select
                            className="form-input"
                            value={shelfLifeUnit || 'days'}
                            onChange={(event) => setShelfLifeUnit(event.target.value)}
                        >
                            <option value="days">Dias</option>
                            <option value="months">Meses</option>
                        </select>
                    </div>
                </div>
            )}

            {(step2Errors?.expirationMode || step2Errors?.shelfLifeValue) && (
                <span style={{
                    color: 'var(--error-color)',
                    fontSize: '0.85rem',
                    marginTop: '8px',
                    display: 'block'
                }}>
                    {step2Errors.expirationMode || step2Errors.shelfLifeValue}
                </span>
            )}
        </div>
    );
}
