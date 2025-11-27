import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function Logo({ className, style, vertical = false }) {
    const companyName = useAppStore(state => state.companyProfile?.name);
    const rawName = companyName ? companyName.toUpperCase() : "TU NEGOCIO";

    // Calculate dynamic width based on the name length
    const nameLength = rawName.length;
    const dynamicWidth = Math.max(460, 80 + nameLength * 12); // Minimum 460, grows with name length

    // --- MODO VERTICAL (Para Sidebar de Escritorio) ---
    // Muestra el logo arriba y el nombre abajo en dos líneas
    if (vertical) {
        return (
            <svg
                viewBox={`0 0 260 110`} // Más alto y estrecho para la barra lateral
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                style={style}
            >
                {/* FONDO: Pastilla alta */}
                <rect width="260" height="110" rx="16" fill="var(--light-background)" />

                {/* ICONO: Alineado a la izquierda superior */}
                <path d="M20 20H33L27 60H14L20 20Z" fill="#60A5FA" />
                <path d="M25 60H55L47 46H29L25 60Z" fill="#3B82F6" />

                {/* TEXTO: Dos líneas */}
                <text
                    x="65"
                    y="45" // Línea 1: LANZO x
                    fontFamily="sans-serif"
                    fontWeight="800"
                    fontSize="20" 
                    fill="var(--text-dark)"
                    letterSpacing="0.5"
                >
                    LANZO <tspan fontSize="17" fontWeight="400" fill="var(--text-light)">x</tspan>
                    
                    {/* Línea 2: Nombre del negocio (Gary Entre Alas) */}
                    <tspan x="65" dy="30" fontSize="17" fill="var(--primary-color)">{rawName}</tspan>
                </text>

                {/* Indicador Online */}
                <circle cx="240" cy="20" r="5" fill="#10B981" />
            </svg>
        );
    }

    return (
        <svg
            viewBox={`0 0 ${dynamicWidth} 80`} 
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            style={style}
        >
            {/* FONDO: Pastilla ancha */}
            <rect width={dynamicWidth} height="80" rx="40" fill="var(--light-background)" />

            {/* ICONO */}
            <path d="M25 20H38L32 60H19L25 20Z" fill="#60A5FA" />
            <path d="M30 60H60L52 46H34L30 60Z" fill="#3B82F6" />

            {/* TEXTO: Todo en una línea */}
            <text
                x="80"
                y="52"
                fontFamily="sans-serif"
                fontWeight="800"
                fontSize="24" 
                fill="var(--text-dark)"
                letterSpacing="0.5"
                textLength={dynamicWidth - 120} // Adjust text length dynamically
                lengthAdjust="spacingAndGlyphs"
            >
                LANZO
                <tspan fontSize="18" fontWeight="400" fill="var(--text-light)" dx="10">x</tspan>
                <tspan fill="var(--primary-color)" dx="10">{rawName}</tspan>
            </text>

            {/* Indicador al final */}
            <circle cx={dynamicWidth - 25} cy="40" r="6" fill="#10B981" />
        </svg>
    );
}