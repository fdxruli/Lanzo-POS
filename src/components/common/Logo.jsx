import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function Logo({ className, style, vertical = false }) {
    const companyName = useAppStore(state => state.companyProfile?.name);
    const rawName = companyName ? companyName.toUpperCase() : "TU NEGOCIO";

    // --- CÁLCULO DE ANCHO DINÁMICO (Modo Horizontal) ---
    // Calculamos el ancho basándonos en los caracteres reales para que la "pastilla" se ajuste
    // "LANZO" (5) + " x " (3) = 8 caracteres base + el nombre del negocio
    const totalChars = 8 + rawName.length;
    
    // Estimación: 16px por letra (aprox para font 24px bold) + 90px espacio icono + 40px padding final
    const estimatedWidth = (totalChars * 16) + 90 + 40;
    
    // Establecemos un mínimo razonable (ej. 260px) para que no se vea minúsculo, pero quitamos el 460 forzado
    const finalWidth = Math.max(260, estimatedWidth);

    // --- MODO VERTICAL (Para Sidebar de Escritorio) ---
    if (vertical) {
        return (
            <svg
                viewBox={`0 0 260 110`}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                style={style}
            >
                {/* FONDO: Pastilla alta */}
                <rect width="260" height="110" rx="16" fill="var(--light-background)" />

                {/* ICONO */}
                <path d="M20 20H33L27 60H14L20 20Z" fill="#60A5FA" />
                <path d="M25 60H55L47 46H29L25 60Z" fill="#3B82F6" />

                {/* TEXTO: Dos líneas */}
                <text
                    x="65"
                    y="45"
                    fontFamily="sans-serif"
                    fontWeight="800"
                    fontSize="20" 
                    fill="var(--text-dark)"
                    letterSpacing="0.5"
                >
                    LANZO <tspan fontSize="17" fontWeight="400" fill="var(--text-light)">x</tspan>
                    
                    {/* Línea 2: Nombre del negocio */}
                    <tspan x="65" dy="30" fontSize="17" fill="var(--primary-color)">
                        {/* Si es muy largo en vertical, lo cortamos visualmente para que no salga del cuadro */}
                        {rawName.length > 18 ? rawName.substring(0, 16) + '..' : rawName}
                    </tspan>
                </text>

                {/* Indicador Online */}
                <circle cx="240" cy="20" r="5" fill="#10B981" />
            </svg>
        );
    }

    // --- MODO HORIZONTAL (Navbar) ---
    return (
        <svg
            viewBox={`0 0 ${finalWidth} 80`} 
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            style={style}
        >
            {/* FONDO: Pastilla ajustada al contenido */}
            <rect width={finalWidth} height="80" rx="40" fill="var(--light-background)" />

            {/* ICONO */}
            <path d="M25 20H38L32 60H19L25 20Z" fill="#60A5FA" />
            <path d="M30 60H60L52 46H34L30 60Z" fill="#3B82F6" />

            {/* TEXTO: Natural, sin estiramiento forzado */}
            <text
                x="85"
                y="50"
                fontFamily="sans-serif"
                fontWeight="800"
                fontSize="24" 
                fill="var(--text-dark)"
                letterSpacing="0.5" 
                /* Se eliminó textLength para evitar el efecto de "letras separadas" */
            >
                LANZO
                <tspan fontSize="18" fontWeight="400" fill="var(--text-light)" dx="8">x</tspan>
                <tspan fill="var(--primary-color)" dx="8">{rawName}</tspan>
            </text>

            {/* Indicador al final ajustado dinámicamente */}
            <circle cx={finalWidth - 25} cy="40" r="6" fill="#10B981" />
        </svg>
    );
}