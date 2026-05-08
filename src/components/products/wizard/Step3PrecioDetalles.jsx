import { useRef } from 'react';

const getMarginColor = (marginVal) => {
    const m = parseFloat(marginVal) || 0;
    if (m < 15) return '#ef4444';
    if (m < 30) return '#eab308';
    return '#22c55e';
};

const getMarginLabel = (marginVal) => {
    const m = parseFloat(marginVal) || 0;
    if (m < 15) return { text: 'Margen Bajo', emoji: '⚠️' };
    if (m < 30) return { text: 'Margen Regular', emoji: '📊' };
    if (m < 50) return { text: 'Margen Saludable', emoji: '✅' };
    return { text: 'Margen Excelente', emoji: '🎉' };
};

export default function Step3PrecioDetalles({
    wizard
}) {
    const {
        cost,
        price,
        margin,
        description, setDescription,
        imageData, setImageData,
        imagePreview, setImagePreview,
        step3Errors,
        handleCostChange,
        handlePriceChange,
        handleMarginChange
    } = wizard;

    const fileInputRef = useRef(null);

    // Handler para imagen
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                // Compresión básica de imagen
                const reader = new FileReader();
                reader.onload = (event) => {
                    setImageData(event.target.result);
                    setImagePreview(event.target.result);
                };
                reader.readAsDataURL(file);
            } catch (error) {
                console.error('Error al procesar imagen:', error);
            }
        }
    };

    const marginColor = getMarginColor(margin);
    const marginLabel = getMarginLabel(margin);

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
                    💰 Precio y Detalles
                </h3>
                <p style={{ 
                    margin: 0, 
                    color: 'var(--text-light)', 
                    fontSize: '0.9rem' 
                }}>
                    Define el precio y agrega detalles opcionales
                </p>
            </div>

            {/* Sección de Precios - CRÍTICA */}
            <div style={{
                backgroundColor: '#f8fafc',
                padding: '20px',
                borderRadius: '12px',
                border: '2px solid #e2e8f0',
                marginBottom: '20px'
            }}>
                <h4 style={{ 
                    margin: '0 0 15px 0', 
                    fontSize: '1rem', 
                    color: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    💵 Configuración de Precios
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    {/* Costo */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.9rem' }}>
                            Costo del Producto
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: '#64748b',
                                fontWeight: '600'
                            }}>$</span>
                            <input
                                type="number"
                                className="form-input"
                                value={cost}
                                onChange={(e) => handleCostChange(e.target.value)}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                                style={{
                                    paddingLeft: '30px',
                                    fontSize: '1.1rem',
                                    fontWeight: '600'
                                }}
                            />
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                            ¿Cuánto pagaste por él?
                        </span>
                    </div>

                    {/* Precio Venta */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.9rem' }}>
                            Precio de Venta <span style={{ color: 'var(--error-color)' }}>*</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: '#64748b',
                                fontWeight: '600'
                            }}>$</span>
                            <input
                                type="number"
                                className="form-input"
                                value={price}
                                onChange={(e) => handlePriceChange(e.target.value)}
                                placeholder="0.00"
                                min="0"
                                step="0.01"
                                style={{
                                    paddingLeft: '30px',
                                    fontSize: '1.1rem',
                                    fontWeight: '700',
                                    borderColor: step3Errors?.price ? 'var(--error-color)' : 'var(--border-color)',
                                    color: '#1e293b'
                                }}
                                autoFocus
                            />
                        </div>
                        {step3Errors?.price && (
                            <span style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginTop: '4px', display: 'block' }}>
                                ⚠️ {step3Errors.price}
                            </span>
                        )}
                    </div>
                </div>

                {/* Margen de Ganancia - VISUAL */}
                {margin && (
                    <div style={{
                        marginTop: '20px',
                        padding: '15px',
                        backgroundColor: 'white',
                        borderRadius: '10px',
                        border: `2px solid ${marginColor}`,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#64748b' }}>
                                Margen de Ganancia
                            </span>
                            <span style={{
                                fontSize: '1.5rem',
                                fontWeight: '800',
                                color: marginColor
                            }}>
                                {marginLabel.emoji} {margin}%
                            </span>
                        </div>
                        
                        {/* Barra de progreso del margen */}
                        <div style={{
                            height: '10px',
                            backgroundColor: '#f1f5f9',
                            borderRadius: '5px',
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <div style={{
                                height: '100%',
                                width: `${Math.min(parseFloat(margin), 100)}%`,
                                backgroundColor: marginColor,
                                transition: 'width 0.3s, background-color 0.3s'
                            }}></div>
                        </div>

                        <div style={{ 
                            marginTop: '10px', 
                            display: 'flex', 
                            justifyContent: 'space-between',
                            fontSize: '0.85rem'
                        }}>
                            <span style={{ color: '#64748b' }}>
                                Ganancia por unidad: <strong style={{ color: marginColor }}>${(parseFloat(price || 0) - parseFloat(cost || 0)).toFixed(2)}</strong>
                            </span>
                            <span style={{ color: marginColor, fontWeight: '600' }}>
                                {marginLabel.text}
                            </span>
                        </div>

                        {/* Input de margen para ajuste rápido */}
                        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <label style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                Ajustar margen:
                            </label>
                            <input
                                type="number"
                                value={margin}
                                onChange={(e) => handleMarginChange(e.target.value)}
                                placeholder="%"
                                style={{
                                    width: '80px',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    border: `2px solid ${marginColor}`,
                                    textAlign: 'center',
                                    fontWeight: '600',
                                    color: marginColor,
                                    fontSize: '0.95rem'
                                }}
                            />
                            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                                El precio se ajustará automáticamente
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Detalles Opcionales */}
            <div style={{
                backgroundColor: '#f0fdf4',
                padding: '15px',
                borderRadius: '12px',
                border: '1px solid #bbf7d0',
                marginBottom: '20px'
            }}>
                <h4 style={{ 
                    margin: '0 0 15px 0', 
                    fontSize: '0.95rem', 
                    color: '#166534',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    📝 Detalles Adicionales (Opcional)
                </h4>

                {/* Descripción */}
                <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.9rem' }}>Descripción</label>
                    <textarea
                        className="form-textarea"
                        rows="2"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ingredientes, características, uso recomendado..."
                        style={{ resize: 'vertical', minHeight: '60px' }}
                    />
                </div>

                {/* Imagen */}
                <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.9rem' }}>Imagen del Producto</label>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                width: '100px',
                                height: '100px',
                                borderRadius: '8px',
                                border: '2px dashed #cbd5e1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                backgroundColor: 'white',
                                transition: 'border-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = '#cbd5e1'}
                        >
                            {imageData ? (
                                <img
                                    src={imagePreview}
                                    alt="Producto"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            ) : (
                                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                                    <span style={{ fontSize: '1.5rem' }}>📷</span>
                                    <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>Agregar</div>
                                </div>
                            )}
                        </div>
                        <div style={{ flex: 1 }}>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleImageChange}
                                style={{ display: 'none' }}
                            />
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => fileInputRef.current?.click()}
                                style={{ fontSize: '0.9rem', padding: '8px 16px' }}
                            >
                                {imageData ? 'Cambiar imagen' : 'Subir imagen'}
                            </button>
                            {imageData && (
                                <button
                                    type="button"
                                    className="btn btn-cancel"
                                    onClick={() => {
                                        setImageData(null);
                                        setImagePreview('https://placehold.co/100x100/CCCCCC/000000?text=Elegir');
                                    }}
                                    style={{ 
                                        fontSize: '0.9rem', 
                                        padding: '8px 16px',
                                        marginLeft: '10px'
                                    }}
                                >
                                    Quitar
                                </button>
                            )}
                            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px' }}>
                                💡 Una imagen ayuda a identificar el producto más rápido en el punto de venta
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Banner de progreso del paso */}
            <div style={{
                marginTop: '24px',
                padding: '12px 16px',
                backgroundColor: price && parseFloat(price) > 0 ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${price && parseFloat(price) > 0 ? '#bbf7d0' : '#fde68a'}`,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}>
                <span style={{ fontSize: '1.3rem' }}>
                    {price && parseFloat(price) > 0 ? '✅' : '⏳'}
                </span>
                <div>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '0.9rem', 
                        fontWeight: '600',
                        color: price && parseFloat(price) > 0 ? '#166534' : '#92400e'
                    }}>
                        {price && parseFloat(price) > 0 
                            ? margin && parseFloat(margin) > 0
                                ? `¡Precio listo! ${marginLabel.emoji} ${marginLabel.text}`
                                : 'Precio establecido, ingresa el costo para ver tu margen'
                            : 'Ingresa el precio de venta para continuar'}
                    </p>
                </div>
            </div>
        </div>
    );
}
