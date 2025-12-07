// src/components/common/LazyImage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { getImageFromDB } from '../../services/database';

export default function LazyImage({
    src,
    alt,
    className = '',
    style = {},
    ...props
}) {
    const [hasError, setHasError] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);
    // 1. Estado para la URL
    const [objectUrl, setObjectUrl] = useState(null);

    const currentSrcRef = useRef(src);

    useEffect(() => {
        let isActive = true;

        const loadImage = async () => {
            setHasError(false);
            // Reseteamos isLoaded al cambiar de src
            setIsLoaded(false); 

            if (!src) {
                if(isActive) setObjectUrl(null);
                return;
            }

            if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
                if(isActive) setObjectUrl(src);
                return;
            }

            try {
                const blob = await getImageFromDB(src);
                if (blob && isActive) {
                    const url = URL.createObjectURL(blob);
                    setObjectUrl(url);
                } else if (isActive) {
                    setHasError(true);
                }
            } catch (e) {
                console.error("Error cargando imagen:", e);
                if (isActive) setHasError(true);
            }
        };

        loadImage();

        return () => {
            isActive = false;
            if (objectUrl && objectUrl.startsWith('blob:')) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [src]);

    const handleLoad = () => {
        setIsLoaded(true);
        setHasError(false);
    };

    const handleError = () => {
        setHasError(true);
        setIsLoaded(true);
    };

    // Helper para el cuadro gris
    const renderPlaceholder = () => (
        <div
            style={{
                width: '100%',
                height: '100%',
                background: '#f3f4f6', // Gris suave
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                fontSize: '0.8rem',
                fontWeight: '500',
                position: 'absolute', // Absoluto relativo al contenedor padre
                top: 0,
                left: 0,
                zIndex: 0 // Detrás si la imagen carga, visible si no
            }}
        >
            <span style={{padding: '0 5px', wordBreak: 'break-word'}}>{alt || 'Sin imagen'}</span>
        </div>
    );

    // 2. CORRECCIÓN VISUAL: 
    // Quitamos el "return renderPlaceholder()" temprano.
    // Siempre renderizamos el contenedor wrapper para mantener las dimensiones (120px)
    // definidas por la clase CSS externa.

    const showImage = !hasError && objectUrl;

    return (
        <div 
            style={{ position: 'relative', overflow: 'hidden', ...style }} 
            className={className} // Aquí se aplica la altura de 120px del CSS
        >
            {/* A. Imagen Real (Si existe y no hay error) */}
            {showImage && (
                <img
                    src={objectUrl}
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
                        opacity: isLoaded ? 1 : 0, // Se oculta mientras carga para no ver saltos
                        transition: 'opacity 0.2s ease-in-out',
                        position: 'relative',
                        zIndex: 2 // Encima del placeholder
                    }}
                    {...props}
                />
            )}

            {/* B. Spinner de carga (Solo si hay URL pero no ha terminado de cargar) */}
            {showImage && !isLoaded && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        background: 'var(--light-background)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 3
                    }}
                >
                    <div className="spinner-loader small"></div>
                </div>
            )}

            {/* C. Placeholder (Siempre está en el fondo, o visible si no hay imagen) */}
            {(!showImage || !isLoaded) && renderPlaceholder()}
        </div>
    );
}