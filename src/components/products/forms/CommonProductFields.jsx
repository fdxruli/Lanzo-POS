import { Camera, ChevronDown, ChevronUp, Search } from 'lucide-react';
import ScannerModal from '../../scanner/ScannerModal';
import CategorySelect from './CategorySelect';
import ProductImagePicker from '../ProductImagePicker';

const getMarginTone = (marginVal) => {
    const m = parseFloat(marginVal) || 0;
    if (m < 15) return 'danger';
    if (m < 30) return 'warning';
    return 'success';
};

export default function CommonProductFields({
    common,
    categories,
    onOpenCategoryManager
}) {
    const {
        name, setName,
        barcode, setBarcode,
        description, setDescription,
        imagePreview, imageData, isImageProcessing,
        handleImageChange,
        categoryId, setCategoryId,
        cost, price, margin,
        handleCostChange, handlePriceChange, handleMarginChange,
        doesTrackStock, setDoesTrackStock,
        isScannerOpen, setIsScannerOpen,
        isLookingUp, handleBarcodeLookup,
        showSpecificData, setShowSpecificData
    } = common;

    const marginTone = getMarginTone(margin);

    const handleNameBlur = () => {
        if (!name) return;
        const formatted = name.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
        setName(formatted.trim());
    };

    const handleBarcodeChange = (e) => {
        const val = e.target.value.toUpperCase().replace(/\s/g, '');
        setBarcode(val);
    };

    return (
        <>
            <section className="product-form-section">
                <div className="product-form-section__header">
                    <div className="product-form-section__heading">
                        <h4 className="product-form-section__title">
                            {common.name ? (
                                <span>Editando: <strong>{common.name}</strong></span>
                            ) : (
                                <span>Nuevo producto</span>
                            )}
                        </h4>
                        <p className="product-form-section__subtitle">
                            Captura la información base para identificar y vender el producto.
                        </p>
                    </div>
                    <span className="product-form-status-badge">Datos generales</span>
                </div>

                <div className="product-form-section__body">
                    <div className="form-group">
                        <label className="form-label">Nombre del producto *</label>
                        <input
                            className="form-input"
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onBlur={handleNameBlur}
                            placeholder="Ej: Producto 500g"
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Código de barras</label>
                        <div className="input-with-button">
                            <input
                                className="form-input"
                                type="text"
                                value={barcode}
                                onChange={handleBarcodeChange}
                                placeholder="ESCANEAR O ESCRIBIR"
                            />
                            <button
                                type="button"
                                className="btn btn-scan-inline"
                                onClick={() => setIsScannerOpen(true)}
                                aria-label="Escanear código de barras"
                            >
                                <Camera size={18} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                className="btn btn-lookup"
                                onClick={handleBarcodeLookup}
                                disabled={isLookingUp}
                                aria-label="Buscar producto por código de barras"
                            >
                                <Search size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section className="product-form-section product-form-section--compact">
                <div className="product-form-section__header">
                    <div className="product-form-section__heading">
                        <h4 className="product-form-section__title">Precios y margen</h4>
                        <p className="product-form-section__subtitle">
                            Define costo, margen y precio de venta con el mismo patrón visual.
                        </p>
                    </div>
                </div>

                <div className="product-form-field-row product-form-field-row--wrap">
                    <div className="form-group product-form-field-compact product-form-field-grow">
                        <label className="form-label">Costo ($)</label>
                        <input
                            type="number"
                            className="form-input"
                            value={cost}
                            onChange={e => handleCostChange(e.target.value)}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                        />
                    </div>

                    <div className="form-group product-form-field-compact product-form-field-compact--narrow" style={{ position: 'relative' }}>
                        <label className="form-label">Margen %</label>
                        <input
                            type="number"
                            className={`form-input product-form-margin-input is-${marginTone}`}
                            value={margin}
                            onChange={e => handleMarginChange(e.target.value)}
                            placeholder="%"
                        />
                        <div className={`product-form-margin-indicator is-${marginTone}`} aria-hidden="true" />
                    </div>

                    <div className="form-group product-form-field-compact product-form-field-grow">
                        <label className="form-label">Precio venta *</label>
                        <input
                            type="number"
                            className="form-input product-form-price-input"
                            value={price}
                            onChange={e => handlePriceChange(e.target.value)}
                            required
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                        />
                    </div>
                </div>
            </section>

            <div
                className={`stock-switch-container ${doesTrackStock ? 'active' : ''}`}
                onClick={() => setDoesTrackStock(!doesTrackStock)}
            >
                <div className="stock-track" aria-hidden="true">
                    <div className="stock-thumb" />
                </div>
                <div>
                    <span className="product-form-section__title">
                        {doesTrackStock ? 'Controlar inventario' : 'Venta libre sin stock'}
                    </span>
                    <p className="product-form-help">
                        {doesTrackStock
                            ? 'El producto descontará existencias al venderse.'
                            : 'El producto podrá venderse sin validar existencias.'}
                    </p>
                </div>
            </div>

            <button type="button" className="btn-toggle-specific" onClick={() => setShowSpecificData(!showSpecificData)}>
                {showSpecificData ? 'Ocultar detalles' : 'Agregar foto, categoría o descripción'}
                {showSpecificData ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            </button>

            {showSpecificData && (
                <section className="specific-data-container">
                    <div className="product-form-section__header">
                        <div className="product-form-section__heading">
                            <h4 className="product-form-section__title">Detalles adicionales</h4>
                            <p className="product-form-section__subtitle">
                                Completa categoría, descripción e imagen cuando el producto lo requiera.
                            </p>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Categoría</label>
                        <div className="product-form-action-row">
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
                        <textarea className="form-textarea" rows="2" value={description} onChange={(e) => setDescription(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Imagen</label>
                        <ProductImagePicker
                            imagePreview={imagePreview}
                            hasImage={Boolean(imageData)}
                            isProcessing={isImageProcessing}
                            onImageChange={handleImageChange}
                        />
                    </div>
                </section>
            )}

            <ScannerModal show={isScannerOpen} onClose={() => setIsScannerOpen(false)} onScanSuccess={(code) => { setBarcode(code); setIsScannerOpen(false); }} />
        </>
    );
}
