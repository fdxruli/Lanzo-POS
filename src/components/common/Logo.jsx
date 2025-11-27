import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function Logo({ className, style }) {
    // 1. Obtenemos el nombre real del negocio desde el estado global
    const companyName = useAppStore(state => state.companyProfile?.name);
    
    // 2. Si no hay nombre configurado aún, usamos "TU NEGOCIO" como fallback
    // Convertimos a mayúsculas para mantener el estilo urbano
    const rawName = companyName ? companyName.toUpperCase() : "TU NEGOCIO";

    // 3. Cortamos el nombre si es muy largo para que quepa en el logo (máx ~12 caracteres)
    const displayName = rawName.length > 13 ? rawName.substring(0, 12) + '.' : rawName;

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
            {/* FONDO: Pastilla */}
            <rect width="320" height="80" rx="40" fill="var(--light-background)" />

            {/* ICONO: Triángulos Azules (Marca del Sistema) */}
            <path d="M25 20H38L32 60H19L25 20Z" fill="#60A5FA" />
            <path d="M30 60H60L52 46H34L30 60Z" fill="#3B82F6" />

            {/* TEXTO DINÁMICO: SYSTEM x BUSINESS */}
            <text
                x="80"
                y="52"
                fontFamily="sans-serif"
                fontWeight="800"
                fontSize="24" 
                fill="var(--text-dark)"
                letterSpacing="0.5"
            >
                LANZO
                {/* La 'x' pequeña como 'feat' o colaboración */}
                <tspan fontSize="18" fontWeight="400" fill="var(--text-light)" dx="4"> x </tspan>
                
                {/* El nombre de TU negocio (Entre Alas, etc.) */}
                <tspan fill="var(--primary-color)" dx="4">{displayName}</tspan>
            </text>

            {/* PUNTO VERDE: Indicador de estado (Online) */}
            <circle cx="295" cy="40" r="6" fill="#10B981" />
        </svg>
    );
}
