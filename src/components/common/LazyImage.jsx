import React, { useState, useEffect, useRef } from 'react';

export default function LazyImage({
    src,
    alt,
    className = '',
    style = {},
    ...props
}) {
    // Estados para controlar la carga
    const [hasError, setHasError] = useState(!src);
    const [isLoaded, setIsLoaded] = useState(false);

    // Ref para rastrear la URL actual y detectar cambios reales
    const currentSrcRef = useRef(src);

    // ===================================================
    // CORRECCIÓN CRÍTICA: Reiniciar estados correctamente
    // ===================================================
    useEffect(() => {
        // Solo reiniciar si el src REALMENTE cambió
        if (currentSrcRef.current !== src) {
            currentSrcRef.current = src;

            if (src) {
                setHasError(false);
                setIsLoaded(false);
            } else {
                setHasError(true);
                setIsLoaded(true);
            }
        }
    }, [src]);

    const handleLoad = () => {
        setIsLoaded(true);
        setHasError(false);
    };

    const handleError = () => {
        setHasError(true);
        setIsLoaded(true);
    };

    // Renderizado del Placeholder (CSS puro, sin petición de red)
    const renderPlaceholder = () => (
        <div
            style={{
                width: '100%',
                height: '100%',
                background: '#f0f0f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#999',
                fontSize: '0.8rem',
                fontWeight: '500',
                position: 'absolute',
                top: 0,
                left: 0
            }}
        >
            <span>{alt || 'Sin imagen'}</span>
        </div>
    );

    return (
        <div style={{ position: 'relative', overflow: 'hidden', ...style }} className={className}>

            {/* 1. SPINNER: Solo si hay SRC, no hay error y aún no carga */}
            {src && !isLoaded && !hasError && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        background: 'var(--light-background)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1
                    }}
                >
                    <div className="spinner-loader small"></div>
                </div>
            )}

            {/* 2. IMAGEN REAL: Solo si hay SRC y no ha fallado */}
            {src && !hasError && (
                <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    onLoad={handleLoad}
                    onError={handleError}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        opacity: isLoaded ? 1 : 0,
                        transition: 'opacity 0.2s ease-in-out'
                    }}
                    {...props}
                />
            )}

            {/* 3. PLACEHOLDER: Si hubo error o no había SRC */}
            {hasError && renderPlaceholder()}
        </div>
    );
}
