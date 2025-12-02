// src/components/dashboard/BusinessTips.jsx
import React, { useMemo } from 'react';
import './BusinessTips.css'

// Lógica de generación de consejos
// NOTA: Para soportar formato (negritas, colores) de forma segura en el futuro,
// lo ideal sería que esta función devolviera objetos { id, type, content } 
// en lugar de strings planos HTML.
function generateTips(sales, menu) {
  if (sales.length === 0) {
    return [{ 
      id: 'welcome', 
      type: 'tip-intro', 
      text: '🚀 ¡Hola! Registra tu primera venta y volveré con consejos personalizados.' 
    }];
  }
  
  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
  
  // Devolvemos objetos para poder asignar clases dinámicas si se desea
  return [
    {
      id: 'sales-count',
      type: 'tip-growth', // Usamos clases de tu CSS
      text: `¡Buen trabajo! Has registrado ${sales.length} ventas.`
    },
    {
      id: 'revenue',
      type: 'tip-motivation',
      text: `Tus ingresos totales son $${totalRevenue.toFixed(2)}.`
    },
    {
      id: 'top-product',
      type: 'tip-star-product',
      text: `Tu producto más vendido (lógica pendiente) es un éxito. ¡Promociónalo más!`
    }
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
          // CORRECCIÓN DE SEGURIDAD:
          // 1. Usamos children en lugar de dangerouslySetInnerHTML
          // 2. Usamos clases dinámicas para dar estilo según el tipo de consejo
          <li 
            key={tip.id || index} 
            className={tip.type || "tip-intro"}
          >
            {tip.text}
          </li>
        ))}
      </ul>
    </div>
  );
}