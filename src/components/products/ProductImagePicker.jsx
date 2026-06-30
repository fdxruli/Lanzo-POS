import { useRef } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';

export default function ProductImagePicker({
    imagePreview,
    hasImage,
    isProcessing = false,
    onImageChange,
    onRemoveImage,
    compact = false
}) {
    const cameraInputRef = useRef(null);
    const galleryInputRef = useRef(null);
    const previewSize = compact ? 84 : 100;

    const handleInputChange = (e) => {
        const input = e.currentTarget;
        const result = onImageChange?.(e);
        Promise.resolve(result).finally(() => {
            input.value = '';
        });
    };

    return (
        <div
            className={`product-image-picker ${compact ? 'product-image-picker--compact' : ''}`}
            style={{ display: 'flex', gap: '15px', alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
            <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isProcessing}
                aria-label="Elegir imagen de producto desde galería"
                style={{
                    width: `${previewSize}px`,
                    height: `${previewSize}px`,
                    borderRadius: '8px',
                    border: '2px dashed #cbd5e1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    overflow: 'hidden',
                    backgroundColor: 'var(--card-background-color)',
                    padding: 0,
                    opacity: isProcessing ? 0.5 : 1
                }}
            >
                {imagePreview ? (
                    <img
                        className="image-preview"
                        src={imagePreview}
                        alt="Vista previa del producto"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    <Camera size={28} color="var(--text-light)" aria-hidden="true" />
                )}
            </button>

            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleInputChange}
                    disabled={isProcessing}
                    hidden
                />
                <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleInputChange}
                    disabled={isProcessing}
                    hidden
                />

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isProcessing}
                        aria-label="Tomar foto del producto"
                        style={{ fontSize: '0.9rem', padding: compact ? '7px 12px' : '8px 16px' }}
                    >
                        <Camera size={16} aria-hidden="true" /> Tomar foto
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={isProcessing}
                        aria-label="Elegir imagen de producto desde galería"
                        style={{ fontSize: '0.9rem', padding: compact ? '7px 12px' : '8px 16px' }}
                    >
                        <ImagePlus size={16} aria-hidden="true" /> Elegir de galería
                    </button>
                    {hasImage && onRemoveImage && (
                        <button
                            type="button"
                            className="btn btn-cancel"
                            onClick={onRemoveImage}
                            disabled={isProcessing}
                            aria-label="Quitar imagen del producto"
                            style={{ fontSize: '0.9rem', padding: compact ? '7px 12px' : '8px 16px' }}
                        >
                            <X size={16} aria-hidden="true" /> Quitar
                        </button>
                    )}
                </div>

                {isProcessing && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-light)', margin: '8px 0 0' }}>
                        Procesando imagen...
                    </p>
                )}
            </div>
        </div>
    );
}
