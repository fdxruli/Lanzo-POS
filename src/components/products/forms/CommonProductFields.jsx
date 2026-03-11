import React from 'react';
import ScannerModal from '../../common/ScannerModal';
import CategorySelect from './CategorySelect';

const getMarginColor = (marginVal) => {
    const m = parseFloat(marginVal) || 0;
    if (m < 15) return '#ef4444'; // Rojo (Peligro, margen bajo)
    if (m < 30) return '#eab308'; // Amarillo (Precaución)
    return '#22c55e';             // Verde (Saludable)
};

export default function CommonProductFields({
    common, // Objeto que retorna useProductCommon
    categories,
    onOpenCategoryManager
}) {
    const {
        name, setName,
        barcode, setBarcode,
        description, setDescription,
        imagePreview, isImageProcessing,
        handleImageChange,
        categoryId, setCategoryId,
        cost, price, margin,
        handleCostChange, handlePriceChange, handleMarginChange,
        doesTrackStock, setDoesTrackStock,
        isScannerOpen, setIsScannerOpen,
        isLookingUp, handleBarcodeLookup,
        showSpecificData, setShowSpecificData
    } = common;

    // 1. Para el NOMBRE: Capitalizar al perder el foco (onBlur)
    const handleNameBlur = () => {
        if (!name) return;
        // Convierte "coca cola" en "Coca Cola"
        const formatted = name.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
        setName(formatted.trim());
    };

    // 2. Para el CÓDIGO DE BARRAS: Forzar mayúsculas y quitar espacios
    const handleBarcodeChange = (e) => {
        const val = e.target.value.toUpperCase().replace(/\s/g, ''); // Sin espacios, todo UPPER
        setBarcode(val);
    };

    return (
        <>

            {/* HEADER CONTEXTUAL */}
            <div style={{
                marginBottom: '20px',
                paddingBottom: '10px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <h4 style={{ margin: 0, color: 'var(--primary-color)' }}>
                    {common.name ? (
                        <span>📝 Editando: <strong>{common.name}</strong></span>
                    ) : (
                        <span>✨ Nuevo Producto</span>
                    )}
                </h4>
                {/* Pequeño indicador de progreso o estado */}
                <span style={{ fontSize: '0.8rem', color: '#94a3b8', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                    Datos Generales
                </span>
            </div>

            <div className="form-group">
                <label className="form-label">Nombre del Producto *</label>
                <input
                    className="form-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleNameBlur} // <-- Agregado
                    placeholder="Ej: Aspirina 500mg"
                />
            </div>

            <div className="form-group">
                <label className="form-label">Código de Barras</label>
                <div className="input-with-button">
                    <input
                        className="form-input"
                        type="text"
                        value={barcode}
                        onChange={handleBarcodeChange} // <-- Usamos la función mejorada
                        placeholder="ESCANEAR O ESCRIBIR"
                    />
                    <button type="button" className="btn-scan-inline" onClick={() => setIsScannerOpen(true)}>📷</button>
                    <button type="button" className="btn-lookup" onClick={handleBarcodeLookup} disabled={isLookingUp}>🔍</button>
                </div>
            </div>

            {/* SECCIÓN DE PRECIOS INTEGRADA */}
            <div className="theme-group-container">
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.85rem' }}>Costo ($)</label>
                        <input type="number" className="form-input" value={cost} onChange={e => handleCostChange(e.target.value)} placeholder="0.00" min="0" step="0.01" />
                    </div>

                    {/* ... (input de margen igual) ... */}
                    <div className="form-group" style={{ width: '80px', marginBottom: 0, position: 'relative' }}>
                        <label className="form-label" style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>Ganancia %</label>
                        <input
                            type="number"
                            className="form-input"
                            value={margin}
                            onChange={e => handleMarginChange(e.target.value)}
                            placeholder="%"
                            style={{
                                borderColor: getMarginColor(margin),
                                color: getMarginColor(margin),
                                fontWeight: 'bold',
                                textAlign: 'center',
                                borderWidth: '2px'
                            }}
                        />
                        <div style={{
                            position: 'absolute', right: '5px', top: '35px',
                            width: '8px', height: '8px', borderRadius: '50%',
                            backgroundColor: getMarginColor(margin)
                        }}></div>
                    </div>

                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.85rem' }}>Precio Venta *</label>
                        <input type="number" className="form-input" value={price} onChange={e => handlePriceChange(e.target.value)} required placeholder="0.00" min="0" step="0.01" style={{ fontWeight: 'bold', fontSize: '1.1rem' }} />
                    </div>
                </div>
            </div>

            {/* INTERRUPTOR DE STOCK (Estilo CSS limpio) */}
            <div
                className={`stock-switch-container ${doesTrackStock ? 'active' : ''}`}
                onClick={() => setDoesTrackStock(!doesTrackStock)}
            >
                <div
                    className="stock-track"
                    style={{ backgroundColor: doesTrackStock ? 'var(--success-color)' : '#9ca3af' }}
                >
                    <div
                        className="stock-thumb"
                        style={{ left: doesTrackStock ? '23px' : '3px' }}
                    ></div>
                </div>
                <div>
                    <span style={{ fontWeight: 'bold', display: 'block', color: 'var(--text-dark)' }}>
                        {doesTrackStock ? 'Controlar Inventario' : 'Venta Libre (Sin Stock)'}
                    </span>
                </div>
            </div>

            <button type="button" className="btn-toggle-specific" onClick={() => setShowSpecificData(!showSpecificData)} style={{ marginTop: '15px' }}>
                {showSpecificData ? 'Ocultar detalles (Foto, Cat, Desc)' : 'Agregar Foto, Categoría o Descripción'}
                {showSpecificData ? ' 🔼' : ' 🔽'}
            </button>

            {showSpecificData && (
                <div className="specific-data-container">
                    <div className="form-group">
                        <label className="form-label">Categoría</label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <CategorySelect
                                className="form-input"
                                value={categoryId}
                                onChange={setCategoryId}
                                activeCategories={categories}
                            />
                            <button type="button" className="btn btn-help" onClick={onOpenCategoryManager}>+</button>
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Descripción</label>
                        <textarea className="form-textarea" rows="2" value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Imagen</label>
                        <div className="image-upload-container">
                            <img className="image-preview" src={imagePreview} alt="Preview" style={{ opacity: isImageProcessing ? 0.5 : 1 }} />
                            <input className="file-input" type="file" accept="image/*" onChange={handleImageChange} disabled={isImageProcessing} />
                        </div>
                    </div>
                </div>
            )}

            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={(code) => { setBarcode(code); setIsScannerOpen(false); }} />
        </>
    );
}