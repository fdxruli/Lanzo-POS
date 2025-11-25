// src/components/common/Logo.jsx
import React from 'react';

export default function Logo({ className, style }) {
    return (
        <svg
            width="320"
            height="80"
            viewBox="0 0 320 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            style={style}
        >
            {/* FONDO: Usamos var(--light-background).
         - En modo claro será un gris suave (#DCE0E5).
         - En modo oscuro será un gris azulado oscuro (#334155).
         Esto mantiene el estilo de "pastilla" pero adaptado.
      */}
            <rect width="320" height="80" rx="40" fill="var(--light-background)" />

            {/* ICONO (Triángulos Azules): Se mantienen igual porque el azul se ve bien en ambos fondos */}
            <path d="M25 20H38L32 60H19L25 20Z" fill="#60A5FA" />
            <path d="M30 60H60L52 46H34L30 60Z" fill="#3B82F6" />

            {/* TEXTO: Usamos var(--text-dark).
         - En modo claro será casi negro (#1F2937).
         - En modo oscuro será blanco casi puro (#F8FAFC).
      */}
            <text
                x="80"
                y="56"
                fontFamily="sans-serif"
                fontWeight="700"
                fontSize="40"
                fill="var(--text-dark)"
                letterSpacing="1"
            >
                LANZO
            </text>

            {/* PUNTO VERDE: Se mantiene igual */}
            <circle cx="280" cy="40" r="6" fill="#10B981" />
        </svg>
    );
}