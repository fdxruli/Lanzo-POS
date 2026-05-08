import React from 'react';
import { useProductQuestions } from '../../../hooks/useProductQuestions';
import SmartQuestions from './SmartQuestions';
import DynamicHelp from './DynamicHelp';

const COMMON_UNITS = [
    { val: 'pza', label: 'Pieza (pza)' },
    { val: 'kg', label: 'Kilogramos (kg)' },
    { val: 'lt', label: 'Litros (L)' },
    { val: 'mt', label: 'Metros (m)' },
    { val: 'gr', label: 'Gramos (gr)' },
    { val: 'ml', label: 'Mililitros (ml)' },
    { val: 'gal', label: 'Galón (gal)' },
    { val: 'cm', label: 'Centímetros (cm)' },
    { val: 'manojo', label: 'Manojo' },
    { val: 'bolsa', label: 'Bolsa' },
    { val: 'caja', label: 'Caja' }
];

export default function Step2Inventario({
    wizard,
    activeRubroContext
}) {
    const {
        doesTrackStock, setDoesTrackStock,
        stock, setStock,
        minStock, setMinStock,
        saleType, setSaleType,
        unit, setUnit,
        supplier, setSupplier,
        storageLocation, setStorageLocation,
        step2Errors
    } = wizard;

    // Integrar preguntas inteligentes
    const questions = useProductQuestions(activeRubroContext, { saleType, unit });
    const { derivedConfig } = questions;

    // Sincronizar respuestas con el wizard
    if (derivedConfig.saleType && derivedConfig.saleType !== saleType) {
        setSaleType(derivedConfig.saleType);
    }
    if (derivedConfig.unit && derivedConfig.unit !== unit) {
        setUnit(derivedConfig.unit);
    }

    // Determinar si es rubro que usa peso/medida
    const isBulkRubro = ['verduleria/fruteria', 'abarrotes'].includes(activeRubroContext);

    // Helper para cambiar tipo de venta con unidad lógica
    const handleTypeChange = (type) => {
        setSaleType(type);
        if (type === 'bulk') {
            setUnit(isBulkRubro ? 'kg' : 'lt');
        } else {
            setUnit('pza');
        }
    };

    // Sincronizar respuestas con el wizard (usando useEffect para evitar problemas de render)
    const currentSaleTypeRef = React.useRef(saleType);
    const currentUnitRef = React.useRef(unit);
    
    React.useEffect(() => {
        if (derivedConfig.saleType && derivedConfig.saleType !== currentSaleTypeRef.current) {
            setSaleType(derivedConfig.saleType);
            currentSaleTypeRef.current = derivedConfig.saleType;
        }
    }, [derivedConfig.saleType, setSaleType]);
    
    React.useEffect(() => {
        if (derivedConfig.unit && derivedConfig.unit !== currentUnitRef.current) {
            setUnit(derivedConfig.unit);
            currentUnitRef.current = derivedConfig.unit;
        }
    }, [derivedConfig.unit, setUnit]);

    return (
        <div className="wizard-step" style={{ animation: 'fadeIn 0.3s' }}>
            {/* Header del paso */}
            <div style={{
                marginBottom: '20px',
                paddingBottom: '15px',
                borderBottom: '2px solid var(--border-color)'
            }}>
                <h3 style={{
                    margin: '0 0 8px 0',
                    color: 'var(--primary-color)',
                    fontSize: '1.3rem'
                }}>
                    📦 Inventario y Existencias
                </h3>
                <p style={{
                    margin: 0,
                    color: 'var(--text-light)',
                    fontSize: '0.9rem'
                }}>
                    Configura cómo manejas este producto en tu almacén
                </p>
            </div>

            {/* Preguntas Inteligentes (solo si hay preguntas para este rubro) */}
            {questions.visibleQuestions.length > 0 && (
                <SmartQuestions
                    questions={questions.questions}
                    visibleQuestions={questions.visibleQuestions}
                    answers={questions.answers}
                    answerQuestion={questions.answerQuestion}
                    progress={questions.progress}
                />
            )}

            {/* Ayuda Visual Dinámica (después de responder preguntas) */}
            {Object.keys(questions.answers).length > 0 && (
                <DynamicHelp
                    activeRubroContext={activeRubroContext}
                    answers={questions.answers}
                    wizard={wizard}
                />
            )}

            {/* Interruptor de Control de Stock */}
            <div
                className={`stock-switch-container ${doesTrackStock ? 'active' : ''}`}
                onClick={() => setDoesTrackStock(!doesTrackStock)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    padding: '15px',
                    backgroundColor: doesTrackStock ? '#f0fdf4' : '#f8fafc',
                    border: `2px solid ${doesTrackStock ? '#22c55e' : '#cbd5e1'}`,
                    borderRadius: '12px',
                    cursor: 'pointer',
                    marginBottom: '20px',
                    transition: 'all 0.3s ease'
                }}
            >
                <div
                    className="stock-track"
                    style={{ 
                        width: '50px', 
                        height: '28px', 
                        backgroundColor: doesTrackStock ? 'var(--success-color)' : '#9ca3af',
                        borderRadius: '14px',
                        position: 'relative',
                        transition: 'background-color 0.3s'
                    }}
                >
                    <div
                        className="stock-thumb"
                        style={{ 
                            position: 'absolute',
                            width: '24px', 
                            height: '24px', 
                            backgroundColor: 'white',
                            borderRadius: '50%',
                            left: doesTrackStock ? '22px' : '2px',
                            top: '2px',
                            transition: 'left 0.3s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                    ></div>
                </div>
                <div>
                    <span style={{ 
                        fontWeight: 'bold', 
                        display: 'block', 
                        color: doesTrackStock ? '#166534' : '#64748b',
                        fontSize: '1rem'
                    }}>
                        {doesTrackStock ? '✓ Controlar Inventario' : '○ Venta Libre (Sin Stock)'}
                    </span>
                    <span style={{ 
                        fontSize: '0.8rem', 
                        color: doesTrackStock ? '#15803d' : '#94a3b8'
                    }}>
                        {doesTrackStock 
                            ? 'El sistema descontará automáticamente al vender' 
                            : 'Ideal para productos ilimitados o servicios'}
                    </span>
                </div>
            </div>

            {/* Campos condicionales si controla stock */}
            {doesTrackStock && (
                <>
                    {/* Stock Inicial */}
                    <div className="form-group">
                        <label className="form-label">Stock Inicial</label>
                        <input
                            type="number"
                            className="form-input"
                            value={stock}
                            onChange={(e) => setStock(e.target.value)}
                            placeholder="0"
                            min="0"
                            style={{
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                borderColor: step2Errors?.stock ? 'var(--error-color)' : 'var(--border-color)'
                            }}
                        />
                        {step2Errors?.stock && (
                            <span style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginTop: '4px', display: 'block' }}>
                                ⚠️ {step2Errors.stock}
                            </span>
                        )}
                    </div>

                    {/* Tipo de Venta para rubros que lo necesitan (solo si NO hay preguntas inteligentes) */}
                    {isBulkRubro && questions.visibleQuestions.length === 0 && (
                        <div style={{ 
                            marginTop: '20px', 
                            padding: '15px', 
                            backgroundColor: '#eff6ff', 
                            borderRadius: '12px',
                            border: '1px solid #bfdbfe'
                        }}>
                            <label className="form-label" style={{ 
                                color: '#0369a1', 
                                fontWeight: 'bold', 
                                marginBottom: '12px', 
                                display: 'block' 
                            }}>
                                ¿Cómo vendes este producto?
                            </label>
                            
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button
                                    type="button"
                                    className={`btn ${saleType === 'unit' ? 'btn-save' : 'btn-cancel'}`}
                                    style={{
                                        flex: 1,
                                        opacity: saleType === 'unit' ? 1 : 0.7
                                    }}
                                    onClick={() => handleTypeChange('unit')}
                                >
                                    🍎 Por Pieza
                                </button>
                                <button
                                    type="button"
                                    className={`btn ${saleType === 'bulk' ? 'btn-save' : 'btn-cancel'}`}
                                    style={{
                                        flex: 1,
                                        opacity: saleType === 'bulk' ? 1 : 0.7
                                    }}
                                    onClick={() => handleTypeChange('bulk')}
                                >
                                    ⚖️ Por Peso
                                </button>
                            </div>

                            {/* Unidad de Medida */}
                            <div style={{ 
                                backgroundColor: 'white',
                                padding: '12px', 
                                borderRadius: '8px',
                                border: '1px solid #dbeafe'
                            }}>
                                <label className="form-label" style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>
                                    Unidad de medida:
                                </label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {(saleType === 'bulk' 
                                        ? COMMON_UNITS.filter(u => ['kg', 'gr', 'lt', 'ml'].includes(u.val))
                                        : COMMON_UNITS.filter(u => ['pza', 'manojo', 'bolsa', 'caja'].includes(u.val))
                                    ).map(u => (
                                        <button
                                            key={u.val}
                                            type="button"
                                            onClick={() => setUnit(u.val)}
                                            style={{
                                                padding: '8px 16px',
                                                borderRadius: '8px',
                                                border: `2px solid ${unit === u.val ? 'var(--primary-color)' : '#e2e8f0'}`,
                                                backgroundColor: unit === u.val ? '#eff6ff' : 'white',
                                                color: unit === u.val ? 'var(--primary-color)' : '#64748b',
                                                fontWeight: unit === u.val ? 'bold' : 'normal',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            {u.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Ubicación y Proveedor */}
                    <div className="theme-group-container" style={{ marginTop: '20px' }}>
                        <div className="form-group">
                            <label className="form-label">📍 Ubicación en Tienda</label>
                            <input
                                type="text"
                                className="form-input"
                                value={storageLocation}
                                onChange={(e) => setStorageLocation(e.target.value)}
                                placeholder="Ej: Pasillo 3, Estante B"
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '4px', display: 'block' }}>
                                💡 Te ayuda a encontrar el producto rápidamente
                            </span>
                        </div>

                        <div className="form-group">
                            <label className="form-label">🏭 Proveedor Principal</label>
                            <input
                                type="text"
                                className="form-input"
                                value={supplier}
                                onChange={(e) => setSupplier(e.target.value)}
                                placeholder="Ej: Coca-Cola FEMSA, Bimbo..."
                            />
                        </div>
                    </div>

                    {/* Stock Mínimo */}
                    <div style={{
                        marginTop: '20px',
                        padding: '15px',
                        backgroundColor: '#fffbeb',
                        borderRadius: '12px',
                        border: '1px solid #fde68a'
                    }}>
                        <h4 style={{ 
                            margin: '0 0 12px 0', 
                            fontSize: '0.95rem', 
                            color: '#92400e',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            🔔 Alerta de Stock Bajo
                        </h4>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.9rem' }}>
                                ¿Cuántos productos mínimos deben quedar antes de reordenar?
                            </label>
                            <input
                                type="number"
                                className="form-input"
                                value={minStock}
                                onChange={(e) => setMinStock(e.target.value)}
                                placeholder="Ej: 10"
                                style={{ maxWidth: '150px' }}
                            />
                            <span style={{ 
                                fontSize: '0.8rem', 
                                color: '#92400e', 
                                marginTop: '8px', 
                                display: 'block' 
                            }}>
                                El sistema te avisará cuando el stock llegue a este nivel
                            </span>
                        </div>
                    </div>
                </>
            )}

            {/* Banner de progreso del paso */}
            <div style={{
                marginTop: '24px',
                padding: '12px 16px',
                backgroundColor: doesTrackStock ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${doesTrackStock ? '#bbf7d0' : '#fde68a'}`,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}>
                <span style={{ fontSize: '1.3rem' }}>
                    {doesTrackStock ? '⚙️' : '📌'}
                </span>
                <div>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '0.9rem', 
                        fontWeight: '600',
                        color: doesTrackStock ? '#166534' : '#92400e'
                    }}>
                        {doesTrackStock 
                            ? 'Inventario configurado con control de stock' 
                            : 'Producto en venta libre sin control de existencias'}
                    </p>
                </div>
            </div>
        </div>
    );
}
