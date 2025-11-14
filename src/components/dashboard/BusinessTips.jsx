import React, { useMemo } from 'react';
import './BusinessTips.css'

// ¡Esta es la lógica de 'renderBusinessTips'!
function generateTips(sales, menu) {
  if (sales.length === 0) {
    return ['🚀 ¡Hola! Registra tu primera venta y volveré con consejos personalizados.'];
  }
  
  // (Aquí iría toda la lógica de análisis de 'business-tips.js')
  // ...
  // Por simplicidad, ponemos un consejo genérico
  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
  
  return [
    `¡Buen trabajo! Has registrado ${sales.length} ventas.`,
    `Tus ingresos totales son $${totalRevenue.toFixed(2)}.`,
    `Tu producto más vendido (lógica pendiente) es un éxito. ¡Promociónalo más!`
  ];
}

export default function BusinessTips({ sales, menu }) {
  // Recalcula los tips solo si los datos cambian
  const tips = useMemo(() => generateTips(sales, menu), [sales, menu]);

  return (
    <div className="news-placeholder">
      <h3 className="news-title">Consejos para tu Negocio</h3>
      <ul id="business-tips" className="business-alerts">
        {tips.map((tip, index) => (
          <li key={index} className="tip-intro" dangerouslySetInnerHTML={{ __html: tip }} />
        ))}
      </ul>
    </div>
  );
}