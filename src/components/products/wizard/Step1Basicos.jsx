import ScannerModal from '../../common/ScannerModal';
import CategorySelect from '../forms/CategorySelect';

export default function Step1Basicos({
    wizard,
    categories,
    onOpenCategoryManager
}) {
    const {
        name, setName,
        barcode, setBarcode,
        categoryId, setCategoryId,
        step1Errors,
        isScannerOpen, setIsScannerOpen
    } = wizard;

    // Capitalizar nombre al perder foco
    const handleNameBlur = () => {
        if (!name) return;
        const formatted = name.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
        setName(formatted.trim());
    };

    // Barcode: mayúsculas y sin espacios
    const handleBarcodeChange = (e) => {
        const val = e.target.value.toUpperCase().replace(/\s/g, '');
        setBarcode(val);
    };

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
                    📝 Información Básica
                </h3>
                <p style={{ 
                    margin: 0, 
                    color: 'var(--text-light)', 
                    fontSize: '0.9rem' 
                }}>
                    Comienza con los datos esenciales del producto
                </p>
            </div>

            {/* Nombre del Producto */}
            <div className="form-group">
                <label className="form-label">
                    Nombre del Producto <span style={{ color: 'var(--error-color)' }}>*</span>
                </label>
                <input
                    className="form-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleNameBlur}
                    placeholder="Ej: Coca Cola 600ml, Paracetamol 500mg..."
                    autoFocus
                    style={{
                        borderColor: step1Errors?.name ? 'var(--error-color)' : 'var(--border-color)',
                        fontSize: '1rem',
                        padding: '12px'
                    }}
                />
                {step1Errors?.name && (
                    <span style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginTop: '4px', display: 'block' }}>
                        ⚠️ {step1Errors.name}
                    </span>
                )}
                <span style={{ 
                    fontSize: '0.8rem', 
                    color: 'var(--text-light)', 
                    marginTop: '4px', 
                    display: 'block' 
                }}>
                    💡 Tip: El nombre se capitalizará automáticamente
                </span>
            </div>

            {/* Código de Barras */}
            <div className="form-group">
                <label className="form-label">Código de Barras</label>
                <div className="input-with-button">
                    <input
                        className="form-input"
                        type="text"
                        value={barcode}
                        onChange={handleBarcodeChange}
                        placeholder="ESCANEAR O ESCRIBIR CÓDIGO"
                        style={{ fontSize: '1rem' }}
                    />
                    <button 
                        type="button" 
                        className="btn-scan-inline" 
                        onClick={() => setIsScannerOpen(true)}
                        title="Escanear código de barras"
                    >
                        📷
                    </button>
                </div>
                <span style={{ 
                    fontSize: '0.8rem', 
                    color: 'var(--text-light)', 
                    marginTop: '4px', 
                    display: 'block' 
                }}>
                    🔍 Escanea productos para autocompletar información
                </span>
            </div>

            {/* Categoría */}
            <div className="form-group">
                <label className="form-label">
                    Categoría <span style={{ color: 'var(--error-color)' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <CategorySelect
                        className="form-input"
                        value={categoryId}
                        onChange={setCategoryId}
                        activeCategories={categories}
                        style={{
                            flex: 1,
                            borderColor: step1Errors?.categoryId ? 'var(--error-color)' : 'var(--border-color)'
                        }}
                    />
                    <button 
                        type="button" 
                        className="btn btn-help" 
                        onClick={onOpenCategoryManager}
                        title="Administrar categorías"
                    >
                        ➕
                    </button>
                </div>
                {step1Errors?.categoryId && (
                    <span style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginTop: '4px', display: 'block' }}>
                        ⚠️ {step1Errors.categoryId}
                    </span>
                )}
            </div>

            {/* Banner de progreso del paso */}
            <div style={{
                marginTop: '24px',
                padding: '12px 16px',
                backgroundColor: name && categoryId ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${name && categoryId ? '#bbf7d0' : '#fde68a'}`,
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }}>
                <span style={{ fontSize: '1.3rem' }}>
                    {name && categoryId ? '✅' : '⏳'}
                </span>
                <div>
                    <p style={{ 
                        margin: 0, 
                        fontSize: '0.9rem', 
                        fontWeight: '600',
                        color: name && categoryId ? '#166534' : '#92400e'
                    }}>
                        {name && categoryId 
                            ? '¡Datos básicos completos!' 
                            : 'Completa nombre y categoría para continuar'}
                    </p>
                    {name && !categoryId && (
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                            Falta seleccionar categoría
                        </p>
                    )}
                    {!name && categoryId && (
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                            Falta el nombre del producto
                        </p>
                    )}
                </div>
            </div>

            <ScannerModal 
                show={isScannerOpen} 
                onClose={() => setIsScannerOpen(false)} 
                onScanSuccess={(code) => { 
                    setBarcode(code); 
                    setIsScannerOpen(false); 
                }} 
            />
        </div>
    );
}
