/**
 * BusinessTips.jsx - LEGACY WRAPPER
 * 
 * Este archivo ahora es un wrapper de compatibilidad hacia OperationalDiagnostics.
 * El módulo de inteligencia de negocio fue refactorizado a un sistema de 
 * Diagnóstico Operativo con alertas duras basadas en datos reales.
 * 
 * @deprecated Usar OperationalDiagnostics directamente en nuevas implementaciones
 */

import React from 'react';
import OperationalDiagnostics from './OperationalDiagnostics';

export default function BusinessTips(props) {
  return <OperationalDiagnostics {...props} />;
}
