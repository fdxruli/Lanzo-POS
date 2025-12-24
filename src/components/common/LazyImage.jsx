import React, { useState, useEffect, useRef } from 'react';
import { getImageFromDB } from '../../services/database';

export default function LazyImage({ src, alt, className = '', style = {}, ...props }) {
    const [objectUrl, setObjectUrl] = useState(null);
    const [isVisible, setIsVisible] = useState(false); // Nuevo estado
    const containerRef = useRef(null); // Referencia al contenedor

    // 1. Observer: Solo permite cargar si el elemento entra en pantalla
    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect(); // Dejar de observar una vez visible
                }
            });
        }, { rootMargin: '50px' }); // Precarga 50px antes de aparecer

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, []);

    // 2. Carga de imagen: Solo se ejecuta si isVisible es true
    useEffect(() => {
        if (!isVisible || !src) return; // Si no es visible, no hacemos nada

        let isActive = true;

        const loadImage = async () => {
            // Si ya es URL web o base64 directo, úsalo
            if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
                if(isActive) setObjectUrl(src);
                return;
            }

            try {
                // Solo aquí tocamos la base de datos
                const blob = await getImageFromDB(src);
                if (blob && isActive) {
                    const url = URL.createObjectURL(blob);
                    setObjectUrl(url);
                }
            } catch (e) {
                console.error("Error cargando imagen:", e);
            }
        };

        loadImage();

        return () => {
            isActive = false;
            // Limpieza de memoria
            if (objectUrl && objectUrl.startsWith('blob:')) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [src, isVisible]); // Dependencia clave: isVisible

    const renderPlaceholder = () => (
        <div style={{
            width: '100%', height: '100%', background: '#f3f4f6', 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#9ca3af', fontSize: '0.8rem', position: 'absolute', top: 0, left: 0
        }}>
            <span>{alt ? alt.charAt(0).toUpperCase() : 'IMG'}</span>
        </div>
    );

    return (
        <div 
            ref={containerRef} // Conectamos el observer
            style={{ position: 'relative', overflow: 'hidden', ...style }} 
            className={className}
        >
            {objectUrl ? (
                <img
                    src={objectUrl}
                    alt={alt}
                    style={{
                        display: 'block', width: '100%', height: '100%',
                        objectFit: 'cover', animation: 'fadeIn 0.3s'
                    }}
                    {...props}
                />
            ) : renderPlaceholder()}
        </div>
    );
}